# Bytesac API

## Overview

Express 5 + TypeScript API for Bytesac (initial settlement currency: USDC on Solana). This foundation covers wallet sign-in (SIWE/SIWS challenge and verify), sessions, linked chain accounts, contact verification (email and SMS OTP), notification preferences, manager applications and platform screening (public apply/status endpoints, `/v1/ops` for reviewers and admins, platform roles and the wallet-proof permission grant), organization onboarding (owner drafts, private documents in Cloudflare R2, payout wallet proof, `/v1/ops/organizations` review, public profile), organization members (invitations linked by wallet proof, fixed permission matrix, member verification and `/v1/ops/members` review, ops-only ownership transfer, public team), the asset registry (ops `/v1/ops/assets` drafting, on-chain deployment verification, review and lifecycle, CoinMarketCap prices, session read API `/v1/assets`), first investment and exit (Spec 8: investability, LI.FI-routed invest and sell operations with Solana fee-payer co-signing, EVM gas drops and Bitcoin PSBTs, position ledger, reconciliation, portfolio, Bitcoin address linking), audited ops commands and retention. Postgres (schema `app`, Drizzle, in `packages/db`) is the system of record; Redis backs rate limits; retention runs inside Postgres via pg_cron (ADR-006).

Layout: `src/app.ts` (configured express `app`), `src/server.ts` (listens), `src/env.ts` (envalid), `src/middleware/`, `src/routes/`, `src/services/`, `src/providers/` (Twilio, Resend, EVM RPC, Solana RPC and transactions, Bitcoin, LI.FI route provider, CoinMarketCap, R2), `src/ops/`. Errors are `http-errors` with a stable `code`; logging is winston via `@repo/logger` (set `LOG_LEVEL=http` to see request logs).

## Local setup

```bash
pnpm db:up                                  # Postgres (with pg_cron and pgvector) + Redis via Docker; after upgrading run `docker compose down -v` once
cp apps/api/.env.example apps/api/.env      # then fill in secrets
cp packages/db/.env.example packages/db/.env  # MIGRATOR_DATABASE_URL for migrations
openssl rand -hex 32                        # run twice: SESSION_TOKEN_PEPPER and OTP_HMAC_SECRET
pnpm --filter @repo/db db:migrate
pnpm --filter @repo/db db:dev-roles         # sets the local password for bytesac_api
pnpm --filter api dev
pnpm --filter api dev:worker                # BullMQ worker: price snapshots, performance, search index, embeddings (second terminal)
```

Provider keys (`ALCHEMY_API_KEY`, `RESEND_API_KEY`, `TWILIO_*`) are required by `src/env.ts`; placeholders are fine locally unless you exercise those paths. `ALCHEMY_API_KEY` also builds the Alchemy Solana endpoint (`https://solana-mainnet.g.alchemy.com/v2/<key>`) used to verify SPL mints. `COINMARKETCAP_API_KEY` is optional: when empty, market prices are reported as unavailable and everything else works.

## Supabase setup

1. Enable the `pg_cron` and `vector` (pgvector) extensions (Dashboard -> Database -> Extensions). Migration `0009_discovery.sql` runs `CREATE EXTENSION IF NOT EXISTS vector` and fails if the role cannot create it.
2. Run migrations with the project's `postgres` role as `MIGRATOR_DATABASE_URL` in `packages/db/.env` (`pnpm --filter @repo/db db:migrate`). Migration `0002` schedules the retention job when pg_cron is enabled. Specs 2 to 4 and 6 (baskets, migration `0008_baskets.sql`, which also seeds the platform disclosure templates) need no new Supabase extension, environment variable or provider. Ownership transfer is an ops action (an `ops_admin` on `/ops/organizations/<id>`), not a CLI command; invitation and member-verification emails use the existing Resend setup.
3. As an operator, run `ALTER ROLE bytesac_api LOGIN PASSWORD '<secret>'`.
4. Use the pooler URL with that role for `DATABASE_URL`.
5. Confirm schema `app` is **not** listed in Dashboard -> API -> Exposed schemas.

## Worker, discovery and AI search (Spec 7, ADR-012)

Discovery, model performance and search run on a BullMQ worker, a second process next to the API (`src/worker.ts`; ADR-006). Retention stays in pg_cron.

```bash
pnpm --filter api dev:worker     # tsx watch, loads .env
pnpm --filter api build && pnpm --filter api start:worker   # production: node dist/worker.js
```

- **Jobs:** `price-snapshot` daily at 00:05 UTC (CoinMarketCap, one batched request; idempotent), then `basket-performance`; `search-index-refresh` after basket, assignment, asset and profile changes (delayed to the end of a 10 s window); `embed-basket` and a 15-minute sweep (at most 5 attempts per basket). Default attempts 3 with exponential backoff; failed jobs stay in BullMQ's failed set.
- **Deployment:** run one or more worker instances (fixed scheduler ids keep each schedule single-run). They share `REDIS_URL` and the API's database role; no extra credential. Redis must not evict keys (`maxmemory-policy noeviction`). If the worker is down, only derived data (prices, performance, index, embeddings) goes stale; the API keeps working. Queue errors never fail an API request (they are logged and swallowed; the index catches up on the next change or nightly run).
- **pgvector:** the local Docker image installs `postgresql-17-pgvector` (run `docker compose down -v` once to rebuild); on Supabase enable the `vector` extension before migrating.
- **Gemini (optional):** `GEMINI_API_KEY` empty disables AI search and embeddings (structured and keyword search still work; baskets keep `embedding_status = pending`). `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite` and `GEMINI_EMBEDDING_MODEL` to `gemini-embedding-2` (768 dimensions). The defaults and tool calling were chosen from the Gemini documentation and have **not** been exercised against the real API: verify with a real key before launch, and confirm Google's data-use terms (query text is sent to Google; no user identity; queries are not stored or logged here).
- **New dependencies (pinned):** `bullmq` 6.3.10 and `@google/genai` 2.24.0 (newest versions allowed by pnpm's minimum release age at the time); their install scripts are disabled in `allowBuilds`.

## First investment and exit (Spec 8, ADR-014)

Operations run on the same worker as discovery: `track-leg` (after each submission: 12 attempts with 15 s exponential backoff, then `UNKNOWN`, re-checked hourly for up to 7 days; a recheck never throws, a dropped Solana transaction fails once its blockhash expired, and a 5-minute sweep picks up legs claimed but never confirmed as sent, turns SUBMITTED or PENDING_CHAIN legs older than 35 minutes whose job is missing into UNKNOWN, and cancels expired untouched plans (releasing their gas reservation); never resubmits), `reconcile-positions` (nightly at 02:30 UTC; also on `GET /v1/portfolio`, at most once a minute per user) and `gas-wallet-check` (every 15 minutes, warning logs; plans are also refused while a platform wallet cannot fund them). Ops resolve a leg stuck `UNKNOWN` with `POST /v1/ops/operations/:id/legs/:legId/resolve` (`ops_admin`; body `status` SETTLED or FAILED, `txEvidence`, `reason`, optional `amountReceived`; the server reads the chain and refuses what it cannot match). Migrations `0010_positions.sql` and `0011_positions_review_fixes.sql` adds the position, ledger, operation, leg, gas drop, platform wallet, sponsor usage and reconciliation tables (ledger and reconciliation history are SELECT and INSERT only for the runtime role).

**Environment** (all optional; empty disables the feature that needs it, see `.env.example`):

| Variable | Purpose |
|---|---|
| `LIFI_API_KEY`, `LIFI_INTEGRATOR` | LI.FI quotes, connections and status. Empty key: routing fails with `ROUTE_UNAVAILABLE`. Integrator defaults to `bytesac`. |
| `ROUTE_PROVIDER_ORDER` | Comma-separated provider ids, default `lifi` (the only provider). The ops registry must name the provider LI.FI on a deployment's execution route. |
| `SOLANA_FEE_PAYER_SECRET` | Base58 of the 64-byte secret key of the platform Solana fee payer. Empty disables Solana legs. |
| `EVM_GAS_WALLET_SECRET` | 0x-prefixed private key of the platform EVM gas wallet (same address on every EVM chain). Empty disables gas drops. |
| `GAS_TREASURY_SOLANA_ADDRESS` | Owner address of the platform USDC token account that receives network fees (created by the first fee transfer if missing; the platform pays the rent once). Empty disables the network fee leg. |
| `ALCHEMY_API_KEY` | Also builds the Alchemy Bitcoin host (balance, transaction, broadcast) and the Polygon host; enable Bitcoin and Polygon for the key. |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase service-account JSON (a secret, one line) for web push through FCM (`firebase-admin`). Empty disables push: the API and worker log a startup warning and only the inbox and email are used. A token FCM reports as unregistered or invalid is revoked. |

**Notifications (Spec 9):** the `notifications` queue carries three jobs: `deliver` (email through Resend and web push for one inbox row, gated by the user's `rebalance` / `portfolioUpdates` / `managerUpdates` preference; failures are logged and never thrown; it throws only while the row is not committed yet, so BullMQ retries), `version-published` (cancels the basket's `PLANNED` rebalance plans that nothing was sent for, releasing their gas, then tells every open holder once) and `basket-notice` (pause, resume, retirement pending, retired, lead changed, to holders of open positions). Every notice is deduplicated per user by a key. The nightly `reconcile-positions` job and the on-demand reconciliation also compare basket cash (USDC on Solana) with the cash entries, write each open position's allocation status (`WEIGHT_DRIFT` when a weight is at least the version's `driftThresholdBps`, default 500 bps, away from its target or from a keep-custom snapshot) and raise `repair_required` (a new shortfall) and `drifted` (at most one per position per 7 days while it stays drifted). Migration `0012_rebalance.sql` adds basket cash entries, position decisions, notifications and push tokens (cash entries and decisions are SELECT and INSERT only for the runtime role).

**Gas lifecycle:** reservations are released when an operation is cancelled or expires; at most 5 EVM gas drops per user per chain per day; token-account rent paid by the fee payer is counted in the reservation (a basket with many new Solana token accounts can reach the 0.02 SOL per-user cap). **Caps** are constants in native units in `src/services/gas.ts` (no env override yet): per user per day Solana 0.02 SOL and about $5 on each EVM chain; global per day about $200 per chain, assuming SOL $150, ETH $2,500, BNB $600, POL $0.20. Re-tune them there, and review them when prices move.

**Wallet funding and keys:** the Solana fee payer pays transaction fees (and the one-time treasury token account rent) for sponsored legs; the EVM gas wallet needs native gas on each EVM chain (Ethereum, Base, BNB Chain, Arbitrum, Polygon); `gas-wallet-check` warns when a balance falls below its floor (Solana 0.5 SOL, EVM 0.01 ETH, BNB 0.05, POL 10). The keys are plain env secrets here: put them in a KMS or HSM before launch, keep them out of logs (the modules never log them), and never reuse them elsewhere. These wallets must hold platform funds only.

**New dependencies (pinned exact, newest allowed by the minimum release age; no exclusions):** `@solana/web3.js` 1.99.0, `@scure/btc-signer` 2.4.1, `@noble/curves` 2.4.0, `@noble/hashes` 2.4.0.

**Manual mainnet checklist (a user action before launch; tests mock every provider):**

1. With a real `LIFI_API_KEY`, request an investability check and a small quote for each leg type (Solana swap, Solana to EVM, Solana to Bitcoin, and the reverse sells): confirm the quote echoes `toAddress`, `svmSponsor` works, and the Solana and Bitcoin transaction encodings parse.
2. Link a Bitcoin address with each wallet you support (BIP-322 `signPSBT`, then BIP-137 fallback); confirm Taproot and P2SH-P2WPKH behaviour.
3. Invest a small amount in a Solana-only basket, then a mixed one, with Phantom and Solflare: confirm a wallet that adds guard instructions is refused with `TX_MISMATCH` and nothing is sent.
4. Confirm the Alchemy Bitcoin `/tx` and `/sendtx` shapes (a Bitcoin sell leg).
5. Sell part of a position, stop an operation midway, leave a basket and sell the former assets; check `track-leg` reaches `SETTLED` and the ledger and portfolio match the wallets.
6. Also try: an EVM sell with and without the fee in USDC on Solana (refused without; the gas top-up only follows a settled fee); a Solana-only sell without USDC (fee last); a stuck leg and the ops resolve call; a plan refused when a gas wallet is empty.
7. Fund the platform wallets, confirm the caps and `gas-wallet-check` warnings behave, and have the network fee and self-custody flows legally reviewed.

## Cloudflare R2 (organization documents)

Organization verification documents are private and live in one R2 bucket (ADR-008). The API never streams files: it signs short-lived URLs. Every step below is a user action; the API refuses to start without the four `R2_*` variables.

1. Create a bucket (keep public access off; no custom domain or `r2.dev` URL).
2. Create an R2 API token with Object Read & Write scoped to that bucket, and note the account id, access key id and secret.
3. Add a CORS rule on the bucket allowing `PUT` from every web origin (for example `https://app.bytesac.example` and `http://localhost:3000`), with allowed header `Content-Type`. No other methods or wildcard origins are needed.
4. Add a lifecycle rule that deletes objects under the prefix `incoming/` after 1 day. Unconfirmed uploads land there; confirmed files are copied to `documents/`.
5. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` in `apps/api/.env` (see `.env.example`).

Automated tests use a fake R2 client. A manual check against a real bucket is still pending: upload a PDF from `/organization` (CORS, signed `Content-Length`, confirm), then download it as a reviewer from `/ops/organizations/<id>`.

## Tests

```bash
pnpm --filter api test    # requires Docker (pnpm db:up)
```

## Retention

`pg_cron` runs the `bytesac-retention` job daily at 03:00 UTC (`select app.purge_expired()`). It purges expired auth challenges (kept when referenced by a wallet address), old sessions and contact verifications, application email codes resolved more than 90 days ago and unconfirmed (`EMAIL_PENDING`) manager applications older than 24 h with their codes and events, and writes a `retention.purged` audit event. Check runs in `cron.job_run_details`. Without the extension the schedule is skipped; run `select app.purge_expired()` as the schema owner to purge manually.

## Ops commands

An operator identity (`--operator`) and a reason are required; every command is audited.

```bash
pnpm --filter api ops:address-disable -- --chain base --address 0xabc... --reason "fraud report" --operator alice@bytesac.example
pnpm --filter api ops:address-reactivate -- --chain base --address 0xabc... --operator alice@bytesac.example
pnpm --filter api ops:user-suspend -- --user <user-uuid> --reason "compliance hold" --operator alice@bytesac.example
pnpm --filter api ops:grant-role -- --user <user-uuid> --role ops_admin --operator alice@bytesac.example   # bootstrap the first ops admin; later roles are managed in /ops/roles
```

## Security notes

- No CORS: browsers are not a supported cross-origin client. Web uses same-site cookies; mobile uses bearer tokens.
- Cookie-authenticated mutating requests require the CSRF client header (see `src/middleware/security.ts`).
- Session cookie is HttpOnly and `Secure` in production (`COOKIE_SECURE`).
- `TRUST_PROXY` controls how the client IP is derived (rate limits, audit). In production behind a load balancer or CDN, set the hop count (for example `TRUST_PROXY=1`); a wrong value lets clients spoof their IP. Digits are a hop count, `true`/`false` a boolean, anything else an IP/CIDR/keyword list.
- **Deployment requirement (X-Forwarded-For):** the Next.js rewrite in `apps/web` neither sets nor sanitizes `X-Forwarded-For`. The edge/load balancer must **overwrite** `X-Forwarded-For` with the real client IP (never append to a client-supplied value), and `TRUST_PROXY` must trust only the Next server hop (its private CIDR, or loopback when co-located), not the whole chain. Otherwise per-IP rate limits and the session `ip_prefix` are spoofable, or collapse into one global bucket.
- Never log secrets, OTP codes, tokens, or full contact values.
- Wallet sign-in is authentication only; it is not spending authorization.

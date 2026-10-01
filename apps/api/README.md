# Bytesac API

## Overview

Express 5 + TypeScript API for Bytesac (initial settlement currency: USDC on Solana). This foundation covers wallet sign-in (SIWE/SIWS challenge and verify), sessions, linked chain accounts, contact verification (email and SMS OTP), notification preferences, manager applications and platform screening (public apply/status endpoints, `/v1/ops` for reviewers and admins, platform roles and the wallet-proof permission grant), organization onboarding (owner drafts, private documents in Cloudflare R2, payout wallet proof, `/v1/ops/organizations` review, public profile), organization members (invitations linked by wallet proof, fixed permission matrix, member verification and `/v1/ops/members` review, ops-only ownership transfer, public team), the asset registry (ops `/v1/ops/assets` drafting, on-chain deployment verification, review and lifecycle, CoinMarketCap prices, session read API `/v1/assets`), audited ops commands and retention. Postgres (schema `app`, Drizzle, in `packages/db`) is the system of record; Redis backs rate limits; retention runs inside Postgres via pg_cron (ADR-006).

Layout: `src/app.ts` (configured express `app`), `src/server.ts` (listens), `src/env.ts` (envalid), `src/middleware/`, `src/routes/`, `src/services/`, `src/providers/` (Twilio, Resend, EVM RPC, Solana RPC, CoinMarketCap, R2), `src/ops/`. Errors are `http-errors` with a stable `code`; logging is winston via `@repo/logger` (set `LOG_LEVEL=http` to see request logs).

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

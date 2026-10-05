# System Architecture

**Product:** Bytesac, a manager-led multi-chain basket investing platform. Initial settlement currency is **USDC on Solana**; additional currencies are future work and must be added through explicit currency and settlement-asset configuration, never hard-coded as the only option.

Decisions live in `docs/decisions/` (register plus ADRs); product behavior in `docs/domains/`; conventions in `docs/engineering/CODING-STANDARDS.md`; open work in `docs/OPEN-ITEMS.md`.

## 1. Principles

1. **Separate identity from organization.** User, manager application, organization, membership, permission and payout wallet are distinct concepts.
2. **Strategy is not execution.** A basket version is a target; each user's operation is planned and authorized separately, and a manager's publication is never user consent.
3. **Self-custody.** Assets stay in the user's own wallets; the platform holds no keys or funds and the user signs every value-moving transaction (ADR-013). Wallet authentication is not spending authorization.
4. **Instrument, deployment and route are different.** One economic instrument may have several chain deployments and several ways to acquire or sell it (ADR-010).
5. **Policy is contextual.** Eligibility depends on user, instrument, route, jurisdiction and action (ADR-018).
6. **Ownership and allocation differ.** Wallet balances do not reveal basket attribution; positions are a logical sub-ledger reconciled against chain state, and chain evidence (not provider webhooks or estimates) is the proof of holdings.
7. **Auditable financial state.** Operations, legs, ledger entries and approvals are append-only or status-driven; nothing financial is deleted.
8. **Provider independence.** External services sit behind adapters in `providers/`; internal models are normalized.
9. **Modular monolith** (ADR-001): isolate boundaries in code (feature modules), not in services.
10. **Keep currencies distinct:** display currency, settlement currency, on-chain settlement asset and instrument price reference are separate concepts; a future currency must define conversion source, freshness, rounding, fees, network and consent.

## 2. Runtime

```text
 Web (Next.js 16)        Mobile (Expo 57)
        \                      /
         \  /api/* rewrite    /  bearer + X-Client: mobile
          +--------------------+
                  API  (apps/api, Express 5)            Worker (BullMQ, same codebase)
   app.ts -> middlewares -> modules/<feature>/*.route -> controller -> service -> @repo/db
                  |                                              |
        providers/ (LI.FI, Alchemy RPC, Solana, Bitcoin,         +-- Redis (BullMQ queues, rate limits, cache)
        CoinMarketCap, Gemini, Resend, Twilio, FCM, R2)          +-- PostgreSQL (Supabase; pg_cron retention, pgvector)
```

- **API** (`apps/api/src`): `app.ts` builds the express app (request context, security guards, JSON, cookies, morgan into `logger.http`, routers under `/v1/*`, one error handler); `server.ts` `startServer()` listens and, on SIGINT/SIGTERM, stops accepting, closes the HTTP server, BullMQ queues, Redis and the DB pool, then exits 0 (a startup or listen failure, or a shutdown over 10 s, logs and exits 1; a second signal is ignored). `ops/cli.ts` is the ops-only CLI (address disable, user suspend, role grant); it must not import provider modules.
- **Worker** (`worker.ts`, `pnpm --filter api start:worker`): one BullMQ worker per queue with fixed scheduler ids so schedules run once across instances, and the same graceful shutdown. Queues: `price-snapshot` (daily 00:05 UTC), `basket-performance`, `search-index-refresh`, `embed-basket` (sweep every 15 min), `track-leg` (claims sweep every 5 min), `reconcile-positions` (nightly 02:30 UTC), `gas-wallet-check` (15 min), `revenue-reconcile` (daily 04:00 UTC) and `notifications` (`deliver`, `version-published`, `basket-notice`). It needs Redis without eviction. Jobs never move money or user balances; they read chain state, write evidence and notify (ADR-006, ADR-012).
- **Config** (`config/`): `dotenv.ts` validates env with envalid (the only place that reads `process.env`), `queues.ts` holds the BullMQ queues and `enqueue` (which swallows and logs queue errors so a committed change never fails).
- **Middlewares** (`middlewares/*.middleware.ts`): `auth` (`requireSession`, `optionalSession`, `requireRole` for platform roles), `validate` (Zod), `rate-limit` (rate-limiter-flexible on Redis), `request-context` (request id, plus the `ctx` / `opsCtx` helpers controllers pass to services), `security` (`noCors`, `rejectDualAuth`, `csrfGuard`: Origin plus `X-Requested-With: bytesac` on cookie mutations), `error-handler` (one central handler: `{ error: { code, message, details? } }`, plus redacted request-context logging).
- **Providers** (`providers/`): LI.FI behind `RouteProvider` (`routes/`), `solana-tx`, `solana-rpc`, `evm-rpc`, `bitcoin` (BIP-322/137 verification, PSBT checks, Alchemy Bitcoin REST), `coinmarketcap`, `gemini`, `resend`, `twilio`, `fcm`, `r2`. Provider SDKs never appear outside this folder; `modules/auth/wallets.service` stays free of provider imports so the ops CLI starts without provider keys.
- **Modules** (`modules/<feature>/`): files are `<feature>.route.ts`, `<feature>.controller.ts`, `<feature>.service.ts` (large features keep several services; variants add `.me`, `.org`, `.public`, `.ops`). A module calls another only through its `*.service.ts`. Modules: `assets`, `audit`, `auth`, `baskets`, `contacts`, `discovery`, `eligibility`, `fees`, `health`, `manager-applications`, `me`, `members`, `notifications`, `operations`, `ops` (composes every `*.ops.route`), `organizations`, `portfolio`, `preferences`, `public` (composes `*.public.route`), `rebalance` (service only), `routing`.
- **Web** (`apps/web`): Next.js App Router; routes `sign-in`, `onboarding`, `(app)` (home, profile, portfolio, organization, notifications), `(ops)`, `baskets`, `managers`, `organizations`, `fees`; calls the API only through the same-origin `/api/*` rewrite with the httpOnly `bx_session` cookie; Reown AppKit (wagmi, Solana, Bitcoin adapters); Firebase web push.
- **Mobile** (`apps/mobile`): Expo SDK 57 / React Native 0.86 / Expo Router / NativeWind; bearer token in `expo-secure-store`; Reown AppKit RN behind one `useWalletConnector` hook. Tabs Home, Discover, Portfolio, Alerts and Profile with stack screens for basket, asset, organization, manager, position, activity, invest, operation, rebalance, repair and sell (investor parity with the web; manager and ops are web-only). Solana and EVM legs are signed through AppKit RN; a Bitcoin leg or Bitcoin linking hands off to the web (`EXPO_PUBLIC_WEB_URL`). Push uses `expo-notifications` and the Expo push service (ADR-020).
- **Packages** (TypeScript source, no build step, extensionless imports): `@repo/db` (Drizzle schema `app`, client, migrations, test helpers), `@repo/validator` (Zod re-export, chains, error codes and HTTP map, request/response schemas, permission matrix), `@repo/api-client` (typed client), `@repo/app-core` (client logic shared by web and mobile: the `legSigner` state machine over a platform `Signer`, fee lines, portfolio actions, sync-split validation, eligibility copy, formatters; each app supplies only its `Signer` and UI), `@repo/logger` (winston), `@repo/design-tokens` (light/dark theme roles, radius, motion, brand artwork; the legacy palette export is unused), `@repo/eslint-config`, `@repo/typescript-config`.
- **Data stores:** PostgreSQL (source of truth; role `bytesac_api` with DML and no DELETE, RLS, retention by `app.purge_expired()` under `pg_cron`; ADR-005, ADR-006), Redis (queues, rate limits, 60 s price cache; per-chain gas locks are Postgres advisory locks), Cloudflare R2 (private documents).

## 3. Domain components

| Component | Responsibility | Decisions |
|---|---|---|
| Identity and access | Users, wallets, chain accounts (EVM, Solana, linked Bitcoin), backend sessions, contacts, preferences | ADR-003, ADR-004 |
| Manager application and organization | Public application, ops screening, organizations with versioned profiles, payout wallet, ops review | ADR-007, ADR-008 |
| Members and roles | Fixed permission matrix, invites by wallet proof, member verification, ownership transfer, public team | ADR-009 |
| Asset registry | Instruments, deployments, routes, rules, price references, on-chain verification, lifecycle | ADR-010, ADR-002 |
| Baskets | Versioned baskets, review, publication, assignments, disclosures, public pages | ADR-011 |
| Discovery | Search index, AI search, simulated performance, manager profiles | ADR-012 |
| Operations (execution) | Plans of legs, LI.FI quotes, signing support, gas sponsorship, tracking, recovery | ADR-013, ADR-014, ADR-017 |
| Portfolio | Position ledger, reconciliation, valuation, drift, repair, sync, basket cash | ADR-014, ADR-015 |
| Rebalance and notifications | Apply/skip versions, drift fix, inbox, email, web push, adoption counts | ADR-015 |
| Fees | Manager and platform fees, combined fee leg, earnings, revenue reconciliation | ADR-016 |
| Eligibility | Declarations, rule engine, enforcement, decision audit | ADR-018 |

## 4. Core flows

- **Invest or exit:** investability and eligibility checks, then a plan of legs (fee leg first, then swap or cross-chain legs, routed by LI.FI to the user's own addresses); the user signs one leg at a time against a fresh 60 s quote; Solana legs are co-signed by the platform fee payer only when byte-identical to the provider message; each leg is tracked on chain to `SETTLED`, `FAILED` or `UNKNOWN`; the ledger is written only from chain evidence. Leg states `PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`; operations may end `PARTIAL`; unknown outcomes are reconciled, never blindly retried.
- **Rebalance:** the manager publishes a reviewed version; the holder applies (a new plan from reconciled holdings, sells to USDC on Solana then buys) or skips; nothing moves without the holder's signature. Drift, shortfalls (Buy back or Sync) and repair are separate actions (ADR-015).
- **Manager path:** apply, ops screening, sign-in with the proven wallet, organization draft and verification, invites, basket drafts, ops review, publication.
- **Before any execution:** reconcile positions, confirm target version and intent, re-evaluate eligibility and routes, recompute if inputs changed, serialize shared assets (one active operation per user), execute idempotently with per-leg state, reconcile the final state.

## 5. Persistence (indicative; migrations in `packages/db/migrations` are authoritative)

- Identity: `users`, `investment_wallets`, `wallet_addresses`, `auth_challenges`, `sessions`, `contacts`, `contact_verifications`, `notification_preferences`, `platform_roles`, `user_permissions`.
- Onboarding: `manager_applications` (+ events, email codes), `organizations`, `organization_versions`, `organization_documents`, `verification_requirement_templates`, `organization_memberships`, `member_verifications`, `organization_payout_wallets`, event tables.
- Registry: `asset_issuers`, `asset_providers`, `instruments`, `instrument_deployments`, `execution_routes`, `eligibility_rules`, `price_references`, `nav_observations`, `asset_events`, `asset_tags`, `instrument_tags`, `route_policy_entries`.
- Baskets and discovery: `baskets`, `basket_slug_aliases`, `basket_versions`, `basket_version_assets` and `basket_version_disclosures` (revisioned), `disclosure_templates`, `basket_assignments`, `basket_reviews`, `basket_events`, `manager_profiles`, `instrument_price_snapshots`, `basket_performance_days`, `basket_search_index`.
- Execution and portfolio: `operations`, `operation_legs`, `operation_fees`, `gas_drops`, `platform_wallets`, `sponsor_usage`, `basket_positions`, `position_ledger_entries`, `position_cash_entries`, `position_reconciliations`, `position_decisions` (ledgers are append-only), `eligibility_declarations`, `eligibility_decisions`, `platform_fee_schedules`, `notifications`, `push_tokens`.
- `audit_events` is append-only with no foreign keys so audit history survives any change to referenced rows. Retention purges run inside Postgres (`app.purge_expired()` daily via `pg_cron`, writing `retention.purged`).
- Money and token quantities are exact integers in base units or `numeric`; never floating point. Foreign keys, unique, check constraints and indexes enforce invariants in the database.
- Not built: `outbox_events`, generic `idempotency_records` (idempotency is per feature), valuation snapshots, a separate activity feed.

## 6. Stack

| Concern | Choice |
|---|---|
| Monorepo | Turborepo + pnpm, exact dependency pins, no `minimumReleaseAgeExclude` |
| Web | Next.js 16 App Router, React, Tailwind v4, shadcn/ui |
| Mobile | Expo 57, RN 0.86, `jest-expo` |
| API | Node, Express 5, TypeScript, tsup bundle, `tsx` in dev |
| Data | Supabase PostgreSQL, Drizzle + Drizzle Kit, pgvector, pg_cron |
| Jobs and limits | BullMQ, Redis, rate-limiter-flexible |
| Validation and errors | Zod (`@repo/validator`), `http-errors` with stable `code`, envalid, winston + morgan |
| Auth | Backend sessions, SIWE (EVM), SIWS (Solana), BIP-322/137 (linked Bitcoin), Reown AppKit |
| Chain data and routing | Alchemy behind adapters; LI.FI only behind `RouteProvider`; `@solana/web3.js` 1.99.0, `@scure/btc-signer`, `@noble/*`, viem |
| Prices and AI | CoinMarketCap; Gemini via `@google/genai` (forced function calling, 768-dim embeddings, optional key) |
| Messaging | Resend (email OTP and notifications), Twilio Verify (SMS OTP), Firebase Cloud Messaging web push (registration tokens today, Installation IDs later), Expo push service for mobile (ADR-020) |
| Files | Cloudflare R2 through `@aws-sdk/client-s3` in `providers/r2.ts` |
| Tests | Vitest and Supertest (api, web, packages), jest-expo (mobile) |

Provider capabilities, supported chains, limits and terms must be checked against current official documentation before implementation or release (Spec 14 audits them).

## 7. Security and operations

- Backend authorization on every protected route; UI hiding is never enforcement.
- Verify wallet signatures and consume nonces once; keep secrets and signing material out of client bundles; separate authentication, permission grants and spend authority.
- Idempotency keys for user operations and event handlers; claim a leg (`SUBMITTING`) before sending anything.
- Handle unknown outcomes, timeouts, partial fills and reorgs; reconcile after execution and periodically; keep audit history.
- Client IP integrity: the Next rewrite does not sanitize `X-Forwarded-For`; the edge must overwrite it with the real client IP and `TRUST_PROXY` must trust only the Next hop, otherwise per-IP limits and session `ip_prefix` are spoofable.
- Eligibility geo signal: `GEO_COUNTRY_HEADER` names a header with the client country; it is trusted only when set, so the edge must overwrite it on every request.
- Mobile wallet connectors keep their dapp keypair in AsyncStorage; the Bytesac session token lives in the OS secure store; every signature needs explicit wallet approval.
- Discovery needs pgvector and a running worker with non-evicting Redis; retention needs `pg_cron` (monitor `cron.job_run_details`).
- Least privilege, rate limits, monitoring, backups and restore drills; legal review per jurisdiction for custody, RWA distribution and fees.

## 8. Open decisions

Tracked in `docs/OPEN-ITEMS.md` §3, §4 and §8 and the register's `OPEN` statuses: real-key verification of LI.FI coverage and gas caps, platform fee rates and legal review, bridging per RWA, issuer routes, price-source hierarchy and fallback, threshold tuning, supported chains per release, real eligibility rule values and attestation wording, KYC vendor. Do not assume any of them.

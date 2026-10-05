# Deploying Bytesac

How to take this repository from a local checkout to a running environment. Bytesac has **not been deployed yet**. Hosting vendors (API, worker, web, CI/CD) are still open — Spec 16. This document records the **constraints the product already imposes**, so a later hosting choice cannot silently violate them.

Do not create cloud resources, push images, or put real secrets into a live environment without an explicit go-ahead. Do not move real assets, sign, or broadcast transactions as part of a deploy.

Related: root [`README.md`](../../README.md) (local setup), [`apps/api/README.md`](../../apps/api/README.md) (providers, wallets, mainnet checklist), [`OPEN-ITEMS.md`](../OPEN-ITEMS.md) (accounts still to create), [`architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md).

---

## 1. Status

| Item | State |
|---|---|
| Product specs 1–15 | Implemented on `main` |
| Production / staging deploy | Not done |
| Docker images for API, worker, web | Not in the repo (local Compose only starts Postgres + Redis) |
| GitHub Actions CI/CD | Not in the repo |
| Hosting vendors | **Not chosen.** Postgres is specified as Supabase (ADR-005 / ADR-006). Object storage is Cloudflare R2. Mobile builds are EAS. API, worker, web, and Redis are still open. |

Until Spec 16 lands, treat this file as the contract a deployment must satisfy, not as a click-through for a named cloud.

---

## 2. Prerequisites

### 2.1 Tools (every environment)

| Tool | Version | Why |
|---|---|---|
| Node.js | ≥ 24 | Root `package.json` `engines` |
| pnpm | 11.25.0 | `packageManager` field; enable with `corepack enable` |
| Docker + Compose | current | Local Postgres 17 (pg_cron + pgvector) and Redis 7; production image builds later |
| Git | any recent | |
| `openssl` or Node | — | Generate `SESSION_TOKEN_PEPPER` and `OTP_HMAC_SECRET` (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`) |

For **native mobile** development builds you also need Android Studio and/or Xcode, plus the [EAS CLI](https://docs.expo.dev/eas/) (`npx eas-cli@latest`). Expo Go cannot run this app (native wallet modules).

### 2.2 Infrastructure capabilities (production)

These are not optional if you intend to run the real product:

| Capability | Requirement | If missing |
|---|---|---|
| PostgreSQL 17 | Extensions **`pg_cron`** and **`vector` (pgvector)**; a schema-owner role for migrations and a least-privilege runtime role `bytesac_api` with DML and **no `DELETE`**; schema `app` **not** exposed on any PostgREST/API gateway | Migrations fail; discovery embeddings fail; retention never runs; financial history can be destroyed |
| Redis 7 | **`maxmemory-policy noeviction`** (BullMQ). Shared by the API (rate limits, 60 s price cache) and the worker (queues) | Jobs stall or vanish; rate limits fail closed |
| Object storage | Private Cloudflare R2 bucket, S3 API, no public access | API will not start (`R2_*` are required) |
| TLS termination + reverse proxy | Overwrite `X-Forwarded-For`; optionally set a country header named by `GEO_COUNTRY_HEADER` after stripping any client value | Per-IP limits and session `ip_prefix` are spoofable; eligibility geo is attacker-chosen |
| Process model | **Two Node processes** from `apps/api`: HTTP server (`node dist/server.js`) and BullMQ worker (`node dist/worker.js`). They share `DATABASE_URL` and `REDIS_URL` | Discovery, prices, tracking, notifications, and reconciliation stop while the API still answers |
| Same-origin web | Next.js 16 app that rewrites `/api/*` to the API. Browsers are **not** a CORS client | Cookie sessions and CSRF fail |

### 2.3 Accounts and keys (user actions)

Tracked in [`OPEN-ITEMS.md`](../OPEN-ITEMS.md) §1–§2. Create these before a real environment:

| Account | Used for | Required to boot? |
|---|---|---|
| **Reown (WalletConnect) Cloud** project | Web and mobile wallet connect (`NEXT_PUBLIC_REOWN_PROJECT_ID`, `EXPO_PUBLIC_REOWN_PROJECT_ID`) | Web/mobile wallets; API itself does not need it |
| **Supabase** project | Production Postgres | Yes, for any hosted API |
| **Cloudflare R2** | Private documents, logos, basket files | Yes (API refuses to start without `R2_*`) |
| **Alchemy** | EVM, Solana, Bitcoin RPC. Enable BNB, Arbitrum, Polygon, Solana; Bitcoin REST needs the **UTXO add-on** | Config-required; placeholder works until you hit chain paths |
| **Resend** | Email OTP and notifications; verified sender domain | Config-required |
| **Twilio Verify** | SMS OTP; allow-list countries in `SMS_ALLOWED_COUNTRIES` | Config-required |
| **LI.FI** | Quotes, routes, status. Empty key → every route is `ROUTE_UNAVAILABLE` | Optional to boot; required to invest |
| **CoinMarketCap** | Crypto and RWA market prices. Empty → prices `unavailable` | Optional |
| **Google Gemini** | AI search and 768-dim embeddings. Empty → keyword/structured search only | Optional |
| **Firebase** | Web push (`FIREBASE_SERVICE_ACCOUNT` on the API; `NEXT_PUBLIC_FIREBASE_*` on the web) | Optional |
| **Expo / EAS** | Mobile store and development builds; push credentials (FCM v1 + APNs); optional `EXPO_ACCESS_TOKEN` | Mobile only |
| **Platform Solana fee-payer keypair** | Co-signs sponsored Solana legs | Required to execute Solana legs |
| **Platform EVM gas wallet** | One native-gas drop per EVM leg, same address on every EVM chain | Required to execute EVM legs |
| **Gas treasury** (Solana address) | Receives the user-signed network-fee USDC | Required for the fee leg |
| **Revenue treasury** (Solana address, **must differ** from gas treasury) | Receives platform fees | Required once any platform fee &gt; 0 |

**Never commit real secrets.** Platform wallet keys must move to a KMS or HSM before launch. Keep them out of client bundles, logs, and CI transcripts.

---

## 3. What you deploy

```text
                    ┌─────────────────────────────┐
  browsers ─────────►  Web (Next.js 16)           │  same-origin /api/* rewrite
                    │  COOKIE bx_session          │
                    └────────────┬────────────────┘
                                 │ HTTP to API (TRUST_PROXY = Next hop only)
                    ┌────────────▼────────────────┐
  mobile ───────────►  API  Express 5             │  bearer + X-Client: mobile
                    │  GET /health                │
                    │  /v1/*                      │
                    └─┬─────────────────────────┬─┘
                      │                         │
                      │                    ┌────▼─────────────┐
                      │                    │ Worker (BullMQ)  │  same image, different entry
                      │                    └────┬─────────────┘
                      │                         │
              ┌───────▼────────┐       ┌────────▼────────┐
              │ PostgreSQL 17  │       │ Redis 7         │
              │ schema app     │       │ noeviction      │
              │ role bytesac_api│      └─────────────────┘
              │ pg_cron, vector│
              └────────────────┘
                      │
              ┌───────▼────────┐
              │ Cloudflare R2  │  private bucket
              └────────────────┘
```

| Process | Package | Dev command | Production entry | Role |
|---|---|---|---|---|
| API | `apps/api` | `pnpm --filter api dev` | `node dist/server.js` after `pnpm --filter api build` | HTTP, planning, signing support, ops |
| Worker | `apps/api` | `pnpm --filter api dev:worker` | `node dist/worker.js` | Queues only; **never moves user money** |
| Web | `apps/web` | `pnpm --filter web dev` | `pnpm --filter web build` then `next start` (or the host’s Next adapter) | Marketing, investor, manager, ops UI |
| Mobile | `apps/mobile` | Expo dev client | EAS build (store / internal) | Investor app; manager and ops are web-only |

The API and worker are a **modular monolith** (ADR-001): one codebase, two processes. Do not split them into separately versioned services.

---

## 4. Hosting constraints (vendor-agnostic)

When Spec 16 picks hosts, they must satisfy:

1. **API and worker run Node 24** and the tsup output in `apps/api/dist`. Health is `GET /health` (200 when Postgres and Redis answer, 503 `degraded` otherwise). Both processes shut down on `SIGINT`/`SIGTERM` (stop accepting, close HTTP, close BullMQ queues, quit Redis, end the DB pool, exit 0; a shutdown over 10 s exits 1).
2. **Web is the only browser origin.** Set `AUTH_DOMAIN`, `AUTH_URI`, `ALLOWED_ORIGINS`, and `NEXT_PUBLIC_APP_URL` to that origin. There is no CORS. The Next rewrite proxies `/api/:path*` to `API_ORIGIN/:path*` and **does not** sanitize `X-Forwarded-For`.
3. **Postgres is Supabase** (ADR-005, ADR-006) unless a later ADR changes that. Enable `pg_cron` and `vector` **before** migrating. Use the project `postgres` role as `MIGRATOR_DATABASE_URL`. Use the pooler URL as `DATABASE_URL` for role `bytesac_api`. Do not expose schema `app` in the Supabase API settings.
4. **Redis must not evict.** BullMQ stores job state in Redis; an allkeys-lru cache will lose schedules and in-flight tracking.
5. **One or more worker replicas are fine.** Scheduler ids are fixed, so each repeating job runs once across instances. They need the same Redis and the same DB role as the API. No extra credential.
6. **Cookie `Secure` in production** (`COOKIE_SECURE=true`). `TRUST_PROXY` must trust **only the Next hop** (hop count `1` if Next is the sole proxy in front of the API, or the Next CIDR / loopback if co-located) — not the entire forwarded chain.
7. **Secrets stay server-side.** `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` are public. Platform keys, HMAC peppers, Twilio, R2, Firebase service account, and Alchemy stay on the API/worker.
8. **Do not run two API test suites against one test database** in CI. Production has no such restriction, but CI must serialize `pnpm --filter api test`.

Suggested (not decided) split from the roadmap: API + worker on a container host (Fly / Render / Railway / ECS / Cloud Run), web on Vercel or a container, Postgres on Supabase, Redis managed, R2 on Cloudflare, mobile on EAS. Confirm with the product owner before creating anything.

---

## 5. PostgreSQL (Supabase)

Step-by-step for a hosted database. Local Docker is in the root README.

1. Create a Supabase project (region close to the API).
2. Dashboard → Database → Extensions: enable **`pg_cron`** and **`vector`**.
3. Create the runtime role after the first migration has defined it, or as documented in `apps/api/README.md`:
   ```sql
   ALTER ROLE bytesac_api LOGIN PASSWORD '<runtime-secret>';
   ```
   The runtime role is granted DML without `DELETE`. Do not use the `postgres` role as `DATABASE_URL`.
4. In `packages/db/.env` set `MIGRATOR_DATABASE_URL` to the **direct** connection of the schema owner (`postgres`).
5. Run migrations as a **release step**, not from a running API replica:
   ```bash
   pnpm --filter @repo/db db:migrate
   ```
   Migration `0002` schedules `app.purge_expired()` daily at 03:00 UTC when pg_cron is present. Migration `0009` creates the vector extension and fails if the role cannot `CREATE EXTENSION`.
6. Point the API and worker `DATABASE_URL` at the **pooler** URL as `bytesac_api`.
7. Dashboard → API → Exposed schemas: confirm **`app` is not listed**.
8. Monitor `cron.job_run_details` for the `bytesac-retention` job. Without pg_cron, run `SELECT app.purge_expired();` as the schema owner by hand.
9. Backups and restore drills are an operator duty before launch. The runtime role cannot delete financial history; a restore is the recovery path.

At scale, choose an ivfflat or hnsw index for pgvector ([`OPEN-ITEMS.md`](../OPEN-ITEMS.md) §6). Sequential scan is acceptable pre-launch.

Set a role-level `statement_timeout` on `bytesac_api` in production (open config check).

---

## 6. Redis

- One instance (or a non-evicting clustered setup BullMQ supports) shared by API and worker.
- Database index 0 for runtime (`REDIS_URL`); tests use index 1 locally (`TEST_REDIS_URL`).
- **`maxmemory-policy noeviction`**. If Redis is down after the first successful connection, producers fail fast (`enableOfflineQueue: false`); `enqueue` logs and does not fail the HTTP request. A process started with Redis down waits for the first connection.
- Persistence (AOF/RDB) is an operator choice; losing Redis loses queue state and rate-limit counters, not the system of record.

---

## 7. Cloudflare R2

The API never streams files; it signs short-lived URLs. It **will not start** without all four `R2_*` variables.

1. Create a bucket. Public access off. No custom domain or `r2.dev` URL.
2. Create an R2 API token with Object Read & Write scoped to that bucket. Note account id, access key, secret.
3. CORS: allow `PUT` from every **web origin** (production origin and `http://localhost:3000`), header `Content-Type` only. No other methods, no `*` origin.
4. Lifecycle: delete objects under prefix `incoming/` after 1 day (unconfirmed uploads). Confirmed objects live under `documents/`.
5. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` on the API (and worker, same env).

Logos and basket PDFs use the same bucket with presign → server-side byte check → signed read. Organization documents are not malware-scanned in release 1 (`not_scanned`).

---

## 8. API and worker

### Build

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm --filter api build    # writes dist/server.js and dist/worker.js
```

### Run

```bash
node dist/server.js        # from apps/api, with env loaded by the host
node dist/worker.js
```

Use the host’s secret store / env injection. Do not copy `.env` files into images.

### Worker jobs

| Queue | Schedule / trigger | Purpose |
|---|---|---|
| `price-snapshot` | Daily 00:05 UTC | CoinMarketCap snapshot (one batched request) |
| `basket-performance` | After snapshots | Simulated buy-and-hold series |
| `search-index-refresh` | On change (10 s debounce) + catch-up | Discovery index |
| `embed-basket` | Sweep every 15 min | Gemini embeddings (no-op without a key) |
| `track-leg` | After submit; sweep every 5 min | Chain tracking; never resubmits |
| `reconcile-positions` | Nightly 02:30 UTC; also on portfolio read | Holdings vs chain |
| `gas-wallet-check` | Every 15 min | Warns when platform wallets are low |
| `revenue-reconcile` | Daily 04:00 UTC | Settled platform fees vs treasury inflows |
| `notifications` | After commit | Inbox fan-out to email / FCM / Expo push |

If the worker is down, the API still serves. Derived data (prices, performance, search, embeddings, tracking, notifications) goes stale. That is a launch blocker, not an acceptable steady state.

### Health

`GET /health` → `{ status: "ok" | "degraded", db, redis }`. Use it as the load-balancer probe on the API. The worker has no HTTP port; probe process liveness and Redis/Postgres from the host or from logs.

### Scaling

- API: scale horizontally behind the proxy. Sessions are in Postgres, rate limits in Redis.
- Worker: scale horizontally; keep Redis non-evicting. Do not run the worker as a cron on a laptop.
- Never run migrations from every replica; run them once per release.

---

## 9. Web (Next.js 16)

```bash
# apps/web
API_ORIGIN=https://<api-host>          # server-only; rewrite target
NEXT_PUBLIC_APP_URL=https://<web-origin>
NEXT_PUBLIC_REOWN_PROJECT_ID=<reown>
# optional web push
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_VAPID_KEY=
# optional store badges; unset → "Coming soon"
NEXT_PUBLIC_IOS_APP_URL=
NEXT_PUBLIC_ANDROID_APP_URL=
```

`NEXT_PUBLIC_APP_URL` is also the Reown AppKit metadata URL. It must be the real public origin before wallets are used in production.

Security headers are set in `apps/web/next.config.js` (HSTS, frame deny, nosniff, Permissions-Policy). CSP is **report-only** with no report endpoint; collect violations, then promote to enforcing ([`OPEN-ITEMS.md`](../OPEN-ITEMS.md) §6).

### Edge in front of Next (required)

1. Terminate TLS.
2. **Overwrite** `X-Forwarded-For` with the real client IP. Do not append to a client-supplied value.
3. If `GEO_COUNTRY_HEADER` is set on the API (for example `CF-IPCountry`), the edge must **strip any client-supplied value** of that header and set it from its own geo database. Unset on the API means eligibility has no geo signal.

---

## 10. Mobile (EAS)

Expo Go is not supported. `apps/mobile/eas.json` currently has a **development** profile only (`EXPO_PUBLIC_API_URL=http://10.0.2.2:4000`). Production and preview profiles, store credentials, and `extra.eas.projectId` are still operator work (`eas init`).

| Variable | Notes |
|---|---|
| `EXPO_PUBLIC_API_URL` | Production API origin. Inlined at **build** time. |
| `EXPO_PUBLIC_REOWN_PROJECT_ID` | Same Reown project as web, or a dedicated one. |
| `EXPO_PUBLIC_WEB_URL` | Confirmed web origin. Unset hides Bitcoin / “continue on web” handoffs. |

Push (ADR-020):

1. `npx eas-cli@latest init` in `apps/mobile`.
2. Upload FCM v1 (Android) and APNs (iOS) credentials: `npx eas-cli@latest credentials`.
3. Optional API env `EXPO_ACCESS_TOKEN` for Expo’s enhanced push security.
4. Bundle id in OPEN-ITEMS: `com.bytesac.app` (confirm before store submit).

Bitcoin legs and Bitcoin linking are web-only; mobile hands off to `EXPO_PUBLIC_WEB_URL`.

---

## 11. Environment reference

The API validates env at startup (`apps/api/src/config/dotenv.ts`) and **exits if a required value is missing**. Canonical comments live in `apps/api/.env.example`.

### API / worker (same file)

| Group | Variables | Production notes |
|---|---|---|
| Server | `NODE_ENV=production`, `PORT`, `LOG_LEVEL` | |
| Data | `DATABASE_URL`, `REDIS_URL` | Pooler + noeviction Redis |
| Auth | `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET`, `AUTH_DOMAIN`, `AUTH_URI`, `ALLOWED_ORIGINS`, `COOKIE_SECURE=true`, `TRUST_PROXY` | `AUTH_*` and `ALLOWED_ORIGINS` = public web origin. `TRUST_PROXY` = Next hop only |
| Geo | `GEO_COUNTRY_HEADER` | e.g. `CF-IPCountry`; edge must overwrite |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Verified domain |
| SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `SMS_ALLOWED_COUNTRIES` | |
| RPC | `ALCHEMY_API_KEY` | Enable every chain you offer, including Bitcoin UTXO |
| Files | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Required |
| Optional | `COINMARKETCAP_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `LIFI_API_KEY`, `LIFI_INTEGRATOR`, `FIREBASE_SERVICE_ACCOUNT`, `EXPO_ACCESS_TOKEN` | Empty disables that feature |
| Execution | `SOLANA_FEE_PAYER_SECRET`, `EVM_GAS_WALLET_SECRET`, `GAS_TREASURY_SOLANA_ADDRESS`, `REVENUE_TREASURY_SOLANA_ADDRESS` | KMS before launch; revenue ≠ gas |

### Web

`API_ORIGIN`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_REOWN_PROJECT_ID`, optional Firebase and store URLs (section 9).

### Mobile

`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REOWN_PROJECT_ID`, `EXPO_PUBLIC_WEB_URL` (section 10).

### Migrator

`packages/db/.env`: `MIGRATOR_DATABASE_URL` only. Never the runtime role.

---

## 12. Release order

Run once per environment, in this order. Do not start the API against an unmigrated database.

1. **Postgres** up; extensions enabled; backups configured.
2. **Redis** up; `noeviction` confirmed.
3. **R2** bucket, CORS, lifecycle (section 7).
4. **Secrets** loaded (peppers, provider keys). Platform keys in KMS when available.
5. **Migrate** as schema owner: `pnpm --filter @repo/db db:migrate`.
6. **Set** `bytesac_api` password; point `DATABASE_URL` at the pooler.
7. **Start worker**, then **API**. Confirm `GET /health` is 200.
8. **Start web** with `API_ORIGIN` at the API. Confirm `/api/health` through the rewrite.
9. **Smoke:** wallet sign-in on web (Reown), session cookie `Secure`, CSRF header on a mutation.
10. **Bootstrap ops** (local/dev only for the first human; production: a named operator):
    ```bash
    pnpm --filter api ops:grant-role -- --user <user-uuid> --role ops_admin --operator you@example.com
    ```
    Later roles are managed in `/ops/roles`. Every command needs `--operator` and is audited.
11. **Seed the asset registry** only in non-production:
    ```bash
    pnpm --filter api ops:seed-assets -- --user <user-uuid>
    ```
    Production assets are onboarded through `/ops` review (ADR-010).
12. **Fund** the Solana fee payer, EVM gas wallet (every chain), and confirm treasury USDC accounts. Watch `gas-wallet-check` logs.
13. **Mobile** EAS build against the same API origin last (public variables are baked in).

Rollback: revert the web/API/worker release; **do not** reverse a migration that already wrote financial rows. Forward-fix with a new migration.

---

## 13. Platform wallets and first real flow

Platform wallets hold **platform funds only**. They are not user custody.

| Wallet | Pays | Floor (warning) |
|---|---|---|
| Solana fee payer | Sponsored tx fees + one-time treasury token-account rent | 0.5 SOL |
| EVM gas wallet | One gas drop per EVM leg | 0.01 ETH, 0.05 BNB, 10 POL (per chain) |
| Gas treasury | Receives network fees in USDC on Solana | n/a |
| Revenue treasury | Receives platform fees in USDC on Solana | n/a |

Caps today are constants in `apps/api/src/modules/operations/gas.service.ts` (no env override): ~0.02 SOL per user per day; about $5 per user per EVM chain per day; about $200 global per chain per day. Review before launch ([`OPEN-ITEMS.md`](../OPEN-ITEMS.md) §2).

Solana co-sign only happens when the user-signed message is **byte-identical** to the provider transaction (`TX_MISMATCH` otherwise). EVM approvals are exact-amount, no standing allowance (ADR-013).

The small-amount mainnet checklist lives in [`apps/api/README.md`](../../apps/api/README.md) (invest, partial stop, leave, sell, rebalance, drift fix, buy back, sync, with fees). That is a **user action**, not a deploy script.

---

## 14. Edge, cookies, and eligibility

| Control | Production setting |
|---|---|
| TLS | Required. HSTS is already sent by Next |
| Session cookie | `bx_session`, httpOnly, `Secure` when `COOKIE_SECURE=true`, 12 h idle / 7 d absolute on web |
| CSRF | Cookie mutations need `Origin` + `X-Requested-With: bytesac` |
| CORS | Disabled. Do not add `Access-Control-Allow-Origin` |
| Client IP | Edge overwrites `X-Forwarded-For`; API `TRUST_PROXY` = Next hop |
| Geo | `GEO_COUNTRY_HEADER` trusted only because the edge overwrites it |
| CSP | Report-only until a report endpoint exists, then enforce |

---

## 15. Observability (minimum)

Nothing is wired to a SaaS yet. Before launch you need:

- Log drain from API and worker (winston JSON; secrets and OTP codes are redacted in the error handler — keep it that way).
- Uptime on `GET /health` and on the worker process.
- Alerts on `gas-wallet-check` warnings, `revenue reconciliation mismatch`, Redis/Postgres down, and failed BullMQ jobs.
- Error tracking with **no** request bodies that contain signatures, cookies, or documents.

---

## 16. Go-live checklist

Copy of the operational subset; the full list is [`OPEN-ITEMS.md`](../OPEN-ITEMS.md).

**Blockers**

- [ ] Every account in §2.3 created; no placeholders in production.
- [ ] Platform keys in KMS/HSM; fee payer and gas wallet funded; treasuries distinct.
- [ ] `pg_cron` + `vector` enabled; migrations applied; schema `app` not exposed.
- [ ] Redis `noeviction`; worker running.
- [ ] Edge overwrites `X-Forwarded-For` and the geo header.
- [ ] `COOKIE_SECURE=true`, `TRUST_PROXY` correct, `NEXT_PUBLIC_APP_URL` = real origin.
- [ ] Legal review of custody, fees, disclosures, eligibility attestation (placeholder copy today).
- [ ] Platform fee rates set in `/ops/fees` (defaults are 0).
- [ ] Eligibility rule values entered per RWA (deny by default).
- [ ] Alchemy Bitcoin UTXO add-on if you offer native BTC.
- [ ] Small-amount mainnet run of every money flow (`apps/api/README.md`).
- [ ] Wallet E2E on web (MetaMask, Phantom) and a mobile dev/store build.
- [ ] CSP collection, then enforce.
- [ ] Linux CI for lint, types, tests, build (Windows vitest can crash workers with exit `3221226505`).

**Do not claim launch** until those are done. Simulated performance must stay labelled simulated. Manager publication is not investor consent.

---

## 17. What this file does not cover yet

Spec 16 is expected to add, after an explicit hosting decision:

- Multi-stage Dockerfiles for API, worker, and optionally web (non-root, healthchecks).
- Compose for a production-like local stack (not only Postgres + Redis).
- GitHub Actions on Linux: lint, `check-types`, test with service containers, build, migrate, image publish.
- Environment names (dev / staging / production), domains, and CD gates (`main` → staging, tags → production, manual approval).
- `docs/engineering/LAUNCH-GUIDE.md` (account-by-account click-path).

Do not add those as if they already existed. When they land, rewrite this document in place.

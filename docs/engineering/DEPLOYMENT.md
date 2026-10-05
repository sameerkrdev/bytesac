# Deploying Bytesac

How to deploy and operate Bytesac: the services, what each one needs, the release order, edge and security
requirements, and the checks before going live.

> **Status (2026-10-06):** Bytesac has **not been deployed**. There are no Dockerfiles, CI workflows or
> production EAS profile in the repository yet; producing them is **Spec 16** (see `docs/superpowers/HANDOFF.md` §6).
> The hosting providers below are **options, not decisions**. Choose them in Spec 16 and record the choice as an ADR.
> Everything else here (what each service needs, the order, the security requirements) follows from the code and
> the accepted ADRs.

---

## 1. What runs in production

| # | Component | Source | Runs as | Needs |
|---|---|---|---|---|
| 1 | **API** | `apps/api` → `dist/server.js` | Long-running Node.js ≥ 24 process (HTTP, default port 4000) | PostgreSQL, Redis, provider keys |
| 2 | **Worker** | `apps/api` → `dist/worker.js` | Long-running Node.js process, same image as the API | PostgreSQL, Redis (non-evicting), provider keys |
| 3 | **Web** | `apps/web` | Next.js 16 server (`next start`) | Reaches the API privately through `API_ORIGIN` |
| 4 | **PostgreSQL** | `packages/db/migrations` | Managed Postgres 17 (Supabase per ADR-005 and ADR-006) | Extensions `pg_cron` and `vector` |
| 5 | **Redis** | — | Managed Redis 7 | `maxmemory-policy noeviction` |
| 6 | **Object storage** | — | Cloudflare R2 bucket (private) | CORS rule, lifecycle rule |
| 7 | **Mobile app** | `apps/mobile` | Store builds through EAS | EAS project, store accounts, push credentials |

```text
            Internet
               │
        Edge / CDN / TLS ── overwrites X-Forwarded-For and the geo header
               │
           Web (Next.js) ── /api/* rewrite ──► API (Express) ◄── Mobile app (bearer token, direct)
                                                │      │
                                         PostgreSQL   Redis ◄── Worker (BullMQ)
                                                │
                                   Cloudflare R2 (signed URLs; files never stream through the API)
```

The browser never calls the API directly: the web app proxies `/api/*` to `API_ORIGIN`, and the API sends **no CORS
headers** on purpose. The mobile app calls the API directly with a bearer token, so the API needs a public HTTPS URL
for mobile.

### Hosting options (to decide in Spec 16)

| Component | Options | Constraints that matter |
|---|---|---|
| API and worker | Fly.io, Render, Railway, AWS ECS/Fargate, Google Cloud Run (always-on) | Two long-running processes; the worker must not scale to zero; graceful SIGTERM is implemented |
| Web | Vercel, or a container next to the API | The edge must overwrite `X-Forwarded-For` (§7) |
| PostgreSQL | Supabase (ADR-005/006) | `pg_cron` and `pgvector` required; runtime role without `DELETE` |
| Redis | Upstash, Redis Cloud, ElastiCache, the host's managed Redis | Must be non-evicting for BullMQ |
| Mobile builds | EAS Build and Submit | Push needs an EAS project id (ADR-020) |

## 2. Accounts and keys to prepare

| Service | Used for | Variables |
|---|---|---|
| Supabase (or other Postgres) | System of record | `DATABASE_URL`, `MIGRATOR_DATABASE_URL` |
| Redis provider | Queues, rate limits, price cache | `REDIS_URL` |
| Cloudflare R2 | Organization documents, basket files, logos | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` |
| Alchemy | EVM, Solana, Bitcoin and Polygon RPC (enable Bitcoin and Polygon on the key) | `ALCHEMY_API_KEY` |
| LI.FI | Swap and bridge routing for every investment leg | `LIFI_API_KEY`, `LIFI_INTEGRATOR` |
| Resend | Email OTP and notification email | `RESEND_API_KEY`, `EMAIL_FROM` |
| Twilio Verify | SMS OTP | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `SMS_ALLOWED_COUNTRIES` |
| CoinMarketCap (optional) | Market prices and simulated performance | `COINMARKETCAP_API_KEY` |
| Google Gemini (optional) | AI search and embeddings | `GEMINI_API_KEY` |
| Firebase (optional) | Web push | API: `FIREBASE_SERVICE_ACCOUNT`; web: `NEXT_PUBLIC_FIREBASE_*` |
| Expo / EAS | Mobile builds and push | `EXPO_ACCESS_TOKEN` (optional), EAS credentials |
| Reown Cloud | Wallet connection on web and mobile | `NEXT_PUBLIC_REOWN_PROJECT_ID`, `EXPO_PUBLIC_REOWN_PROJECT_ID` |
| Apple / Google developer accounts | Store distribution, APNs and FCM keys | — |
| Platform wallets | Solana fee payer, EVM gas wallet, two USDC treasuries | see §9 |

Every secret goes into the host's secret store, never into the repository or an image. Platform wallet keys move to a
**KMS or HSM before launch** (open item).

## 3. Environments

Plan for three: **development** (local, `pnpm db:up`), **staging** and **production**, each with its own
database, Redis, R2 bucket, provider keys, platform wallets and EAS build profile. Staging should use the same hosting
as production. The web origin decided here also fixes `AUTH_DOMAIN`, `AUTH_URI`, `ALLOWED_ORIGINS`,
`NEXT_PUBLIC_APP_URL`, `EXPO_PUBLIC_WEB_URL`, the WalletConnect metadata URL in `apps/mobile/src/lib/appkit.tsx`
(currently `https://bytesac.com`) and the R2 CORS origins.

## 4. Database (PostgreSQL)

1. **Create the project** (Supabase) and enable the extensions **`pg_cron`** and **`vector`** before migrating
   (Dashboard → Database → Extensions). Migration `0009_discovery.sql` fails if `vector` cannot be created.
2. **Run migrations as the schema owner.** Set `MIGRATOR_DATABASE_URL` (the project's `postgres` role) and run
   `pnpm --filter @repo/db db:migrate`. Migrations are additive and forward-only; there are no down migrations.
3. **Give the runtime role a password:** `ALTER ROLE bytesac_api LOGIN PASSWORD '<secret>'`. The migrations create
   `bytesac_api` with DML on schema `app` and **no `DELETE`**; financial tables are insert-only for it.
4. **Point the app at the runtime role:** `DATABASE_URL` uses `bytesac_api` through the pooler URL.
5. **Keep schema `app` private:** it must **not** be listed under Dashboard → API → Exposed schemas.
6. **Retention** runs inside Postgres: `pg_cron` calls `app.purge_expired()` daily at 03:00 UTC. Monitor
   `cron.job_run_details`.
7. **Backups:** enable point-in-time recovery, and rehearse a restore before launch.
8. **At scale:** add an ivfflat or hnsw index for pgvector (none today; a sequential scan is fine pre-launch).

## 5. Redis

- Redis 7, reachable from the API and the worker (`REDIS_URL`; TLS URL in production).
- **`maxmemory-policy noeviction`**: BullMQ loses jobs if keys are evicted.
- If Redis is down, the API keeps serving but enqueues fail fast and are logged; rate limits depend on it.

## 6. Cloudflare R2

1. Create a private bucket (no public access, no custom domain, no `r2.dev` URL).
2. Create an API token with Object Read & Write scoped to that bucket.
3. Add a CORS rule allowing `PUT` from each web origin, with allowed header `Content-Type`.
4. Add a lifecycle rule deleting objects under `incoming/` after 1 day (unconfirmed uploads).
5. Set the four `R2_*` variables. **The API refuses to start without them.**

## 7. Edge, TLS and network requirements

These are **security requirements**, not tuning:

- **TLS everywhere.** Session cookies are `Secure` in production (`COOKIE_SECURE=true`, the default).
- **`X-Forwarded-For` must be overwritten** by the edge or load balancer in front of the web app with the real
  client IP, never appended to a client-supplied value. The Next.js rewrite neither sets nor sanitizes it.
- **`TRUST_PROXY` on the API must trust only the web server hop** (its private CIDR, or loopback when co-located),
  not the whole chain. A hop count (for example `TRUST_PROXY=1`) is acceptable only when exactly one proxy sits in
  front of the API. If either rule is wrong, per-IP rate limits and the session `ip_prefix` become spoofable, or
  collapse into one global bucket.
- **Geo header:** if `GEO_COUNTRY_HEADER` is set (for example `CF-IPCountry`), the edge must overwrite or strip any
  client-supplied value on every request. Otherwise a client can choose its own country for RWA eligibility.
- **Mobile traffic** reaches the API directly over HTTPS; the same `TRUST_PROXY` rules apply to the API's own load
  balancer.
- **CSP:** the web app sends a **report-only** Content-Security-Policy with no report endpoint. Add a report collector,
  run the wallet end-to-end checks, then switch to an enforcing `Content-Security-Policy` (`apps/web/next.config.js`).

## 8. Services

### 8.1 API

```bash
pnpm install --frozen-lockfile
pnpm --filter api build          # tsup → apps/api/dist
node apps/api/dist/server.js     # or: pnpm --filter api start
```

- **Environment:** every variable in `apps/api/.env.example`. The process validates them at startup and exits on a
  missing required value. Production values: `NODE_ENV=production`, `COOKIE_SECURE=true`, `AUTH_DOMAIN` and
  `AUTH_URI` set to the web origin, `ALLOWED_ORIGINS` listing the web origins, `TRUST_PROXY` as in §7, and
  `LOG_LEVEL=info`.
- **Health check:** `GET /health` checks PostgreSQL and Redis; it returns 200 when both answer and 503 otherwise. Use it for readiness
  and liveness.
- **Shutdown:** on SIGTERM the server stops accepting connections and closes HTTP, queues, Redis and the database
  pool, then exits 0; after 10 s it exits 1. Give the platform a grace period of at least 15 s.
- **Scaling:** stateless; run two or more instances behind the load balancer. Sessions live in Postgres.

### 8.2 Worker

```bash
node apps/api/dist/worker.js     # or: pnpm --filter api start:worker
```

- Same image, same environment and same database role as the API; no extra credentials.
- Runs every scheduled and background job: price snapshots (00:05 UTC), basket performance, search index and
  embeddings, leg tracking, position reconciliation (02:30 UTC), gas-wallet checks (every 15 min), revenue
  reconciliation (04:00 UTC) and notification delivery.
- **Always on.** Do not scale to zero. Several instances are safe: fixed scheduler ids keep each schedule single-run.
- If the worker is down, derived data goes stale and notifications queue up, but the API keeps working. **Leg
  tracking also stops**, so investments stay `SUBMITTED` until it is back. Alert on worker health.

### 8.3 Web

```bash
pnpm --filter web build
pnpm --filter web start          # next start (PORT, default 3000)
```

| Variable | Value |
|---|---|
| `API_ORIGIN` | Private URL of the API, used by the `/api/*` rewrite (build- and run-time; listed in `turbo.json`) |
| `NEXT_PUBLIC_APP_URL` | Public web origin (also the WalletConnect metadata URL and icon) |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | Reown Cloud project id |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_PROJECT_ID`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_VAPID_KEY` | Optional web push (all or none) |
| `NEXT_PUBLIC_IOS_APP_URL`, `NEXT_PUBLIC_ANDROID_APP_URL` | Optional store links; unset shows "Coming soon" |

`NEXT_PUBLIC_*` values are inlined at build time, so build once per environment. Security headers (HSTS,
Permissions-Policy, frame and referrer policy, report-only CSP) come from `next.config.js`.

### 8.4 Mobile (EAS)

`eas.json` has only a `development` profile today. Before the first release:

1. `npx eas-cli@latest init` in `apps/mobile` (writes `extra.eas.projectId` to `app.json`; push needs it).
2. Add `preview` and `production` profiles with `EXPO_PUBLIC_API_URL` (the public HTTPS API),
   `EXPO_PUBLIC_REOWN_PROJECT_ID` and `EXPO_PUBLIC_WEB_URL`, or store them as EAS environment variables. Like web,
   `EXPO_PUBLIC_*` values are inlined at build time.
3. Upload credentials with `npx eas-cli@latest credentials`: iOS signing and an **APNs key**, and the **FCM v1
   service-account key** for Android push.
4. Build and submit: `eas build --profile production --platform all`, then `eas submit`.
5. Optional: enable Expo enhanced push security and set `EXPO_ACCESS_TOKEN` on the API and worker.

The app needs a development or store build (it uses native wallet modules; Expo Go is not supported).

## 9. Platform wallets and keys

| Wallet | Purpose | Variable | Funding |
|---|---|---|---|
| Solana fee payer | Co-signs and pays fees for Solana legs, plus one-time token-account rent | `SOLANA_FEE_PAYER_SECRET` | SOL; warning below 0.5 SOL |
| EVM gas wallet | Small gas drops so users can sign EVM legs (same address on every EVM chain) | `EVM_GAS_WALLET_SECRET` | Native gas on Ethereum, Base, BNB Chain, Arbitrum and Polygon; warnings below 0.01 ETH, 0.05 BNB, 10 POL |
| Gas treasury | Receives network fees (USDC on Solana) | `GAS_TREASURY_SOLANA_ADDRESS` | Address only |
| Revenue treasury | Receives platform fees (must differ from the gas treasury) | `REVENUE_TREASURY_SOLANA_ADDRESS` | Address only; required once any platform fee is above 0 |

- These wallets hold **platform funds only**. Never reuse their keys elsewhere.
- Keys are plain environment secrets today; **move them to a KMS or HSM before launch**.
- Gas caps are constants in `apps/api/src/modules/operations/gas.service.ts` (per user and global per chain, per
  day). Review them when prices move.
- Empty values disable the feature that needs them: without the fee payer, Solana legs are refused.

## 10. Release process

Recommended order for every release:

1. **CI on Linux:** `pnpm install --frozen-lockfile`, then `pnpm lint`, `pnpm check-types`, `pnpm test` (with
   Postgres and Redis service containers and the `TEST_*` variables), then `pnpm build`. Linux CI also avoids the
   Windows Vitest worker crash.
2. **Migrate:** run `pnpm --filter @repo/db db:migrate` against the target database as the schema owner, as a
   one-off release step before new code serves traffic. Migrations are additive, so the previous version keeps
   working against the new schema.
3. **Deploy the API and the worker** together (same image).
4. **Deploy the web app.**
5. **Smoke test:** `GET /health` returns 200, the web loads, wallet sign-in works, `/v1/public/discovery/baskets`
   answers, and the worker logs its schedules.
6. **Mobile:** build with EAS and submit; JavaScript-only fixes can use EAS Update once it is configured.

**Rollback:** redeploy the previous image or build. Because migrations are additive and forward-only, keep the
schema and roll back code only; write a new forward migration to fix a bad one.

## 11. Observability and operations

- **Logs:** winston writes JSON in production (`LOG_LEVEL`); request logs at the `http` level. Secrets, tokens, signatures,
  OTP codes and full contact details are never logged.
- **Alert on:** `/health` failures, worker down, BullMQ failed jobs, `gas-wallet-check` warnings, `revenue
  reconciliation mismatch`, operations stuck in `UNKNOWN`, and `pg_cron` failures.
- **Operator tools:** `pnpm --filter api ops:*` (grant role, disable address, suspend user; every command is
  audited). Resolve a leg stuck in `UNKNOWN` with `POST /v1/ops/operations/:id/legs/:legId/resolve` (`ops_admin`).
- **First operator:** `pnpm --filter api ops:grant-role -- --user <uuid> --role ops_admin --operator <you>`; later
  roles are managed in the web ops console.

## 12. Go-live checklist

**Infrastructure**

- [ ] Hosting chosen and recorded as an ADR; Dockerfiles, CI and CD workflows in the repository.
- [ ] Staging and production environments with separate databases, Redis, R2, keys and wallets.
- [ ] `pg_cron` and `vector` enabled; migrations applied; runtime role password set; schema `app` not exposed.
- [ ] Redis `noeviction`; worker always on with alerting.
- [ ] Edge overwrites `X-Forwarded-For` and the geo header; `TRUST_PROXY` trusts only the web hop.
- [ ] CSP reports collected, then CSP enforced.
- [ ] Backups with point-in-time recovery, and one restore rehearsed.

**Keys and money**

- [ ] All secrets in the host's secret store; platform wallet keys in a KMS or HSM.
- [ ] Platform wallets funded; `gas-wallet-check` warnings tested.
- [ ] The manual mainnet checklist in `apps/api/README.md` ("First investment and exit") completed with small amounts.
- [ ] Platform fee rates set by ops (the default is 0).

**Product and compliance**

- [ ] Placeholder legal and disclosure copy replaced after legal review; Expo and Google listed as processors in the
  privacy notice (push text and AI search queries).
- [ ] Gemini defaults verified against a real key, or `GEMINI_API_KEY` left empty.
- [ ] Manual wallet checks on web and on iOS and Android devices (`docs/OPEN-ITEMS.md`).
- [ ] Push verified on devices; store listings, icons and app store links (`NEXT_PUBLIC_*_APP_URL`).

## 13. Open decisions

Hosting providers, domains, who holds production secrets, the KMS choice, staging versus production promotion
rules, observability tooling, and the EAS release channels. All are part of Spec 16; see `docs/OPEN-ITEMS.md` §6
and `docs/superpowers/HANDOFF.md` §6.

<p align="center">
  <img src="apps/web/public/brand/bytesac-logo.svg" alt="Bytesac" height="56">
</p>

<p align="center">
  <strong>Invest in strategies, not individual trades.</strong><br>
  A manager-led, multi-chain investment-basket platform with self-custody at its core.
</p>

<p align="center">
  <a href="#introduction">Introduction</a> ·
  <a href="#the-problem">Problem</a> ·
  <a href="#the-solution">Solution</a> ·
  <a href="#getting-started">Getting started</a> ·
  <a href="#environment-variables">Environment</a> ·
  <a href="#technical-aspects">Technical aspects</a> ·
  <a href="docs/engineering/DEPLOYMENT.md">Deployment</a> ·
  <a href="docs/README.md">Documentation</a>
</p>

---

## Introduction

**Bytesac** is a platform where verified fund managers publish **baskets** — versioned portfolios with target weights across crypto assets, stablecoins, and approved tokenized real-world assets (RWAs) on several blockchains — and investors choose whether to follow those strategies from **their own wallets**.

The initial settlement currency is **USDC on Solana**, with later currencies designed in (never hard-coded as the only option). Investors sign in with Solana or EVM wallets (Ethereum, Base, BNB Chain, Arbitrum). A Bitcoin address can be linked when a basket holds native BTC; Bitcoin is never a sign-in method.

This repository is the whole product:

| Surface | Who uses it | Stack |
|---|---|---|
| Web app | Investors, managers, platform operations | Next.js 16 |
| Mobile app | Investors | Expo SDK 57 |
| API + worker | All clients | Express 5 + BullMQ |

> **Status:** pre-launch. Product specs 1–15 are on `main`. Deployment (Spec 16) has **not** happened. Legal and disclosure copy is placeholder text pending review. Open work lives in [`docs/OPEN-ITEMS.md`](docs/OPEN-ITEMS.md).

This software is **not financial advice**. Basket performance shown in the product is a **simulated model** and is always labelled as such. Nothing in this README is an offer to sell securities.

---

## The problem

Building a diversified on-chain portfolio is hard to do well and easy to do badly.

- **Fragmented execution.** A balanced portfolio spans assets on several chains. Buying it means a series of swaps, bridges, and approvals across wallets, each with its own fees and failure modes.
- **Custody trade-offs.** Most managed products ask you to hand over assets. On-chain that usually means trusting a third party with keys or funds.
- **Strategy drift and opaque changes.** When a strategy changes, investors are often moved automatically — without seeing what changed, why, or what it will cost.
- **Thin research.** Comparing strategies needs the thesis, weights, fees, risks, track record, and change history in one place, presented honestly.
- **Tokenized assets are not ordinary tokens.** RWAs can be restricted by jurisdiction and investor status. Treating them like permissionless coins is how people get stuck holding something they cannot legally trade.

---

## The solution

Bytesac separates **what a manager proposes** from **what an investor authorizes**.

| Principle | What it means |
|---|---|
| **Self-custody** | Assets stay in the investor’s own wallets. The investor signs every value-moving transaction. EVM approvals are for the exact amount; there are no standing allowances (ADR-013). Wallet sign-in is authentication, not spending permission. |
| **Strategy is not execution** | A basket version is a *target*. Each investment is a separate **operation** made of ordered **legs** that the investor reviews and signs one by one. A manager publishing a version never moves anyone’s funds. |
| **Updates are opt-in** | When a manager publishes a new version, holders see the rationale, the diff, and current weights next to the new target, then **rebalance or skip**. Skipping never trades. |
| **Three layers, never conflated** | Strategy target, the investor’s basket allocation, and holdings verified on chain are shown side by side. Holdings are reconciled from chain evidence, never from a webhook or an estimate. |
| **Honest numbers** | Basket performance is a simulated buy-and-hold of published weights, always labelled simulated, and shown before network and swap costs. Every fee is listed before signing. Fees are not refunded if an operation ends partial or failed. |
| **Verified managers** | Managers apply, are screened, and publish under a verified organization. Every basket version is reviewed before it goes live. |
| **Eligibility is deny-by-default for RWAs** | Tokenized assets are gated by declared country and investor status. Crypto is not similarly enforced. Holdings are never force-sold. |

### What you can do

**Investors** (web and mobile)

- Discover baskets (filters, categories, Featured / Trending / Suggested rails, AI search that only fills structured filters).
- Read research pages: allocation, simulated performance, fees, risks, documents, version history.
- Invest with step-by-step signing against fresh quotes.
- Track positions and activity; review or skip updates; repair drift or shortfalls (Buy back or Sync); sell or leave a basket.
- Declare eligibility; verify email and phone; receive in-app, email, web-push, and mobile-push notifications.

**Managers and organizations** (web)

- Apply, verify an organization, invite members with built-in and custom roles.
- Draft and submit basket versions (including files), manage the Solana payout wallet, see adoption counts and earnings.

**Platform operations** (web)

- Screen applications; verify organizations and members.
- Run the asset registry (instruments, chain deployments, execution routes, pricing, eligibility rules).
- Review baskets; set platform fee schedules; deny or allow routing tools; resolve stuck operations.

Manager and ops consoles are **web-only**. On mobile, Bitcoin steps hand off to the web app.

---

## Architecture

```text
 Web (Next.js 16)          Mobile (Expo SDK 57)
        \  /api/* rewrite        /  bearer token
         +----------------------+
                   API (Express 5)  ─────────  Worker (BullMQ)
                    │                              │
        providers/  │  LI.FI · Alchemy · Solana ·  ├── Redis (queues, rate limits, cache)
        (adapters)  │  Bitcoin · CoinMarketCap ·   └── PostgreSQL (system of record,
                    │  Gemini · Resend · Twilio ·       pg_cron retention, pgvector)
                    │  FCM · Expo push · R2
```

- **Modular monolith** (ADR-001): one API codebase with feature modules (`route → controller → service`), plus a BullMQ worker from the same codebase for scheduled and background jobs. Jobs never move user money.
- **PostgreSQL is the system of record.** The runtime role `bytesac_api` has no `DELETE`. Financial history is append-only or status-driven.
- **Providers sit behind adapters** in `apps/api/src/providers/`. Internal models never depend on a vendor SDK.
- **No CORS.** The web app talks to the API through a same-origin Next.js rewrite and an httpOnly session cookie. Mobile uses a bearer token in the OS secure store.

Read [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) and the decision register [`docs/decisions/DECISION-REGISTER.md`](docs/decisions/DECISION-REGISTER.md).

### Repository layout

```text
apps/
  api/        Express 5 API + BullMQ worker (TypeScript, tsup)
  web/        Next.js 16: marketing site, investor app, manager workspace, ops console
  mobile/     Expo SDK 57 investor app (Expo Router, NativeWind, Reown AppKit)
packages/
  db/              Drizzle schema, migrations, helpers (schema `app`)
  validator/       Zod schemas, error codes, chains, permission matrix
  api-client/      Typed API client used by web and mobile
  app-core/        Shared client logic (leg signer, fee lines, portfolio actions)
  design-tokens/   Light/dark theme roles, motion, brand artwork
  logger/          winston logger
  eslint-config/ typescript-config/   Shared tooling
docs/              Architecture, ADRs, domain specs, design system, open items, deployment
docker/            Local Postgres image (pg_cron + pgvector)
```

### Tech stack

| Area | Technology |
|---|---|
| Monorepo | Turborepo, pnpm 11 (exact pins, supply-chain policy) |
| API | Node.js ≥ 24, Express 5, TypeScript, Zod, envalid, winston |
| Data | PostgreSQL 17 (Supabase in production), Drizzle ORM and Kit, pg_cron, pgvector |
| Jobs and limits | BullMQ, Redis 7, rate-limiter-flexible |
| Web | Next.js 16 App Router, React 19, Tailwind CSS v4, motion, three.js / react-three-fiber |
| Mobile | Expo SDK 57, React Native 0.86, Expo Router, NativeWind, Reanimated |
| Wallets | Reown AppKit (web and React Native): SIWE (EVM), SIWS (Solana), BIP-322/137 (Bitcoin) |
| Routing and chain data | LI.FI, Alchemy, `@solana/web3.js`, viem, `@scure/btc-signer` |
| Services | CoinMarketCap, Google Gemini (optional), Resend, Twilio Verify, Firebase Cloud Messaging (web push), Expo push (mobile), Cloudflare R2 |
| Tests | Vitest + Supertest (API, web, packages), jest-expo (mobile), Playwright (visual QA) |

---

## Getting started

### Prerequisites

Install these **before** cloning:

| Tool | Version | Notes |
|---|---|---|
| **Node.js** | ≥ 24 | Matches `engines` in the root `package.json` |
| **pnpm** | 11.25.0 | `corepack enable` reads `packageManager` |
| **Docker Desktop** (or Engine + Compose) | current | Local PostgreSQL 17 with pg_cron + pgvector, and Redis 7 |
| **Git** | any recent | |
| **Android Studio / Xcode** | optional | Only for native mobile development builds |
| **Reown Cloud project ID** | — | Wallet connect on web and mobile. [cloud.reown.com](https://cloud.reown.com) |

Accounts you can skip at first: Alchemy, Resend, Twilio, LI.FI, CoinMarketCap, Gemini, Firebase, R2, Expo. The API **requires** several of those variables to be *present*, but **placeholders work locally** until you exercise that path. R2 values must be non-empty for the API process to boot (use dummy strings locally if you are not uploading files).

Windows: Docker Desktop must be running (`docker info`). Git Bash or PowerShell both work; use `node -e` to generate secrets if `openssl` is not on `PATH`.

### 1. Clone and install

```bash
git clone git@github.com:sameerkrdev/bytesac.git
cd bytesac
corepack enable
pnpm install
```

### 2. Start PostgreSQL and Redis

```bash
pnpm db:up
```

This starts:

- Postgres on `localhost:54329` (user `postgres` / `postgres`, databases `bytesac_dev` and `bytesac_test`)
- Redis on `localhost:63799`

After pulling a newer Postgres image, run `pnpm db:down -v` **once** so the volume is recreated (pg_cron / pgvector live in the image).

Stop with `pnpm db:down`.

### 3. Configure environment files

```bash
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env     # only if you work on mobile
```

Generate the two API secrets and paste them into `apps/api/.env`:

```bash
# Unix / Git Bash
openssl rand -hex 32    # SESSION_TOKEN_PEPPER
openssl rand -hex 32    # OTP_HMAC_SECRET

# PowerShell / any Node
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`apps/web/.env.local` (or `.env`):

```bash
API_ORIGIN=http://localhost:4000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_REOWN_PROJECT_ID=<your Reown project id>
```

Leave `COOKIE_SECURE=false` and `TRUST_PROXY=loopback` for local HTTP.

### 4. Migrate the database

```bash
pnpm --filter @repo/db db:migrate       # as schema owner (MIGRATOR_DATABASE_URL)
pnpm --filter @repo/db db:dev-roles     # sets the local password for role bytesac_api
```

### 5. Run the apps

Each in its own terminal:

```bash
pnpm --filter api dev            # http://localhost:4000   health: GET /health
pnpm --filter api dev:worker     # prices, performance, search, tracking, notifications
pnpm --filter web dev            # http://localhost:3000
```

Sign in on the web app (connect a wallet). Your user id is in the session / profile. Then, locally only:

```bash
pnpm --filter api ops:grant-role -- --user <your-user-uuid> --role ops_admin --operator you@example.com
pnpm --filter api ops:seed-assets -- --user <your-user-uuid>
```

`ops:seed-assets` is **not** for production. Production assets go through ops review.

### Mobile

Native wallet modules mean **Expo Go is not supported**. Build a development client, then start Metro:

```bash
cd apps/mobile
npx expo run:android            # or: npx expo run:ios
npx expo start --dev-client
```

Set in `apps/mobile/.env`:

| Variable | Local value |
|---|---|
| `EXPO_PUBLIC_API_URL` | Android emulator: `http://10.0.2.2:4000`. Physical device: your LAN IP or a tunnel |
| `EXPO_PUBLIC_REOWN_PROJECT_ID` | Same Reown project as web |
| `EXPO_PUBLIC_WEB_URL` | `http://localhost:3000` (or the machine’s reachable origin). Unset hides Bitcoin handoff buttons |

Push notifications need `eas init` and store credentials. See [`apps/mobile/README.md`](apps/mobile/README.md).

### UI work without the backend

```bash
pnpm --filter web mock-api       # schema-validated mock API on :4000
pnpm --filter web dev
```

Sign in as a persona with cookie `bx_session=mock-investor` (or `mock-manager`, `mock-ops`, `mock-new`).

### Troubleshooting

| Symptom | What to do |
|---|---|
| `docker info` fails | Start Docker Desktop, then `pnpm db:up` |
| API exits on missing env | Copy `.env.example` fully; R2 and Twilio/Resend/Alchemy keys must be *set*, even if dummy |
| Migrate cannot create `vector` | Recreate the volume: `pnpm db:down -v` then `pnpm db:up` |
| Web wallet connect does nothing | Set `NEXT_PUBLIC_REOWN_PROJECT_ID` |
| `GET /health` is 503 | Postgres or Redis is down |
| Windows Vitest exit `3221226505` | Native Node crash, not a test failure — rerun that file alone |
| Mobile Jest finds no tests in a `.claude` path | `pnpm exec jest --testMatch "**/test/**/*.test.ts?(x)"` |
| Two API test runs deadlock | They share one test database — never run two suites at once |

---

## Environment variables

The API validates its environment at startup (`apps/api/src/config/dotenv.ts`) and refuses to start when a required value is missing. `apps/api/.env.example` is the canonical list.

| Group | Variables | Required |
|---|---|---|
| Server | `NODE_ENV`, `PORT`, `LOG_LEVEL` | Defaults exist |
| Database and Redis | `DATABASE_URL`, `REDIS_URL` | Yes |
| Auth and sessions | `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET`, `AUTH_DOMAIN`, `AUTH_URI`, `ALLOWED_ORIGINS`, `COOKIE_SECURE`, `TRUST_PROXY` | Yes (`TRUST_PROXY` matters in production) |
| Messaging | `RESEND_API_KEY`, `EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `SMS_ALLOWED_COUNTRIES` | Yes (placeholders locally) |
| Chain data | `ALCHEMY_API_KEY` | Yes (placeholder locally) |
| Files | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Yes |
| Optional features | `COINMARKETCAP_API_KEY`, `GEMINI_API_KEY`, `LIFI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `EXPO_ACCESS_TOKEN`, `GEO_COUNTRY_HEADER` | Empty disables the feature |
| Platform wallets | `SOLANA_FEE_PAYER_SECRET`, `EVM_GAS_WALLET_SECRET`, `GAS_TREASURY_SOLANA_ADDRESS`, `REVENUE_TREASURY_SOLANA_ADDRESS` | Needed to execute investments |
| Tests | `TEST_DATABASE_URL`, `TEST_ADMIN_DATABASE_URL`, `TEST_REDIS_URL` | For `pnpm test` |

**Web:** `API_ORIGIN`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_REOWN_PROJECT_ID`; optional `NEXT_PUBLIC_FIREBASE_*` (web push) and `NEXT_PUBLIC_IOS_APP_URL` / `NEXT_PUBLIC_ANDROID_APP_URL` (store badges).

**Mobile:** `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_REOWN_PROJECT_ID`, optional `EXPO_PUBLIC_WEB_URL`. Public Expo variables are **inlined at build time**.

**Migrator** (`packages/db/.env`): `MIGRATOR_DATABASE_URL` — schema owner, never the runtime role.

**Never commit real secrets.** Platform wallet keys must move to a KMS or HSM before launch.

---

## Testing and quality

```bash
pnpm lint            # ESLint across the monorepo (zero warnings)
pnpm check-types     # TypeScript
pnpm test            # Vitest (API needs Docker) and jest-expo (mobile)
pnpm build           # Production builds
```

Filter one workspace, for example `pnpm --filter web test`. API tests need `TEST_*` URLs and `pnpm db:up`. Never run two API suites at once (shared test database).

---

## Technical aspects

These are product invariants, not style preferences. Detail lives in ADRs; this is the map.

- **Money is exact.** Quantities are integers in base units or `numeric`. Never JavaScript `number` for authoritative arithmetic. Fees are snapshotted when a plan is created, so later schedule changes never alter that plan.
- **Operations and legs.** An investment, rebalance, repair, or sale is an operation of ordered legs (`PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`). Each leg is signed against a fresh ~60 s quote. Partial completion is a valid state. An unknown outcome is reconciled, never blindly retried. One active operation per user.
- **Signing safety.** Solana legs are co-signed by the platform fee payer only when the message is byte-identical to the provider’s (`TX_MISMATCH` otherwise). EVM gas drops are capped per user and per day; the network fee is charged in the first signed step. Bitcoin PSBTs are checked against quoted inputs and outputs.
- **Chain evidence first.** Positions are a sub-ledger reconciled nightly and on demand against what wallets actually hold. Shortfalls and surpluses are surfaced with Buy back or Sync. A webhook is not proof of ownership.
- **Eligibility.** RWAs are gated by an engine (declared country and investor status, deny by default). Every decision is stored. `permissioned` deployments are not investable in this release. Issuer subscription/redemption is future work.
- **Settlement.** Initial settlement asset is USDC on Solana. Display currency, settlement currency, on-chain settlement asset, and instrument price reference are separate concepts.
- **Security.** Backend sessions (httpOnly cookie on the web, bearer on mobile), CSRF guard on cookie mutations, no CORS, Redis rate limits, least-privilege database roles, secrets read only in `config/dotenv.ts`, redacted logging. Authorization is enforced on the server; hiding a button is not enforcement.
- **Discovery.** Search index and simulated performance are derived by the worker. AI search (Gemini) only calls a read-only `search_baskets` tool; queries are not stored. Without a Gemini key, structured and keyword search still work.
- **Design system.** Shared light/dark theme roles, Geist, and brand artwork in `@repo/design-tokens` ([`docs/design/DESIGN-SYSTEM.md`](docs/design/DESIGN-SYSTEM.md)).

Supported **auth chains:** Solana, Ethereum, Base, BNB Chain, Arbitrum. **Asset chains** additionally include Polygon and Bitcoin; recording a chain in the registry does not make it executable.

---

## Deployment

Bytesac has not been deployed. [`docs/engineering/DEPLOYMENT.md`](docs/engineering/DEPLOYMENT.md) covers:

- Prerequisites (tools, infrastructure capabilities, accounts)
- Services to run (API, worker, web, mobile, Postgres, Redis, R2)
- Hosting constraints (vendor-agnostic until Spec 16)
- Supabase, Redis, R2, edge (`X-Forwarded-For`, geo header), cookies
- Release order, platform wallets, and the go-live checklist

All infrastructure lives in [`infra/`](infra/README.md): Docker images (`infra/docker/api.Dockerfile` for the API,
worker, migrations and ops CLI; `infra/docker/web.Dockerfile` for Next.js), the local dev services
(`infra/local/`, used by `pnpm db:up`) and the single-VM server kit (`infra/server/`: rootless Docker compose stack,
deploy script, env templates, reference nginx site). Follow
[`docs/engineering/DEPLOY-GCP.md`](docs/engineering/DEPLOY-GCP.md) for the pilot on Google Cloud; GitHub Actions
(`.github/workflows/`) runs CI on every pull request and deploys `main`.

Do not create cloud resources or use production secrets without an explicit go-ahead.

---

## Documentation

| Read this | For |
|---|---|
| [`docs/README.md`](docs/README.md) | Documentation index and reading order |
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | Runtime, modules, data, stack |
| [`docs/decisions/DECISION-REGISTER.md`](docs/decisions/DECISION-REGISTER.md) | Decision register and ADRs |
| [`docs/domains/`](docs/domains) | Product behaviour by domain |
| [`docs/engineering/CODING-STANDARDS.md`](docs/engineering/CODING-STANDARDS.md) | Conventions, tests, workflow |
| [`docs/engineering/DEPLOYMENT.md`](docs/engineering/DEPLOYMENT.md) | Deploying and operating Bytesac |
| [`docs/OPEN-ITEMS.md`](docs/OPEN-ITEMS.md) | Open work, manual checks, technical debt |
| [`docs/domains/FUTURE-PLANS.md`](docs/domains/FUTURE-PLANS.md) | Deferred scope — not supported |
| `apps/*/README.md` | Per-app details (API providers and jobs, web push, mobile builds) |

Agents and contributors should also read [`AGENTS.md`](AGENTS.md) before changing code.

---

## Contributing

1. Read [`AGENTS.md`](AGENTS.md) and [`docs/engineering/CODING-STANDARDS.md`](docs/engineering/CODING-STANDARDS.md).
2. Work on a branch. Do not commit on `main`.
3. Keep changes small and coherent. Add tests for business rules, state transitions, failure paths, and idempotency.
4. Run `pnpm lint`, `pnpm check-types`, and the relevant tests before opening a pull request.
5. Update domain docs and ADRs in the same change when behaviour or architecture changes. Rewrite in place; do not append “update” notes.

Do not add dependencies without discussion. Versions are pinned exactly; the lockfile is checked against a supply-chain policy (`minimumReleaseAge`). Never add `minimumReleaseAgeExclude` except as already discussed for Turborepo.

Do not commit `.env` files, platform keys, seed phrases, Firebase service accounts, verification documents, or production data.

---

## Security

- Report vulnerabilities privately to the maintainers. Do not open a public issue that includes proof-of-concept against money paths.
- Never include real keys, seed phrases, session tokens, or personal data in issues, commits, or logs.
- Wallet authentication is not spending authorization. A manager’s published strategy is not user consent.

---

## License

No license has been chosen yet. Until one is added, **all rights are reserved**.

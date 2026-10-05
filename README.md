<p align="center">
  <img src="apps/web/public/brand/bytesac-logo.svg" alt="Bytesac" height="56">
</p>

<p align="center">
  <strong>Invest in strategies, not individual trades.</strong><br>
  A manager-led, multi-chain investment-basket platform with self-custody at its core.
</p>

<p align="center">
  <a href="#getting-started">Getting started</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="docs/engineering/DEPLOYMENT.md">Deployment</a> ·
  <a href="docs/README.md">Documentation</a>
</p>

---

## Introduction

Bytesac lets verified fund managers publish **baskets**: versioned portfolios with target weights across crypto
assets, stablecoins and approved tokenized real-world assets (RWAs) on several blockchains. Investors research a basket,
invest from their **own wallet**, and decide for themselves whether to follow each update the manager publishes.

The initial settlement currency is **USDC on Solana**. Investors sign in with Solana or EVM wallets (Ethereum, Base, BNB
Chain, Arbitrum); a Bitcoin address can be linked for baskets that hold native BTC.

This repository is the whole product: the API and background worker, the web app (investors, managers and platform
operations), the mobile app (investors), and the shared packages they use.

> **Status:** pre-launch. Specs 1–15 and the web and mobile redesign are merged; deployment (Spec 16) is the next phase
> and has not happened yet. Legal and disclosure copy is placeholder text pending review. See
> [`docs/OPEN-ITEMS.md`](docs/OPEN-ITEMS.md) for everything still open.

## The problem

Building a diversified on-chain portfolio is hard to do well and easy to do badly:

- **Fragmented execution.** A balanced portfolio spans many assets on several chains. Buying it means a series of swaps,
  bridges and approvals across different wallets, each with its own fees and failure modes.
- **Custody trade-offs.** Most managed products ask you to hand over your assets. On-chain, that means trusting a
  third party with your keys or funds.
- **Strategy drift and opaque changes.** When a strategy changes, investors are often moved along automatically,
  without seeing what changed, why, or what it will cost.
- **Research is thin.** Comparing strategies needs the thesis, weights, fees, risks, track record and change history in
  one place, presented honestly.

## The solution

Bytesac separates **what a manager proposes** from **what an investor authorizes**:

| Principle | What it means in Bytesac |
|---|---|
| **Self-custody** | Assets stay in the investor's own wallets. The investor signs every value-moving transaction; EVM approvals are for the exact amount, with no standing allowances (ADR-013). |
| **Strategy is not execution** | A basket version is a *target*. Each investment is a separate operation made of steps ("legs") that the investor reviews and signs one by one. |
| **Updates are opt-in** | When a manager publishes a new version, investors see the rationale, the diff and their current weights next to the new target, then choose to rebalance or skip. Skipping never trades. |
| **Three layers, never conflated** | The strategy target, the investor's basket allocation and the holdings verified on chain are shown side by side. Holdings are reconciled from chain evidence, never from estimates. |
| **Honest numbers** | Basket performance is a *simulated model*, always labelled as such. Every fee is listed before signing. |
| **Verified managers** | Managers apply, are screened, and publish under a verified organization; every basket version is reviewed before it goes live. |

### What you can do

- **Investors:** discover baskets (filters, categories, AI search that only fills structured filters), read research
  pages (allocation, simulated performance, fees, risks, documents, version history), invest with step-by-step signing,
  track positions and activity, review or skip updates, repair drift or shortfalls, sell or leave a basket, and get
  in-app, email and push notifications.
- **Managers and organizations:** apply, verify an organization, invite members with roles (including custom roles),
  draft and submit basket versions with files, manage payout wallets, and see adoption and earnings.
- **Platform operations:** screen applications, verify organizations and members, run the asset registry (instruments,
  deployments, routes, pricing, eligibility rules), review baskets, set platform fees, and resolve stuck operations.

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

- **Modular monolith** (ADR-001): one API codebase with feature modules (`route → controller → service`), and a
  BullMQ worker from the same codebase for scheduled and background jobs.
- **PostgreSQL is the system of record.** The runtime role has no `DELETE`; financial history is append-only or
  status-driven.
- **Providers sit behind adapters**, so internal models never depend on a vendor's SDK.

Read [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) for the full picture and
[`docs/decisions/DECISION-REGISTER.md`](docs/decisions/DECISION-REGISTER.md) for every decision and its ADR.

### Repository layout

```text
apps/
  api/        Express 5 API + BullMQ worker (TypeScript, tsup)
  web/        Next.js 16 web app: marketing site, investor app, manager workspace, ops console
  mobile/     Expo SDK 57 investor app (Expo Router, NativeWind, Reown AppKit)
packages/
  db/              Drizzle schema, migrations and database helpers (schema `app`)
  validator/       Zod schemas, error codes, chains, permission matrix (shared contract)
  api-client/      Typed API client used by web and mobile
  app-core/        Client logic shared by web and mobile (leg signer, fee lines, portfolio actions)
  design-tokens/   Light/dark theme roles, motion, brand artwork
  logger/          winston logger
  eslint-config/ typescript-config/   Shared tooling config
docs/              Architecture, decisions (ADRs), domain specs, design system, open items
docker/            Local Postgres image (pg_cron + pgvector)
```

### Tech stack

| Area | Technology |
|---|---|
| Monorepo | Turborepo, pnpm 11 (exact pins, supply-chain policy) |
| API | Node.js ≥ 24, Express 5, TypeScript, Zod, envalid, winston |
| Data | PostgreSQL 17 (Supabase in production), Drizzle ORM and Kit, pg_cron, pgvector |
| Jobs and limits | BullMQ, Redis 7, rate-limiter-flexible |
| Web | Next.js 16 App Router, React, Tailwind CSS v4, motion, three.js / react-three-fiber |
| Mobile | Expo SDK 57, React Native 0.86, Expo Router, NativeWind, Reanimated |
| Wallets | Reown AppKit (web and React Native): SIWE (EVM), SIWS (Solana), BIP-322/137 (Bitcoin) |
| Routing and chain data | LI.FI, Alchemy, `@solana/web3.js`, viem, `@scure/btc-signer` |
| Services | CoinMarketCap (prices), Google Gemini (AI search, optional), Resend (email), Twilio Verify (SMS), Firebase Cloud Messaging (web push), Expo push (mobile), Cloudflare R2 (files) |
| Tests | Vitest + Supertest (API, web, packages), jest-expo (mobile), Playwright (visual QA) |

## Getting started

### Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 24 | `engines` in the root `package.json` |
| pnpm | 11.25.0 | `corepack enable` picks the version from `packageManager` |
| Docker | with Compose | Runs local PostgreSQL (pg_cron, pgvector) and Redis |
| Git | any recent | |
| Android Studio / Xcode | optional | Only for native mobile development builds |

Accounts you need for a full local run: a **Reown (WalletConnect) project ID** for wallet connection. Provider keys for
Alchemy, Resend and Twilio are required by the API's config but **placeholders work locally** unless you exercise those
paths. Everything else (LI.FI, CoinMarketCap, Gemini, Firebase, R2, Expo) is optional or only needed for its feature.

### 1. Install

```bash
git clone git@github.com:sameerkrdev/bytesac.git
cd bytesac
corepack enable
pnpm install
```

### 2. Start PostgreSQL and Redis

```bash
pnpm db:up          # Postgres on localhost:54329, Redis on localhost:63799
```

After upgrading the Postgres image, run `docker compose down -v` once so the volume is recreated.

### 3. Configure environment files

```bash
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env
cp apps/mobile/.env.example apps/mobile/.env     # only if you work on mobile
```

Generate the two API secrets and paste them into `apps/api/.env`:

```bash
openssl rand -hex 32    # SESSION_TOKEN_PEPPER
openssl rand -hex 32    # OTP_HMAC_SECRET
```

Create `apps/web/.env.local` for the web app:

```bash
API_ORIGIN=http://localhost:4000
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_REOWN_PROJECT_ID=<your Reown project id>
```

### 4. Migrate the database

```bash
pnpm --filter @repo/db db:migrate       # applies packages/db/migrations as the schema owner
pnpm --filter @repo/db db:dev-roles     # sets the local password for the least-privilege runtime role
```

### 5. Run the apps

Run each in its own terminal:

```bash
pnpm --filter api dev            # API on http://localhost:4000 (health: GET /health)
pnpm --filter api dev:worker     # background jobs: prices, performance, search, tracking, notifications
pnpm --filter web dev            # web on http://localhost:3000
```

Make yourself an operator and seed the asset registry (local only):

```bash
pnpm --filter api ops:grant-role -- --user <your-user-uuid> --role ops_admin --operator you@example.com
pnpm --filter api ops:seed-assets -- --user <your-user-uuid>
```

Sign in on the web app first, then take your user id from the `app.users` table (for example `psql postgres://postgres:postgres@localhost:54329/bytesac_dev -c "select id, created_at from app.users"`).

### Mobile

The mobile app uses native wallet modules, so **Expo Go is not supported**. Build a development client, then start
Metro:

```bash
cd apps/mobile
npx expo run:android            # or: npx expo run:ios
npx expo start --dev-client
```

Set `EXPO_PUBLIC_API_URL` (Android emulator: `http://10.0.2.2:4000`) and `EXPO_PUBLIC_REOWN_PROJECT_ID` in
`apps/mobile/.env`. Push notifications need an EAS project and credentials; see
[`apps/mobile/README.md`](apps/mobile/README.md).

### UI work without the backend

For design and front-end work, the web app ships a schema-validated **mock API** with personas:

```bash
pnpm --filter web mock-api       # mock API on :4000
pnpm --filter web dev
```

Open `http://localhost:3000/api/v1/__mock/sign-in?as=investor` (or `manager`, `ops`) to sign in as a persona;
`/api/v1/__mock/sign-out` signs out.

## Environment variables

The API validates its environment at startup (`apps/api/src/config/dotenv.ts`) and refuses to start when a required
value is missing. `apps/api/.env.example` documents every variable; the main groups are:

| Group | Variables | Required |
|---|---|---|
| Server | `NODE_ENV`, `PORT`, `LOG_LEVEL` | defaults exist |
| Database and Redis | `DATABASE_URL`, `REDIS_URL` | yes |
| Auth and sessions | `SESSION_TOKEN_PEPPER`, `OTP_HMAC_SECRET`, `AUTH_DOMAIN`, `AUTH_URI`, `ALLOWED_ORIGINS`, `COOKIE_SECURE`, `TRUST_PROXY` | yes (`TRUST_PROXY` matters in production) |
| Messaging | `RESEND_API_KEY`, `EMAIL_FROM`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `SMS_ALLOWED_COUNTRIES` | yes (placeholders locally) |
| Chain data | `ALCHEMY_API_KEY` | yes (placeholder locally) |
| Files | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | yes |
| Optional features | `COINMARKETCAP_API_KEY`, `GEMINI_API_KEY`, `LIFI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT`, `EXPO_ACCESS_TOKEN`, `GEO_COUNTRY_HEADER` | empty disables the feature |
| Platform wallets | `SOLANA_FEE_PAYER_SECRET`, `EVM_GAS_WALLET_SECRET`, `GAS_TREASURY_SOLANA_ADDRESS`, `REVENUE_TREASURY_SOLANA_ADDRESS` | needed to execute investments |
| Tests | `TEST_DATABASE_URL`, `TEST_ADMIN_DATABASE_URL`, `TEST_REDIS_URL` | for `pnpm test` |

Web: `API_ORIGIN`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_REOWN_PROJECT_ID`, optional `NEXT_PUBLIC_FIREBASE_*` (web push)
and `NEXT_PUBLIC_IOS_APP_URL` / `NEXT_PUBLIC_ANDROID_APP_URL` (app download links). Mobile: `EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_REOWN_PROJECT_ID`, optional `EXPO_PUBLIC_WEB_URL`.

**Never commit real secrets.** Platform wallet keys must move to a KMS or HSM before launch.

## Testing and quality

```bash
pnpm lint            # ESLint across the monorepo (zero warnings)
pnpm check-types     # TypeScript
pnpm test            # Vitest (API needs Docker running) and jest-expo (mobile)
pnpm build           # Production builds
```

Run one workspace with a filter, for example `pnpm --filter web test`. API tests need the `TEST_*` variables and the
local Docker services.

> **Windows note:** Vitest occasionally crashes a worker on Windows (exit `3221226505`); rerun the failing file on its
> own. Mobile Jest inside a path containing `.claude` needs
> `pnpm exec jest --testMatch "**/test/**/*.test.ts?(x)"`.

## Technical aspects

- **Money is exact.** Quantities are integers in base units or `numeric`; never floating point. Fees are snapshotted
  when a plan is created, so later changes never alter a plan.
- **Operations and legs.** An investment, rebalance, repair or sale is an operation of ordered legs
  (`PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`). Each leg is signed against a fresh quote. Partial
  completion is a valid state, and an unknown outcome is reconciled, never blindly retried.
- **Signing safety.** Solana legs are co-signed by the platform fee payer only when the message is byte-identical to the
  provider's. EVM gas drops are capped per user and per day, and the network fee is charged back in the first signed
  step.
- **Chain evidence first.** Positions are a sub-ledger reconciled nightly and on demand against what wallets actually
  hold; shortfalls and surpluses are surfaced with Buy back or Sync.
- **Eligibility.** Tokenized assets are gated by an eligibility engine (declared country and investor status, deny by
  default), and every decision is stored.
- **Security.** Backend sessions with httpOnly cookies on the web and bearer tokens on mobile, CSRF guard on cookie
  mutations, no CORS, rate limits on Redis, least-privilege database roles, secrets read only in one config file, and
  redacted logging.
- **Design system.** Shared light/dark theme roles, the Geist typeface and brand artwork in `@repo/design-tokens`
  ([`docs/design/DESIGN-SYSTEM.md`](docs/design/DESIGN-SYSTEM.md)).

## Deployment

Bytesac has not been deployed yet. [`docs/engineering/DEPLOYMENT.md`](docs/engineering/DEPLOYMENT.md) describes the
services to run, what each needs, the release order, edge and security requirements, and the go-live checklist.

## Documentation

| Read this | For |
|---|---|
| [`docs/README.md`](docs/README.md) | Documentation index and reading order |
| [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) | Runtime, modules, data, stack |
| [`docs/decisions/`](docs/decisions/DECISION-REGISTER.md) | Decision register and ADRs |
| [`docs/domains/`](docs/domains) | Product behaviour by domain |
| [`docs/engineering/CODING-STANDARDS.md`](docs/engineering/CODING-STANDARDS.md) | Conventions, tests, workflow |
| [`docs/engineering/DEPLOYMENT.md`](docs/engineering/DEPLOYMENT.md) | Deploying and operating Bytesac |
| [`docs/OPEN-ITEMS.md`](docs/OPEN-ITEMS.md) | Open work, manual checks, technical debt |
| `apps/*/README.md` | Per-app details (API providers and jobs, web push, mobile builds) |

## Contributing

1. Read [`AGENTS.md`](AGENTS.md) and [`docs/engineering/CODING-STANDARDS.md`](docs/engineering/CODING-STANDARDS.md).
2. Work on a branch and open a pull request against `main`.
3. Keep changes small and coherent; add tests for business rules, state transitions and failure paths.
4. Run `pnpm lint`, `pnpm check-types` and the relevant tests before opening the PR.
5. Update the docs and ADRs in the same change when behaviour or architecture changes.

Do not add dependencies without discussion; the lockfile is checked against a supply-chain policy.

## Security

Please report vulnerabilities privately to the maintainers rather than opening a public issue. Never include real
keys, seed phrases or personal data in issues, commits or logs.

## License

No license has been chosen yet. Until one is added, all rights are reserved.

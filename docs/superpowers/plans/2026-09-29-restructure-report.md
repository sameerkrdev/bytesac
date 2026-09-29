# Restructure report (2026-09-29)

Branch `refactor/packages-and-api-layout`, plan `2026-09-29-restructure.md`. One commit per task.

| Task | Commit |
|---|---|
| 1 Packages | `d5f2be5` refactor(packages) |
| 2 API | `b3e48c4` refactor(api) (includes the provider fixes) |
| 3 Clients | `3318717` refactor(clients) |
| 4 Docs | `docs:` commit (this report, ADR-006, in-place doc rewrites) |

## Task 1: packages

- **Moved:** `apps/api/src/db/*` and `drizzle.config.ts` to `packages/db` (`@repo/db`; migrations now in `packages/db/migrations`). `packages/contracts` renamed to `packages/validator` (`@repo/validator`, adds `export * from "zod"` and `http.ts` with `SESSION_COOKIE`, CSRF and client header names). From `packages/api-client`: `error-copy`, `verify-flow`, `wallet` (+ tests) to the new `packages/app-core`. From web/mobile to `app-core`: `format`, Solana signature helpers (the two variants are merged: `normalizeSolanaSignature` delegates to `assertSolanaSignature`), `createAppQueryClient` (web's version, with fire-once and `qc.clear()`), `useCountdown`. Web and mobile now import these from `@repo/app-core`.
- **Created:** `@repo/logger` (winston, levels error/warn/info/http/debug, redaction by key, 2 tests), `@repo/app-core`, `@repo/db`.
- **Source exports:** all internal packages use `"exports": { ".": "./src/index.ts" }`, lost their `build` script, `dist` and per-package vitest/tsc emit config. `typescript-config/base.json` is now `module: ESNext`, `moduleResolution: bundler`; relative imports in packages are extensionless (Metro does not map `.js` to `.ts`). `turbo.json`: dropped `^build` from lint, check-types, test and dev.
- **Deleted:** `apps/api/tsconfig.build.json`, per-package `vitest.config.ts` where defaults suffice.
- **Deps:** added `envalid`, `tsup` (api dev), `winston`; api-client no longer depends on `zod` (uses the validator re-export); web `react`/`react-dom` 19.2.8 to 19.2.3 (see Deviations); web loses `@repo/ui` dependency (package kept).

## Task 2: API

- **New layout:** `app.ts`, `server.ts`, `env.ts`, `middleware/{error-handler,validate,auth,security,rate-limit,request-context}.ts`, `routes/{auth,me,contacts,preferences,health}.ts`, `services/{sign-in,sessions,contacts,ops,wallets,signatures,sign-in-message,contact-value,otp,audit}.ts`, `providers/{twilio,resend,evm-rpc}.ts`, `ops/cli.ts`.
- **Deleted:** `modules/`, `adapters/`, `shared/`, `http/`, `config/`, `deps.ts`, `worker.ts`, `jobs/`, `DomainError`, `EvmTransportFactory`, `RateLimiter` interface, `SignatureVerifier` factory, `verification-scope`, `session-service` (rotation inlined into sign-in finalize), `challenge-service` and repositories with one caller (inlined), `time.ts`, `redis-options.ts`, dead policy fields.
- **Behavior kept:** routes, status codes, `code` values, cookie/header names, limits, refund-on-failure. Resend gets `idempotencyKey: contact-otp/<verification id>` and no try/catch (the SDK returns errors). Twilio: 60202/20404/404 stay a rejected code (60202 = max check attempts confirmed in Twilio docs); 60203 on send is `429 OTP_COOLDOWN` (Retry-After 600), 429/20429 is `429 RATE_LIMITED` (Retry-After 60); other failures `503 OTP_DELIVERY_FAILED`.
- **Retention:** migration `0002_retention_pg_cron.sql` defines `app.purge_expired()` (SECURITY DEFINER, `search_path = ''`, execute revoked from PUBLIC), schedules `bytesac-retention` at `0 3 * * *` when `cron` exists, drops the retention policies and role. Local Docker now builds `docker/postgres/Dockerfile` (postgres:17 + pg_cron, `cron.database_name=bytesac_dev`, extension created in `init.sql`). Verified on the local container: job present in `cron.job`; scheduling again updates the same job; the migration ran on `bytesac_dev` via `drizzle-kit migrate`.
- **Other library choices:** ed25519 via `node:crypto` (JWK OKP key), `ipaddr.js` for the IP prefix (same output format as before), `rate-limiter-flexible` (fixed window starts at the first request for a key, not at an epoch boundary), morgan to winston `http` level, envalid (`--env-file-if-exists` for local `.env`).
- **Build:** `tsup` bundle with `noExternal: [/^@repo\//]` and a `createRequire` banner (winston is CommonJS). Smoke test: built `dist/server.js` served `/health` (db ok, redis ok) and an unauthenticated logout returned `SESSION_EXPIRED`.
- **Deps removed:** `bullmq`, `pino`, `pino-http`, `@noble/curves`, `zod`, `drizzle-kit`, `uuid` (moved to db); added `envalid`, `http-errors`, `morgan`, `ipaddr.js`, `rate-limiter-flexible`, `@repo/logger`, `@repo/db`, `tsup`.
- **Tests:** providers are faked through `vi.mock` in `test/setup.ts`; rate limits now run against real Redis (denials use `limiter.block`, refunds are asserted on the counters). Tests for deleted indirection were rewritten against behavior: repository state-machine tests became `challenges.test.ts` (through `/v1/auth/verify`); `rotateSession` tests became an add-chain test where the session is revoked mid-flow; the retention test calls `select app.purge_expired()`; `redis-options` test deleted; the "refund after expiry" limiter test is dropped because the library sets a TTL on every write.

## Task 3: clients

- Web: `cookieStorage` + `cookieToInitialState` per the Reown Next.js docs (`storage: createStorage({ storage: cookieStorage })`, `initialState` on `WagmiProvider`, cookie header read in `app/layout.tsx`); `SESSION_COOKIE` from the validator; deleted `components/ui/badge.tsx`, `separator.tsx`; removed `@wagmi/core` (the docs import `cookieStorage`/`createStorage` from it, but `wagmi` re-exports both).
- Mobile: removed `expo-application`, `expo-device`, `expo-glass-effect`, `expo-symbols`, `expo-web-browser`, `@expo/ui`, `text-encoding` (polyfill import removed); `cancel` alias of `reset` deleted; `withTimeout` simplified.
- Verified: web `next build`, mobile jest, `expo export --platform android`.

## Task 4: docs

Rewritten in place: `DECISION-REGISTER.md` (D-017, D-018, D-020, D-034, D-035, D-038, D-040), new `ADR-006-PACKAGE-LAYOUT-AND-PG-CRON.md`, `ADR-001`, `ADR-005`, `ARCHITECTURE.md` (§3, §7, §8, §9), `CODING-STANDARDS.md`, `apps/api/README.md`, spec 1 (§2, §4.2, §4.3, §5.5, §5.6, §6, §7, §9, §10). `docs/source/*` untouched.

## Gate

`pnpm turbo run lint check-types test build`: 28/28 tasks successful (Docker up). Mobile: `expo export --platform android` OK.

| Package | Tests before | Tests after |
|---|---|---|
| @repo/validator (was contracts) | 9 | 9 |
| @repo/design-tokens | 3 | 3 |
| @repo/api-client | 16 | 6 |
| @repo/app-core (new) | - | 17 |
| @repo/logger (new) | - | 2 |
| api | 139 | 144 |
| web | 34 | 29 |
| mobile | 58 | 55 |
| **Total** | **259** | **265** |

Shifts: api-client to app-core (10), web and mobile format/Solana tests to app-core (web 5, mobile 3 including one duplicated format test), logger +2, api +5 net (new provider, Resend, env, retention-policy and revoke-mid-flow tests; removed redis-options, verification-scope and policy tests).

## Deviations

1. **`transpilePackages` not added.** Next 16 docs: workspace packages are transpiled automatically under the App Router; `next build` passes without it.
2. **`@walletconnect/safe-json` kept.** `safeJsonParse` returns the raw string when parsing fails and `safeJsonStringify` passes strings through, so plain `JSON` would change stored values.
3. **`withTimeout` keeps `Promise.resolve().then(task)`** (audit suggested `task()`): an existing test needs a synchronously throwing `disconnectWallet` to be swallowed.
4. **Web `react`/`react-dom` pinned to 19.2.3** (was 19.2.8) to match mobile/RN, so the shared `useCountdown` in `app-core` resolves a single React copy in both apps.
5. **`packages/ui` kept** as instructed (audit item 3 not applied); its react-internal configs stay.
6. **Migration 0002 tolerates a role that other databases still depend on** (roles are cluster-wide; `DROP ROLE` errors with `dependent_objects_still_exist` are ignored after `DROP OWNED BY`).
7. **`action` audit type is now `string`** (derived from the Drizzle column, per audit item 10) instead of a hand-kept union.
8. **`validate` middleware covers params and body only** (no query; Express 5 `req.query` is read-only and no route uses it).
9. **Audit items 13, 23 not applied** (`+native-intent` deliberate host/scheme check; design-tokens exports still asserted by tests). `MIGRATOR_DATABASE_URL` moved to `packages/db/.env`.
10. `expo-doctor` reports duplicate/out-of-date package checks; not investigated (not part of the plan gate).

## Lines changed

`git diff --stat main...HEAD | tail -1`: 241 files changed, 5616 insertions(+), 3866 deletions(-) (includes lockfile and docs)

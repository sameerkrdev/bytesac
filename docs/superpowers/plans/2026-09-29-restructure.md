# Restructure Plan — Packages, API Layout, pg_cron, Audit Cleanups

- **Date:** 2026-09-29 · **Status:** Approved by user
- **Inputs:** `docs/superpowers/audits/2026-09-29-ponytail-audit.md`, reference layout `github.com/sameerkrdev/sameway` (`apps/api`, `packages/logger`, `packages/db`, `packages/validator`).
- **Rule:** behavior stays identical; all existing tests keep passing (moved/adapted as needed). No new product features.

## Goals

1. Shared infrastructure lives in `packages/`; apps contain only app code.
2. API reads like the reference repo: flat `src/` with `app.ts` (exports the configured `app` instance), `server.ts` (imports `app`, listens), `env.ts` (envalid), `middleware/`, `routes/`, `services/`, `providers/`.
3. Replace hand-rolled code with pinned libraries; delete dead code; fix provider usage against **official docs** (fetch them; do not rely on memory).
4. Retention runs in Postgres via `pg_cron`; BullMQ is removed.
5. Docs rewritten in place so decisions are current.

## Target layout

```
packages/
  db/              @repo/db — Drizzle schema, client (postgres.js), migrations, drizzle.config.ts,
                   env (envalid: DATABASE_URL…), migrate + dev-roles scripts, test helpers for DB reset
  logger/          @repo/logger — winston (levels error/warn/info/http/debug), JSON in prod, colorized dev;
                   redaction of secrets/tokens/signatures/OTP/contact values
  validator/       @repo/validator — renamed from @repo/contracts: `export * from "zod"`, chains,
                   error codes + HTTP status map, request/response schemas
  api-client/      @repo/api-client — HTTP client only (cookie/bearer transports, ApiError)
  app-core/        @repo/app-core — NEW: client-side pure logic shared by web + mobile: describeError,
                   verifyReducer, normalizeOtp, chainFromCaip, isUserRejection, WalletRejectedError,
                   ConnectedAccount, canAddChainAccount, Solana signature normalization/validation,
                   shortAddress/formatRelative, createAppQueryClient (expiry handling), useCountdown hook
                   (React only, no DOM/RN imports)
  design-tokens/   @repo/design-tokens
  ui/              keep (do not delete)
  eslint-config/ typescript-config/
apps/api/src/
  app.ts           builds and exports `app` (express instance) — no factory
  server.ts        `import { app } from "./app.js"; app.listen(env.PORT, …)`
  env.ts           envalid `cleanEnv` for all API env vars
  middleware/      error-handler.ts (http-errors + ZodError + malformed JSON + body-parser 4xx),
                   validate.ts (zod body/params/query), auth.ts (requireSession/optionalSession),
                   security.ts (no-CORS, CSRF, dual-auth), rate-limit.ts (rate-limiter-flexible)
  routes/          auth.ts, me.ts, contacts.ts, preferences.ts, health.ts
  services/        sign-in.ts (challenge issue + 3-phase verify), sessions.ts, contacts.ts, ops.ts
                   — keep only real logic; inline one-caller layers (verification-scope, session-service,
                   challenge-service, signature-verifier factory, time.ts) where the audit says so
  providers/       twilio.ts, resend.ts, evm-rpc.ts (module-level instances configured from env)
  ops/cli.ts       ops commands
apps/api/test/     vitest; providers replaced with `vi.mock` fakes (no DI factory needed)
```

## Decisions for the implementer

- **Packages export TS source** (`"exports": { ".": "./src/index.ts" }`, plus subpaths if needed); remove their build steps and `dist/`. The API is bundled for production with **tsup** (`noExternal: [/^@repo\//]`), runs in dev with `tsx watch src/server.ts`. Next.js: `transpilePackages` for `@repo/*`. Expo/Metro consumes source (verify with `expo export`). Update `turbo.json` accordingly (read the installed turbo docs first; `creating-an-internal-package.mdx` covers just-in-time packages).
- **Errors:** `http-errors` with a stable `code` property: `createHttpError(409, "…", { code: "ADDRESS_ALREADY_LINKED" })`. Response body stays `{ error: { code, message, details? } }` (clients depend on it). Remove `DomainError`.
- **Logging:** winston via `@repo/logger`; `morgan("combined", { stream: { write: (m) => logger.http(m.trim()) } })`. Never log tokens, cookies, Authorization, signatures, OTP codes, full email/phone.
- **Env:** envalid in `apps/api/src/env.ts` and `packages/db/src/env.ts`; `dotenv/config` or Node `--env-file-if-exists` for local `.env` (pick one, consistently). Drop the custom `loadEnv`/`loadDotEnvIfPresent`/`loadOpsEnv`.
- **Rate limiting:** `rate-limiter-flexible` (`RateLimiterRedis` with ioredis) replaces the custom fixed-window limiter; keep the same limits and refund-on-delivery-failure behavior (`reward`).
- **IP prefix:** `ipaddr.js` replaces hand-rolled IPv6 expansion.
- **Ed25519:** `node:crypto` `verify(null, msg, publicKey, sig)` with a key built from the raw 32-byte public key (JWK `{ kty:"OKP", crv:"Ed25519", x }`); drop `@noble/curves` from the API.
- **Retention via pg_cron:** new migration defines `app.purge_expired()` (SECURITY DEFINER, owned by schema owner) with the exact current purge rules and a `retention.purged` audit insert; schedules it with `cron.schedule('bytesac-retention', '0 3 * * *', 'select app.purge_expired()')` **only if** the `pg_cron` extension is available (guard with a DO block; Supabase: enable the extension in Dashboard → Database → Extensions). Local Docker: switch the compose image to one that ships pg_cron, or keep the guard so local simply skips scheduling; tests call `select app.purge_expired()` directly. Delete BullMQ, `worker.ts`, `jobs/`, `config/redis-options.ts`, the `bytesac_retention` role/grants/policies and `RETENTION_DATABASE_URL`.
- **Provider fixes (verify each against current official docs):** Resend — pass an `idempotencyKey` per verification send; Twilio Verify — correct error-code mapping (60202 max check attempts, 60203 max send attempts, 20404 not found, 20429 rate limit) per Twilio's error docs; Reown web — `cookieStorage` + `cookieToInitialState` SSR pattern from the Reown Next.js docs.
- **Delete (from audit):** unused shadcn `badge.tsx`, `separator.tsx`; unused deps (`pino`, `pino-http`, `@wagmi/core` if unused, unused Expo packages, `@walletconnect/safe-json` if replaceable, `text-encoding` only if Metro no longer needs it — verify with `expo export`). Do **not** delete `packages/ui`.
- **Web/mobile:** replace local copies with imports from `@repo/app-core`; keep screen components per app.
- **Tests:** keep every existing test (move/adapt imports). Test counts may shift only when a test targeted deleted indirection; say so in the report.

## Execution (few large tasks)

1. **Packages** — create `@repo/db`, `@repo/logger`, `@repo/validator` (rename contracts), `@repo/app-core`; switch all packages to source exports; update turbo. Commit.
2. **API** — new layout (`app.ts`/`server.ts`/env/middleware/routes/services/providers), http-errors, winston+morgan, envalid, rate-limiter-flexible, ipaddr.js, node:crypto ed25519, provider fixes, pg_cron retention, tsup build. All API tests green. Commit.
3. **Clients** — web + mobile import from `@repo/app-core`/`@repo/validator`; Reown cookie SSR fix; dead code/deps removed; web build + mobile `expo export` green. Commit.
4. **Docs** — rewrite in place (never append "update" notes; never edit `docs/source/*`): `DECISION-REGISTER.md` (rows D-018 → pg_cron for scheduled DB jobs, BullMQ removed until a real queue is needed; D-017/D-020/D-035 layout + package names; logger winston; errors http-errors; env envalid), new `ADR-006-PACKAGE-LAYOUT-AND-PG-CRON.md`, `ARCHITECTURE.md` (§3 context, §7 persistence, §8 stack, §9 ops), `CODING-STANDARDS.md` (layout, error, logging, env, package-export conventions), `apps/api/README.md`, spec 1 §4.2/§4.3/§6/§7 to match. Commit.

Gate after each task: `pnpm turbo run lint check-types test build` (Docker up for API tests) and, for task 3, `pnpm --filter mobile test` + `expo export --platform android`.

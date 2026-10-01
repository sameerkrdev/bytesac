# ADR-006: Package layout, API structure, BullMQ worker and pg_cron retention

- **Status:** APPROVED
- **Date:** 2026-09-29
- **Owners:** Backend / Platform
- **Related:** D-017, D-018, D-020, D-035, D-038, D-040; ADR-001, ADR-005, ADR-012; spec 1 §4.2, §4.3, §6, §7; spec 7 §6
- **Updated:** 2026-10-01 (Spec 7 introduces the BullMQ worker; retention stays in pg_cron)

## Context
Shared infrastructure (database schema, logging, validation contracts, client logic) lived inside apps or was duplicated between web and mobile. The API had one folder per layer per module, hand-rolled error, env, logging and rate-limit code, and a BullMQ worker with its own database role and Redis connection parser for a single daily purge of three tables. That worker was removed on 2026-09-29 because one SQL job did not justify a queue. Spec 7 (discovery, model performance, AI search) needs real background work: daily price snapshots, performance computation, search-index refreshes and embeddings. A queue is justified again, for that work only.

## Decision
- **Packages hold shared code, apps hold app code.** `@repo/db` (Drizzle schema, postgres.js client, migrations, `drizzle.config.ts`, dev-role and test-reset helpers), `@repo/logger` (winston with redaction), `@repo/validator` (re-exports zod; chains, error codes and HTTP status map, request/response schemas, wire-level names such as `SESSION_COOKIE`), `@repo/api-client` (HTTP client only), `@repo/app-core` (client-side logic shared by web and mobile), `@repo/design-tokens`.
- **Internal packages export TypeScript source** (`"exports": { ".": "./src/index.ts" }`, no build step, no `dist`). Next.js and Expo/Metro compile them as part of the app; the API is bundled for production with tsup (`noExternal: [/^@repo\//]`) and runs in development with `tsx watch`. Relative imports inside packages have no file extensions (`moduleResolution: bundler`).
- **API layout:** flat `apps/api/src` with `app.ts` (exports the configured express `app`), `server.ts` (listens), `env.ts` (envalid), `middleware/`, `routes/`, `services/`, `providers/` (Twilio, Resend, EVM RPC as module-level instances configured from env) and `ops/`. No dependency-injection container or app factory; tests replace providers with `vi.mock` fakes.
- **Errors** are `http-errors` instances carrying a stable `code` from `@repo/validator` (`createHttpError(409, "...", { code: "ADDRESS_ALREADY_LINKED" })`). One error handler produces `{ error: { code, message, details? } }`, maps `ZodError` and malformed or oversized bodies to `VALIDATION_FAILED`, and hides everything else behind `INTERNAL`.
- **Logging** is winston through `@repo/logger` (levels error/warn/info/http/debug; JSON in production) with request logs from morgan at the `http` level. Secrets, tokens, signatures, OTP codes and contact values are redacted by key.
- **Env** is validated with envalid at import time (`apps/api/src/env.ts`, `packages/db/src/env.ts`). Local `.env` files are loaded with Node's `--env-file-if-exists`.
- **Rate limiting** uses `rate-limiter-flexible` (`RateLimiterRedis`), keeping the previous limits and giving points back (`reward`) when a send fails.
- **Retention runs in Postgres.** Migration `0002` defines `app.purge_expired()` (`SECURITY DEFINER`, fixed `search_path`, execute revoked from PUBLIC) with the D-040 rules and a `retention.purged` audit insert, and schedules it with `cron.schedule('bytesac-retention', '0 3 * * *', 'select app.purge_expired()')` only when the `pg_cron` extension exists in the database. The old retention worker, the `bytesac_retention` role, its grants and policies and `RETENTION_DATABASE_URL` are removed.
- **Background work runs in a BullMQ worker (Spec 7).** `apps/api/src/worker.ts` (built by tsup, run with `pnpm --filter api start:worker`, `dev:worker` locally) is a second process on the existing `REDIS_URL` and the API's database role; it adds no credential. Jobs: `price-snapshot` (daily 00:05 UTC), `basket-performance` (enqueued after a successful snapshot), `search-index-refresh` (enqueued after commit by basket, assignment, asset and profile changes, delayed to the end of a 10 s window and shared per basket and window so a burst runs once after all changes), `embed-basket` and a 15-minute embedding sweep (at most 5 attempts per row). Default job attempts are 3 with exponential backoff (not the sweep); failed jobs stay in BullMQ's failed set. Repeatable jobs are registered on start with `Queue.upsertJobScheduler` and fixed scheduler ids, so several worker instances run each schedule once; job writes are idempotent (`ON CONFLICT`, primary keys). Job ids and queue names use `_` (BullMQ rejects `:`). Services enqueue through `enqueue`, which logs and swallows queue errors so a committed change never fails. Jobs only read external prices and write derived tables; they never touch money or user data. See ADR-012.

## Alternatives considered
- Keep BullMQ for retention as well: needs a second credential and Redis durability for one daily SQL job. Retention stays in pg_cron; BullMQ carries only the Spec 7 jobs.
- Run Spec 7 jobs from pg_cron: they call CoinMarketCap and Gemini, which belongs in the application, not in the database.
- Platform scheduler calling an API endpoint: adds an authenticated endpoint and a network hop.
- Compiled packages (`dist`): every task depends on `^build`; slower CI and stale output risks for no consumer that needs plain JavaScript.

## Consequences
### Positive
- Retention needs no separate database role or connection string; the worker adds no credential either.
- One source for schema, contracts, logging and shared client logic.
- Faster `lint`, `check-types` and `test` (no upstream builds).

### Negative / trade-offs
- The purge job is only as observable as `cron.job_run_details`; a failed run is not retried until the next day.
- Production runs a second process (the worker) and needs Redis that does not evict keys (`maxmemory-policy noeviction`); a stopped worker only delays derived data (prices, performance, search index, embeddings).
- Every consumer of a package must be able to compile TypeScript (Next transpiles workspace packages automatically; Metro and tsup handle them as configured).
- Local Docker needs a Postgres image with pg_cron (`docker/postgres/Dockerfile`).

### Security, financial and operational impact
- Purge no longer needs a separate database credential; only the schema owner can run or schedule it. The worker uses the same runtime role as the API (SELECT, INSERT, UPDATE only).
- Supabase: enable the `pg_cron` extension (Dashboard, Database, Extensions) before running migrations, or run `cron.schedule` manually afterwards. Existing environments drop the `bytesac_retention` role when migration `0002` runs (the role is left in place if another database on the cluster still holds grants for it).

## Migration / rollout
Run `pnpm --filter @repo/db db:migrate`. Remove `RETENTION_DATABASE_URL` and `MIGRATOR_DATABASE_URL` from the API environment; `MIGRATOR_DATABASE_URL` is now read from `packages/db/.env`. Stop any running retention worker. Local: `docker compose down -v` once to rebuild the volume with pg_cron (and pgvector since Spec 7). Spec 7: start `start:worker` beside the API.

## Validation
Tests call `select app.purge_expired()` and check the purged rows and the audit event, that the runtime role cannot execute the function, and that the retention policies are gone. The schedule was verified against a local pg_cron container (`cron.job` holds `bytesac-retention`; scheduling again updates the same job).

## Open questions
- Alerting on failed retention runs (`cron.job_run_details`) and on failed BullMQ jobs; a jobs dashboard.

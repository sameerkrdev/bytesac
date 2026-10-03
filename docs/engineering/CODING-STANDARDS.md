# Coding Standards

Defaults for all implementation work. Architecture is in `docs/architecture/ARCHITECTURE.md`; agent safety rules are in the root `AGENTS.md` and repeated in "Agent workflow" below.

## TypeScript
- `strict` on; no `any` (use `unknown` at untrusted boundaries and narrow it); no broad assertions or non-null assertions without a reason.
- Explicit domain types and discriminated unions for state machines; stable string-literal unions instead of implicit `enum` serialization.
- Public function inputs and outputs are typed. `type` for unions and compositions, `interface` where extension contracts help.

## API structure (apps/api/src)
- **Feature modules:** `modules/<feature>/` holds `<feature>.route.ts`, `<feature>.controller.ts` and `<feature>.service.ts`. Large features keep several services (`operations`: operation, plan, quote, submit, gas, investability); audience variants add `.me`, `.org`, `.public` or `.ops` before the role suffix (`baskets.org.route.ts`). Cross-cutting code lives in `config/`, `middlewares/` (`<name>.middleware.ts`) and `providers/`.
- **Roles:**
  - *Route* = `const router: express.Router = express.Router(); ... export default router;`. It declares paths and the middleware chain (`requireSession`, rate limits, `validate({ params, query, body })`) and maps each path to one controller function. Composition routers (`me`, `organizations`, `public`, `ops`) mount sub-routers; sub-routers carry no session middleware, so never mount one alone.
  - *Controller* = exported async functions `export const name = async (req, res, next) => { try { ... res.json(...) } catch (error) { next(error); } }`. It parses the request, builds the request context (`ctx(req)` / `opsCtx(req)` from `request-context.middleware`), calls a service and shapes the response. No business rules, no DB access.
  - *Service* = business rules, DB access (Drizzle), transactions and provider calls. Throws `http-errors` with a stable `code`.
- **Imports:** use the `@/` alias for anything under `src` (tsconfig `paths`, vitest `resolve.alias`; tsup and tsx read the tsconfig). Relative imports only inside one module folder. Packages are imported as `@repo/*`.
- **Cross-module calls only through `@/modules/<other>/<other>.service`** (or a named service file of that module). A module never imports another's route or controller, except composition routes mounting sub-routers. Value-import cycles are forbidden: when two modules need the same function, move it to the module that owns the concept (valuation lives in `portfolio/valuation.service`, wallet address helpers in `auth/wallets.service`, membership guards in `members/access.service`). `test/no-cycles.test.ts` enforces both rules.
- **Entry points:** `app.ts` exports the configured `app` and has no factory or DI container; `server.ts` exposes `startServer()` and shuts down on SIGINT/SIGTERM (close the HTTP server, BullMQ queues, Redis and the DB pool, exit 0; startup failure logs and exits 1); `worker.ts` registers one BullMQ worker per queue with fixed scheduler ids and the same graceful shutdown. Tests replace providers with `vi.mock`.
- **Keep the ops CLI light:** `ops/cli.ts` and the services it imports must not import provider modules, so the CLI starts without provider keys (`test/modules/ops/cli-env.test.ts`).
- **Shared infrastructure** lives in `packages/` (`@repo/db`, `@repo/validator`, `@repo/logger`, `@repo/api-client`, `@repo/app-core`); apps hold app code only. Never import server-only packages into clients.

## API and validation
- Validate params, query, bodies and webhook payloads at the boundary with Zod; shared request and response schemas live in `@repo/validator` (which re-exports zod so every app uses one instance).
- **Error contract:** throw `http-errors` with a stable `code` from `@repo/validator` (`createHttpError(409, "...", { code: "ADDRESS_ALREADY_LINKED" })`). The single error middleware answers `{ error: { code, message, details } }` (`details` optional); never expose stack traces, secrets or provider text. Clients depend on `code`.
- **Error logging:** the handler logs `method`, `path` (no query string), route params, query and body, with keys matching `password|token|signature|secret|otp|code` redacted, plus the stack for non-driver errors. Log through `@repo/logger` (winston); request logs use morgan at the `http` level; never log tokens, cookies, Authorization, signatures, OTP codes or full email/phone.
- Read environment variables only in `config/dotenv.ts` (envalid, validated at startup); local `.env` files load with `--env-file-if-exists`.
- Internal packages export TypeScript source (`"exports": { ".": "./src/index.ts" }`), have no build step and use extensionless relative imports.
- Paginate large collections; make mutations idempotent where retries are possible; enforce authentication and authorization on every protected endpoint (server-side); document API changes and update client types.

## Database and financial correctness
- Drizzle schema and reviewed migrations in `packages/db` are the schema source of truth; never edit production schema without a tracked migration. Scheduled maintenance is a SQL function scheduled with `pg_cron` in a migration, guarded for environments without the extension.
- Transactions for multi-row invariants; exact `numeric` or integer base units for money and token quantities (never JavaScript `number` for authoritative arithmetic); keep token decimals; add foreign keys, unique and check constraints and indexes for important invariants.
- The runtime role has no DELETE: replaceable child rows are revisioned or soft-removed. Never destroy financial, verification, approval or public-history records; use status changes or tombstones; keep ledgers append-only.
- Separate observed balances from logical allocations and reserved amounts; add idempotency and concurrency protection (locks, partial unique indexes, claim-before-send) for execution and shared-asset operations.

## Blockchain and provider integrations
- One adapter per provider capability in `providers/`; provider SDKs never leak into modules. Normalize data without discarding raw identifiers, references and timestamps needed for audit.
- Verify webhook signatures where supported; deduplicate and tolerate out-of-order delivery. Treat timeouts as unknown outcomes until reconciled; respect chain finality; never blindly retry a transaction whose outcome is unknown or replay completed steps.
- Validate route support, slippage, minimums, fees, limits, expiry and eligibility before execution. Do not assume chains share signing, transfer or settlement semantics, or that an asset, bridge or route is supported because an adapter exists.
- Implement from current official provider documentation, not memory.

## State machines
- Explicit states with transitions centralized in one table and invalid transitions tested; keep operation, leg, provider request and transaction states distinct; model partial, retryable, terminal, pending and unknown outcomes.
- Invalidate or recompute plans when version, balances, prices, route, eligibility or pending operations change. Never silently change a user's allocation or execute a manager update.

## Security and privacy
- Never log or commit private keys, seed phrases, tokens, credentials, verification documents or production data; separate public client config from server secrets; least-privilege credentials.
- Authorization is server-side with negative permission tests; treat all external data and uploads as untrusted.

## React and mobile
- Focused, accessible components; separate server, form and ephemeral state; do not duplicate authoritative business calculations in the client; handle loading, empty, stale, partial, error and offline states.
- Wallet prompts must say what the user signs and why. Platform-specific behavior sits behind shared abstractions without forcing false uniformity.
- Web and mobile use the `@/` alias for app-internal imports.

## Testing
- Vitest (api, web, packages) and `jest-expo` (mobile). API tests live in `apps/api/test/modules/<feature>/<name>.test.ts` mirroring the module; provider-only tests in `test/providers/`, middleware tests in `test/middlewares/`, shared fixtures in `test/helpers/`.
- Structural tests that must stay green: `test/route-table.test.ts` (every mounted `METHOD path` against the committed snapshot; update the snapshot only when an endpoint is intentionally added or removed) and `test/no-cycles.test.ts`.
- Unit-test domain calculations, state transitions and policy decisions; integration-test transactions, idempotency, adapters and webhooks; include adversarial cases (duplicate events, stale plans, insufficient funds or gas, route disappearance, price staleness, provider outage, authorization denial) and a regression test for every fixed bug.
- Deterministic fixtures and mocked providers only; never real wallets or funds.
- Run lint, check-types, tests and build before marking work complete. API suites share one test database: never run two suites at once.

## Naming and documentation
- Domain language in names (`investmentOperation`, `basketVersion`, `instrumentDeployment`); avoid `data`, `process`, `handle` for domain services.
- Comments say why, constraints and edge cases. Document non-obvious invariants. Lean code: no one-caller helpers, no wrappers around library calls, library over custom logic.
- Update docs and ADRs in the same change as behavior; rewrite in place, never append "update" notes.

## Agent workflow
- **Load context first:** root `AGENTS.md` (mandatory reading list and source-of-truth hierarchy), `docs/README.md`, architecture, the relevant domain docs, the register and ADRs, then the code, tests and migrations. For auth also read onboarding and permissions; for execution also read the registry, portfolio, pricing and authority decisions.
- **Change protocol:** short task plan and relevant docs; domain invariants and acceptance criteria; smallest coherent change; tests; update the domain doc; update the register or add an ADR when a decision changed (`docs/decisions/ADR-TEMPLATE.md`); check docs and code do not contradict; report actual checks and unresolved issues.
- **Conflicts and open decisions:** report discrepancies between sources, code and decisions instead of silently choosing; ask before resolving anything touching custody, spend authorization, eligibility, money, consent, retention or migration. Never turn a `PROPOSED` design into an approved fact.
- **Evidence:** a basket target is not an actual position; reconcile before and after a repair or rebalance; tokenization does not imply legal ownership, transferability, redemption or eligibility; explain any new dependency or infrastructure.
- **Never:** reveal or store keys or seed phrases; sign, broadcast or trade for real without explicit approval; bypass review, consent, eligibility or limits; claim completion from a submission or webhook; treat manager approval as investor consent; delete history; hardcode secrets or real data; fabricate test results.
- **Completion report:** changed files and behavior, checks actually run and their results, unrun checks and blockers, migrations and configuration needed (never secret values), open decisions and risks.

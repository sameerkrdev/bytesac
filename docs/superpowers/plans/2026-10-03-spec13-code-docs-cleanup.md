# Spec 13 — Code Cleanup (Reference Structure) and Docs Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** few large tasks (five here), tests per task, **one review at the end** (plus one fix wave). This is a move/refactor: no behavior change; full code only for the patterns every module repeats.

**Goal:** Restructure `apps/api/src` into feature modules with routes → controllers → services (user references: Shridhan-Backend and nerve), remove code debt and dead code across the monorepo, and give every docs topic one home.

**Architecture:** `src/{app,server,worker}.ts`, `src/config/`, `src/middlewares/`, `src/providers/`, `src/modules/<feature>/<feature>.{route,controller,service}.ts`; `@/` alias; tests mirror under `test/modules/<feature>/`; route-table snapshot guards endpoints; docs consolidated per spec §6.

**Tech Stack:** Express 5, TypeScript, tsup 8.5.1, Vitest, Drizzle. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-code-docs-cleanup-design.md`

## Global Constraints

- **No behavior change.** Every `/v1/*` path, method, middleware order, rate limit, request schema, response body and status stays identical. Test assertions are not edited except import paths and `vi.mock` specifiers. If a test must change for any other reason, stop and report.
- **Route-table snapshot first (Task 1):** before moving anything, add `test/route-table.test.ts` that walks `app._router` / Express 5 router stack and lists every `METHOD path` (including nested routers) into a sorted array, and commit the snapshot (`test/__snapshots__/route-table.test.ts.snap` via `toMatchSnapshot()`). Every later task must keep it unchanged.
- **Reference style (exact):**
  - Route file: `const router: express.Router = express.Router();` then `router.<method>(path, ...middlewares, controllerFn)`; `export default router;`. No logic.
  - Controller file: `export const <verb><Noun> = async (req: Request, res: Response, next: NextFunction) => { try { const result = await <service fn>(...); res.status(<same status as today>).json(result); } catch (error) { next(error); } };` — reading `req.auth`, `req.ctx`, `req.params`, `req.body`, `req.query` exactly as the current inline handler does.
  - Service file: the moved logic, unchanged; large features keep several `*.service.ts` files named by concern (e.g. `plan.service.ts`, `quote.service.ts`).
  - File names: kebab-case + suffix (`portfolio.route.ts`, `portfolio.controller.ts`, `positions.service.ts`, `auth.middleware.ts`).
  - Imports: `@/…` for anything inside `apps/api/src`; `@repo/*` for packages; relative imports only within the same module folder.
  - `src/config/dotenv.ts` replaces `src/env.ts` (same envalid schema, same export name `env`); `src/config/queues.ts` replaces `src/queues.ts`.
  - `src/server.ts`: `const startServer = async () => { try { const server = app.listen(env.PORT, …); … } catch (error) { logger.error(…); process.exit(1); } }; void startServer();` plus `process.on("SIGINT"|"SIGTERM", shutdown)` where `shutdown` closes the HTTP server, BullMQ queues, Redis clients and the DB pool (existing clients), logs, then `process.exit(0)`. `worker.ts` gets the same signal handling for its workers.
  - `src/app.ts`: same middleware order as today; central error handler keeps the response `{ error: { code, message, details? } }` and logs nerve-style context: `message, name, stack, method, path, params, query, body` with secrets masked (password, token, signature, secret, otp, code fields → `"[redacted]"`).
- **Cross-module rule:** a module imports another module only via `@/modules/<other>/<file>.service`. Routers may be composed (a feature can export extra routers such as `<feature>.ops.route.ts`, mounted by `modules/ops/ops.route.ts` or `app.ts`). No module imports another module's controller.
- **Moves:** `git mv` for every moved file (history kept). One commit per task (more allowed).
- **Alias wiring:** tsconfig `compilerOptions.baseUrl` + `paths: { "@/*": ["src/*"] }`; `tsup.config.ts` resolves `@/` (esbuild alias or tsup `esbuildOptions`); `vitest.config.ts` `resolve.alias: { "@": <abs src> }`; ESLint import resolution if it complains. Confirm against the installed tsup/vitest docs.
- **Safety:** no money logic rewritten; moves only. Tests mock every provider.
- Never stage `.claude/settings.json`, root `AGENTS.md` turbo block noise, generated `apps/*/AGENTS.md`/`CLAUDE.md`, or anything under `.superpowers/`. Never edit `docs/source/*`.
- Known issues: Windows vitest crash 3221226505 → re-run the crashed file alone; vitest in the foreground with stdin `< /dev/null`; no timers/monitors; never two suites at once; full gate `--concurrency=1`.

## Module map (current file → target)

| Module | Route(s) | Services (target names) |
|---|---|---|
| `health` | `routes/health.ts` → `health.route.ts` | — |
| `auth` | `routes/auth.ts` | `sign-in.ts`, `sign-in-message.ts`, `sessions.ts`, `signatures.ts`, `wallets.ts` → `sign-in.service.ts`, `sign-in-message.service.ts`, `sessions.service.ts`, `signatures.service.ts`, `wallets.service.ts` |
| `me` | `routes/me.ts` (incl. chain accounts, eligibility, notifications, push-token endpoints — split per owning module into extra routers mounted under `/v1/me`) | — (calls auth/eligibility/notifications services) |
| `contacts` | `routes/contacts.ts` | `contacts.ts`, `contact-value.ts`, `otp.ts` |
| `preferences` | `routes/preferences.ts` | inline DB code → `preferences.service.ts` |
| `manager-applications` | `routes/manager-applications.ts` | `applications.ts`, `platform-roles.ts`, `manager-profiles.ts` (if only used here; else `discovery`) |
| `organizations` | `routes/organizations.ts` | `organizations.ts`, `organization-review.ts`, `payout-wallets.ts` |
| `members` | `routes/memberships.ts` | `members.ts`, `member-verifications.ts` |
| `assets` | `routes/assets.ts` (+ ops asset routes) | `assets.ts`, `asset-review.ts`, `pricing.ts` |
| `baskets` | `routes/baskets.ts` (+ ops basket routes) | `baskets.ts`, `basket-review.ts`, `public-baskets.ts` |
| `discovery` | public discovery routes | `discovery.ts`, `search-index.ts`, `performance.ts` |
| `public` | `routes/public.ts` (composes public routers of baskets/discovery/organizations/fees) | — |
| `operations` | `routes/operations.ts` | `operations.ts` (split: `plan.service.ts`, `quote.service.ts`, `submit.service.ts` or similar by concern), `gas.ts`, `investability.ts` |
| `portfolio` | `routes/portfolio.ts` | `positions.ts` (split by concern: tracking/settlement, reconciliation, portfolio view) |
| `rebalance` | (routes stay in operations/portfolio routers) | `rebalance.ts` |
| `fees` | fee/earnings/revenue routes | `fees.ts` |
| `eligibility` | eligibility routes | `eligibility.ts` |
| `notifications` | notification/push/adoption routes | `notifications.ts` |
| `routing` | ops routing routes | `routing.ts` |
| `ops` | `routes/ops.ts` → `ops.route.ts` composing feature ops routers | `ops.ts`, `audit.ts` (→ `modules/audit/audit.service.ts` if used widely) |
| `jobs` | — | worker job wiring if not owned by a feature |

`src/middleware/*` → `src/middlewares/{auth,error-handler,rate-limit,request-context,security,validate}.middleware.ts`. `src/providers/*` stay (rename only to kebab-case if needed). Tests: `test/<area>/*` → `test/modules/<feature>/*` (shared `test/helpers/*`, `test/setup.ts`, `test/global-setup.ts`, `test/db/*`, `test/providers/*`, `test/middleware/*` → `test/middlewares/*` stay shared).

## Review Focus

1. **An endpoint silently dropped or reordered middleware** (rate limiter or auth missing after the move): route-table snapshot unchanged and the existing auth/rate-limit tests pass; Task 2/3.
2. **`vi.mock` specifiers not updated** so a test hits a real provider: `test/setup.ts` keeps the offline `fetch` default; every moved test still passes with no network; Task 2/3.
3. **Circular import introduced by the split** (`operations` ↔ `portfolio` ↔ `rebalance`): add a check (`npx madge --circular` is NOT allowed as a new dep — use a tiny node script over `import` statements in a test, or tsc `--traceResolution` is too heavy; implement `test/no-cycles.test.ts` that parses `@/modules/*` imports and fails on a module-level cycle); Task 3.
4. **Shutdown leaves handles open** (tests hang): server/worker shutdown only runs on signals, never on import; tests import `app` only; Task 1.
5. **Error handler logs secrets**: a test posts a body with `password`, `signature`, `otp` and asserts the log entry redacts them; Task 1.

---

### Task 1: Foundation

- [ ] **Step 1:** Add `test/route-table.test.ts` (Global Constraints) and generate the snapshot on the **current** code; commit it alone (`test(api): route table snapshot`).
- [ ] **Step 2:** Alias wiring; `git mv src/env.ts src/config/dotenv.ts`, `src/queues.ts → src/config/queues.ts`, `src/middleware/* → src/middlewares/*.middleware.ts`; update imports (to `@/…`); server.ts/worker.ts shutdown; app.ts error logging with redaction (+ test per Review Focus #5); `test/middleware/* → test/middlewares/*`.
- [ ] **Step 3: Run** `pnpm --filter api lint`, `pnpm --filter api check-types`, `pnpm --filter api build`, then `test/route-table.test.ts`, `test/middlewares/*`, `test/env.test.ts`, `test/health.test.ts` one at a time `< /dev/null` → PASS, snapshot unchanged. **Commit** `refactor(api): config, middlewares, alias, graceful shutdown, error logging`.

### Task 2: Identity, onboarding, registry, baskets, discovery modules

- [ ] **Step 1:** Create modules `health, auth, me, contacts, preferences, manager-applications, organizations, members, assets, baskets, discovery, public, ops` (the ops router composing feature ops routers for the non-money features) per the module map; each inline handler becomes a controller function; services moved with `git mv` and renamed; imports to `@/`.
- [ ] **Step 2:** Move matching tests to `test/modules/<feature>/` (`git mv`), fix imports and `vi.mock` specifiers only.
- [ ] **Step 3: Run** lint, check-types, build; route-table snapshot; then each moved test folder one file at a time → PASS. **Commit** `refactor(api): identity, onboarding, registry, basket and discovery modules`.

### Task 3: Money modules and cycle removal

- [ ] **Step 1:** Create modules `operations, portfolio, rebalance, fees, eligibility, notifications, routing, jobs` (and their ops routers) per the map; split `operations.ts` (769 lines) and `positions.ts` (618 lines) into concern-named services inside their modules (moves, not rewrites); place the shared valuation function in the owning module so `portfolio` and `rebalance` no longer import each other; worker job handlers import from modules.
- [ ] **Step 2:** `test/no-cycles.test.ts` (Review Focus #3). Move tests (`test/execution/*`, `test/fees/*`, `test/eligibility/*`, `test/notifications/*`, `test/hardening/*`, `test/ops/routing.test.ts`) to `test/modules/<feature>/`.
- [ ] **Step 3: Run** lint, check-types, build, route-table snapshot, no-cycles, each moved file one at a time → PASS. **Commit** `refactor(api): operations, portfolio, rebalance, fees, eligibility, notifications and routing modules`.

### Task 4: Debt and dead code (API, packages, web, mobile)

- [ ] **Step 1:** API: remove the duplicated D-071 message (one constant/message builder used by sell and rebalance), one-caller helpers, unused exports (check with `tsc --noUnusedLocals` style grep or the existing ESLint), code-quality items from `docs/OPEN-ITEMS.md` §7 and review Minors marked code-quality (list each handled item in the report). Packages: unused exports and duplicates (grep consumers across the workspace before deleting any export). Web and mobile: dead files/components/exports (no consumer), duplicates, `@/` alias where not already used. Remove unused dependencies only (exact pins kept).
- [ ] **Step 2: Run** the full gate `pnpm turbo run lint check-types test build --continue --concurrency=1 < /dev/null` (re-run crashed files alone), `pnpm --filter mobile test < /dev/null`, mobile `expo export`. **Commit** `refactor: remove dead code and duplicates across the monorepo`.

### Task 5: Docs cleanup and final gate

- [ ] **Step 1:** Per spec §6: merge `docs/superpowers/CONTINUATION.md` into `HANDOFF.md` (one starter prompt, state table, working method, traps, next phase = Spec 14 brief: integration audit; roadmap 14–19; pointers to OPEN-ITEMS, BRAINSTORM-LOG, FUTURE-PLANS) and delete CONTINUATION; remove leftover lists from HANDOFF (point to OPEN-ITEMS, moving any item not already in OPEN-ITEMS into it first); `DECISION-REGISTER.md` → one line per decision (id, decision, status, ADR link) after moving any register-only detail into the right ADR; domain docs → current behavior only with ADR links; `ARCHITECTURE.md` rewritten for the module layout; `CODING-STANDARDS.md` rewritten for Spec 13 conventions; merge `AGENT-GUARDRAILS.md`/`CONTEXT-MANAGEMENT.md` where they duplicate AGENTS.md or each other; `docs/README.md` reading order; root `AGENTS.md` project section and starter prompt pointers updated (do not touch the turbo-managed block); fix every link to CONTINUATION (`grep -rn CONTINUATION docs AGENTS.md apps packages`).
- [ ] **Step 2:** Full gate again (`--concurrency=1`), mobile test, expo export → report. **Commit** `docs: consolidate docs to one source of truth per topic`.

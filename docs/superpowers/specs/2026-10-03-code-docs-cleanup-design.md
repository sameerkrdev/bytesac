# Spec 13 — Code Cleanup (Reference Structure) and Docs Cleanup (Design)

- **Date:** 2026-10-03
- **Status:** Approved in conversation (2026-10-03); written spec pending user review
- **Series:** Spec 13 — after Spec 12; roadmap 14–19 follows
- **References (user-supplied):** `github.com/sameerkrdev/Shridhan-Backend` (layering, controllers, server.ts, e.g. `src/routes/activityRoutes.ts`, `src/controllers/activityController.ts`, `src/server.ts`) and `github.com/sameerkrdev/nerve` (`apps/api-gateway`: file names, `src/config/dotenv.ts`, `@/` imports, `src/app.ts`).

## 1. Intent

Restructure `apps/api` to the user's references inside **feature modules**, remove known code debt and dead code across the monorepo, and make every fact in `docs/` live in exactly one place. **No behavior change:** every existing test keeps its assertions (only import paths and locations change), and every `/v1/*` endpoint keeps its path, method, request and response.

**Success criteria**
1. `apps/api/src` follows §3; routes contain no business logic; controllers are thin functions; services hold logic.
2. A route-table snapshot proves no endpoint was added, removed or changed.
3. Full gate 28/28 at concurrency 1 (plus mobile tests and `expo export`).
4. No import cycles between modules; modules call each other only through `*.service.ts` exports.
5. Each docs topic has one home (§6); CONTINUATION is merged into HANDOFF and removed; the decision register is an index.

## 2. Decisions (this brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | References | Shridhan-Backend and nerve (links above). |
| 2 | Per-aspect choice | Layers → Shridhan (routes → controllers → services); controllers → Shridhan (exported async functions, `try/catch → next(error)`); file names → nerve (`x.route.ts`, `x.controller.ts`, `x.service.ts`, `x.middleware.ts`); config → nerve (`src/config/dotenv.ts`); imports → nerve (`@/` alias); `server.ts` → Shridhan (`startServer()` + SIGINT/SIGTERM shutdown); `app.ts` → nerve (lean app, routers, central error handler with request-context logging). |
| 3 | Folder structure | Feature-based modules (`src/modules/<feature>/`) instead of layered folders. |
| 4 | Error response | Keep `{ error: { code, message, details } }` (clients depend on `code`); adopt nerve's request-context logging only. |
| 5 | Reach | Full restructure of `apps/api`; packages, web and mobile get dead-code/duplicate removal and the `@/` alias only (Specs 15/17 rebuild the UIs). |
| 6 | Docs | One source of truth per topic (§6); history files kept. |

## 3. API layout (`apps/api/src`)

```
app.ts        express app: security middleware as today, json, cookies, morgan → logger.http, routers under /api/v1/*, central error handler
server.ts     startServer(): app.listen in try/catch; SIGINT/SIGTERM → stop accepting, close HTTP server, close BullMQ queues, Redis and the DB pool, exit 0; startup failure → log + exit 1
worker.ts     BullMQ worker entry (same jobs), same graceful shutdown
config/       dotenv.ts (envalid, replaces env.ts), redis.ts, queues.ts (+ enqueue), other shared client config
middlewares/  auth.middleware.ts, validate.middleware.ts, rate-limit.middleware.ts, request-meta.middleware.ts, error.middleware.ts (if extracted from app.ts)
providers/    external service clients only (routes/ for LI.FI + RouteProvider, solana-tx.ts, solana-rpc.ts, evm-rpc.ts, bitcoin.ts, coinmarketcap.ts, resend.ts, twilio.ts, fcm.ts, r2.ts, gemini.ts)
modules/<feature>/
  <feature>.route.ts       express.Router: paths + middleware chain (auth, rate limits, validate) → controller function
  <feature>.controller.ts  export const handlerName = async (req, res, next) => { try { … res.json(…) } catch (e) { next(e) } }
  <feature>.service.ts     business logic (moved, not rewritten); large features keep several *.service.ts files
ops/cli.ts    unchanged role
```

- Module list (final grouping fixed in the plan from the current files): `auth`, `me` (incl. chain accounts), `contacts`, `preferences`, `manager-applications`, `organizations` (incl. payout wallets, review), `members`, `assets`, `baskets` (incl. review, public), `discovery` (search, AI, performance, profiles), `operations` (plan, quote, submit, cancel, tracking, gas), `portfolio` (positions, reconciliation, sync, skip/custom), `rebalance` (rebalance, repair), `fees`, `eligibility`, `notifications`, `routing`, `ops` (ops-only endpoints that do not belong to one feature), `jobs` (worker job handlers if not owned by a feature).
- Imports use `@/…` (tsconfig `paths`, tsup/esbuild alias, vitest `resolve.alias`); packages keep `@repo/*`.
- Cross-module calls only through `@/modules/<other>/<other>.service`; no module imports another's route or controller. The `positions` ↔ `rebalance` cycle is removed by placing the shared valuation function in the owning module.
- Files move with `git mv` (history kept). Tests move to `apps/api/test/modules/<feature>/` (shared helpers stay in `test/helpers/`), assertions unchanged.
- Route-table snapshot: a test lists every mounted `method + path` (walk the express router stack) and compares with a committed snapshot captured **before** the restructure.

## 4. Debt and tidy-up

API: duplicated D-071 message, one-caller helpers, dead exports and code, the code-quality items in `docs/OPEN-ITEMS.md` §7 and the Spec 9–12 review Minors marked as code quality, oversized files split along feature lines. Packages: dead exports and duplicates removed, naming aligned where natural. Web and mobile: dead code, duplicates, `@/` alias where not already used. No dependency changes except removing unused ones (exact pins kept, no `minimumReleaseAgeExclude`).

## 5. Out of scope

Behavior changes, new endpoints, UI restructure (Specs 15/17), CI/deployment (Spec 16), integration audit (Spec 14), changing the error response contract, rewriting service logic beyond moves and dedupe.

## 6. Docs — one home per topic

| Topic | Single home | Change |
|---|---|---|
| Session state, working method, environment traps, next phase, roadmap, starter prompt | `docs/superpowers/HANDOFF.md` | merge `CONTINUATION.md` into it; delete `CONTINUATION.md`; remove leftover lists (link OPEN-ITEMS) |
| Open work | `docs/OPEN-ITEMS.md` | dedupe, keep checkboxes |
| Decisions | ADRs | `DECISION-REGISTER.md` becomes one line per decision (id, decision, status, ADR link); any detail only in the register moves into its ADR first |
| Current product behavior | `docs/domains/*.md` | current state only, link ADRs; remove spec-by-spec history and stale "not built" lines |
| Architecture | `docs/architecture/ARCHITECTURE.md` | rewritten for the module layout and current runtime (API, worker, web, mobile, packages) |
| Conventions | `docs/engineering/CODING-STANDARDS.md` | rewritten for Spec 13 conventions (modules, file names, controllers, `@/`, server shutdown, error contract, tests layout); merge `AGENT-GUARDRAILS.md` / `CONTEXT-MANAGEMENT.md` where they duplicate AGENTS.md or each other |
| Deferred scope | `docs/domains/FUTURE-PLANS.md` | dedupe only |
| History | specs, plans, `docs/superpowers/reviews/`, `BRAINSTORM-LOG.md` | kept as dated records |
| Index | `docs/README.md` | reading order updated |

`AGENTS.md` (repository root, project section) and the HANDOFF starter prompt point to the new homes; `docs/source/*` untouched; the root AGENTS.md turbo-managed block is not edited.

## 7. Testing

Moves never weaken tests. After each move task: lint, check-types, the moved suites and the route-table snapshot. End: full gate at `--concurrency=1`, `pnpm --filter mobile test`, `npx expo export --platform android`.

## 8. Execution shape

Five tasks: (1) foundation — `config/`, `middlewares/` renames, `@/` alias wiring, server.ts/worker.ts shutdown, app.ts logging, route-table snapshot captured before any move; (2) move identity/onboarding/registry/basket/discovery features into modules with controllers; (3) move money features (operations, portfolio, rebalance, fees, eligibility, notifications, routing, jobs) with controllers, remove the cycle, split large files; (4) debt and dead code across API, packages, web, mobile; (5) docs cleanup and the full gate. Staffing: implementer #1 (Sonnet) Tasks 1–3, implementer #2 (Sonnet) Task 4, implementer #3 (Sonnet) Task 5 (fresh contexts keep each agent's context small).

## 9. Open items

None blocking; any endpoint found unreachable or duplicated during the move is reported, not silently removed.

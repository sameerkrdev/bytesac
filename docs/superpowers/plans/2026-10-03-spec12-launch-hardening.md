# Spec 12 — Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** few large tasks (five here), tests per task, **one review at the end** (plus one fix wave). Every fix is small; full code only for the money math.

**Goal:** Fix the must-fix bugs, money/ops correctness issues and small functional bugs listed in the spec, each with a regression test, without new features.

**Architecture:** migration `0016_hardening.sql`; fixes in `providers/coinmarketcap.ts`, `providers/routes/lifi.ts`, `services/{operations,positions,gas,rebalance,fees,notifications,sign-in,members,organizations,baskets,basket-review,contacts}.ts` (names as they exist), root `package.json` overrides; web portfolio, ops application form, contacts, wizard.

**Tech Stack:** Express 5, Drizzle + Postgres 17, BullMQ, Next.js 16, Expo 57, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-launch-hardening-design.md`

## Global Constraints

- Follow the existing code where each bug lives; find it by grepping the names in the spec rows. Every row in spec §4–§6 gets one regression test that fails before the fix.
- **No extra functions:** no one-caller helpers or wrappers. Invoke `ponytail`.
- Values exactly: `MAX_PRICE_IMPACT = 0.05`; backstop skipped when `fromAmountUSD < 10` or USD values missing; dust threshold $1 total market value; recovery auto-stop after 7 days unsent (`created_at` of the recovery leg); slug retry 3 times; ops non-investable alert deduped per instrument per UTC day; notification kind `instrument_not_investable` (ops); audit actions `position.auto_closed`, `position.closed`, `operation.auto_stopped`; auto-stop notification copy "We stopped your unfinished swap; the tokens that arrived are in your wallet."; error copy "This operation is no longer open."
- **Supply chain:** the wagmi fix uses `pnpm.overrides` with versions already in the lockfile; pin exact; never add `minimumReleaseAgeExclude`.
- **Safety:** no new value movement; gas reservation changes must only release or refuse, never send; every terminal path releases unspent reservation once (idempotent). Tests mock every provider; nothing is broadcast.
- Runtime DB role: SELECT/INSERT/UPDATE (no DELETE). Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`, or anything under `.superpowers/`.
- Known issues: Windows vitest crash 3221226505 → re-run the crashed file alone; vitest in the foreground with stdin `< /dev/null`; no timers/monitors; never run two suites concurrently; full gate with `--concurrency=2`. After the wagmi fix `mobile#check-types` must pass.

## Review Focus

1. **Double release of a gas reservation** (stop then sweep, or completion then sweep): the reservation is returned exactly once; test in Task 1.
2. **Price impact near the limit with large fees:** 4% real impact + 1% fees passes; 6% real impact refused; a $9 trade never checked; test in Task 1.
3. **Auto-close racing a pending operation on the same position:** never close a position with an open operation (`PLANNED`/`IN_PROGRESS`) or a non-zero sub-ledger; test in Task 2.
4. **Recovery auto-stop on an operation whose recovery was just submitted:** only `PLANNED` recovery legs older than 7 days trigger it; a `SUBMITTING`/`SUBMITTED` recovery is never stopped; test in Task 1.
5. **Version save with a stale `expectedRevision`:** 409 `VERSION_CONFLICT`; legacy `expectedUpdatedAt` still works when `expectedRevision` is absent; test in Task 3.

---

## File Structure

```
package.json (pnpm.overrides), pnpm-lock.yaml                  wagmi/viem single version
packages/db/src/schema/{fees,baskets}.ts, migrations/0016_hardening.sql   settled_chain_at, revision
packages/validator/src/*                                        expectedRevision, basketName, close endpoint schema, notification kind
apps/api/src/providers/{coinmarketcap,routes/lifi}.ts           per-id parsing; fee-excluded impact backstop
apps/api/src/services/{operations,positions,gas,rebalance,fees,notifications}.ts  money/ops fixes
apps/api/src/services/{sign-in,members,applications,organizations,basket-review,baskets,contacts}.ts  functional bugs (actual file names)
apps/api/src/routes/portfolio.ts                                POST /v1/positions/:id/close
apps/api/test/hardening/{money,positions,functional}.test.ts (+ adjusted existing tests)
apps/mobile/src/lib/appkit.tsx (only if the override fallback is needed)
apps/web/components/{portfolio,ops,contacts,baskets}/*          close button, ops form, contact button, names, expectedRevision
docs/…                                                          D-107+, ADRs in place, OPEN-ITEMS ticks
```

---

### Task 1: Must-fix, price impact, gas reservations, sweeps, recovery auto-stop

- [ ] **Step 1: Failing tests** (`apps/api/test/hardening/money.test.ts`, plus `test/providers/coinmarketcap*.test.ts`): CMC response with one `price: null` id → that instrument `unavailable`, others `ok` and cached; backstop (fee-excluded) per Review Focus #2; `reserveLegGas` after Stop → 409 "This operation is no longer open."; Stop releases unsent non-recovery leg reservations; completion then sweep releases once (Review Focus #1); node-refused drop returns its amount and is not counted toward 5/day; retried drop re-reads receipt and never re-sends a confirmed/pending drop; sweep continues after one record throws (mock one record to throw); recovery auto-stop for a `PLANNED` recovery older than 7 days (PARTIAL, released, audit, notification with `autoStopped`), not for a `SUBMITTED` one (Review Focus #4).
- [ ] **Step 2: Run** each file `< /dev/null` → FAIL.
- [ ] **Step 3: Implement.** Price impact (in `lifi.ts`, both estimate and quote mapping):

```ts
// Fee-excluded impact: route fees already reduce toAmountUSD, so add the included ones back before comparing.
const fromUsd = Number(fromAmountUSD); const toUsd = Number(toAmountUSD);
const includedFees = routeFees.filter((f) => f.included).reduce((s, f) => s + f.amountUsd, 0);
const priceImpact = fromUsd > 0 && Number.isFinite(toUsd) ? Math.max(0, 1 - (toUsd + includedFees) / fromUsd) : null;
if (priceImpact !== null && fromUsd >= 10 && priceImpact > MAX_PRICE_IMPACT) throw createHttpError(503, "Price impact too high for this trade size.", { code: "ROUTE_UNAVAILABLE" });
```

  (Display-only float math is fine here; it gates, never sizes money.) The mobile fix: add `pnpm.overrides` for `@wagmi/core` (and `viem`) at the exact versions web resolves, `pnpm install`, verify `pnpm --filter mobile check-types`, `pnpm --filter mobile test`, `cd apps/mobile && npx expo export --platform android --output-dir <tmp>`; if Reown RN peers break, revert the override and apply the documented scoped type fix with a comment explaining the duplicate peer. Gas: release logic idempotent by computing "unspent = reserved − spent − already released" from the operation's `gasReserved` and drops (reuse the existing release function; extend it to unsent legs of any kind and call it from every terminal transition). Sweeps: per-record try/catch (+ transaction for writes) and `logger.warn` with the record id. Recovery auto-stop: in the 5-minute sweep.
- [ ] **Step 4: Run** the new files, then `test/execution/{gas,tracking,recovery,lifi-hardening,lifi,invest,sell}.test.ts` and `test/discovery/*price*`/`test/assets/*pricing*` one at a time → PASS; `pnpm turbo run lint check-types --filter='!mobile'` and `pnpm --filter mobile check-types` → PASS. **Commit** `fix: price batch, mobile types, price-impact backstop, gas reservations, sweeps, recovery auto-stop`.

---

### Task 2: Positions, non-investable assets, revenue bucketing, migration

- [ ] **Step 1: Failing tests** (`apps/api/test/hardening/positions.test.ts`, `test/fees/reconcile.test.ts`): 100% sell settles → position auto-closed (audit, keep-custom ended); not closed while another leg/operation on it is open or any ledger ≠ 0 or cash ≠ 0 (Review Focus #3); Sync/Accept to zero closes; dust close allowed under $1, refused at ≥ $1, behaves like Leave; rebalance with a held non-investable RWA (permissioned) not bought → plans; that RWA sold without any route → 409 `NOT_INVESTABLE` naming it; ops alert on an instrument becoming non-investable (one `ops_admin` notification per instrument per day, listing baskets); revenue reconcile buckets by `settled_chain_at` (fallback `settled_at`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per spec §5 rows; migration `0016_hardening.sql` (`operation_fees.settled_chain_at`, `basket_versions.revision`), generate/grants/regenerate/migrate as earlier migrations; `settled_chain_at` from the Solana fee signature's block time at settlement (existing RPC client, mocked in tests). **Step 4: Run** the files + `test/execution/{rebalance,sell,sync,reconcile}.test.ts`, `test/eligibility/enforcement.test.ts`, `test/notifications/*` one at a time → PASS; lint + check-types. **Commit** `fix: position auto-close and dust close, non-investable held assets, revenue bucketing`.

---

### Task 3: Functional bugs (API)

- [ ] **Step 1: Failing tests** (`apps/api/test/hardening/functional.test.ts` and the existing suites they belong to): concurrent invite during sign-in → sign-in succeeds (savepoint); rejected invite doesn't consume the 20/h limit; R2 copy then DB failure → copied object deleted (R2 mocked); publish slug collision retried up to 3 times then 500 → succeeds on retry; draft save with stale `expectedRevision` → 409 `VERSION_CONFLICT`, legacy `expectedUpdatedAt` path still works (Review Focus #5); contact add twice for the same value → second returns the existing pending verification (no 404); portfolio positions include `basketName`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per spec §6 (API rows). **Step 4: Run** the files + `test/members/*`, `test/identity/*`, `test/organizations/*`, `test/baskets/*`, `test/contacts/*` one at a time → PASS; lint + check-types. **Commit** `fix: invite races and budget, orphan R2 copy, slug retry, revision lock, contact add idempotency, basket names`.

---

### Task 4: Web

- [ ] **Step 1:** Portfolio: "Close position" on dust positions (confirm dialog: "Remaining tokens stay in your wallet outside this basket."), calls `api.closePosition`; basket names instead of slugs. Ops application form: hide "Not approved" for a proven approved application. Contact add button disabled while pending. Basket wizard sends `expectedRevision` (from the version view). Ops inbox shows `instrument_not_investable` notices with the basket list. Recovery auto-stopped notification copy.
- [ ] **Step 2:** Tests for each (extend existing test files where the components are tested). Run `pnpm --filter web lint`, `pnpm --filter web check-types`, `pnpm --filter web build`, `pnpm --filter web test < /dev/null` (separately) → PASS. **Commit** `fix(web): close dust positions, basket names, ops form option, contact button, revision lock`.

---

### Task 5: Docs and gate

- [ ] **Step 1: Docs (rewrite in place):** `DECISION-REGISTER.md` new rows from D-107 (price-impact backstop, gas reservation lifecycle, position auto-close and dust close, recovery auto-stop, non-investable held assets + ops alert, revenue bucketing, revision lock); rewrite affected rows in place (D-072, D-092/D-096 as applicable, D-082/D-099 recovery rules); ADR-014/015/016/017/018 sections that change; `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`; `docs/OPEN-ITEMS.md` — tick every fixed item (leave unfixed ones); FUTURE-PLANS already holds the deeper Q4/Q5 fixes (verify only). Commit `docs: spec 12 launch hardening`.
- [ ] **Step 2: Full gate** `pnpm turbo run lint check-types test build --continue --concurrency=2 < /dev/null` (expect 28/28 now that mobile check-types passes; re-run crashed api files alone), `pnpm --filter mobile test < /dev/null`, `cd apps/mobile && npx expo export --platform android --output-dir <tmp>` → report.

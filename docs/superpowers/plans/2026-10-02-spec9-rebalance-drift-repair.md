# Spec 9 — Rebalance, Skip/Catch-up, Drift, Repair and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** few large tasks (five here), tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle (money, state); everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Users apply or skip manager versions (one plan from current reconciled holdings to the latest target via USDC on Solana), fix weight drift or keep a custom allocation, resolve `SHORT` holdings by buy-back or sync, and are notified in an inbox, by email and by web push; managers see aggregate adoption counts.

**Architecture:** migration `0012_rebalance.sql`; `@repo/validator` `rebalance.ts` (pure planner math, fee placement, buy scaling, repair split, states, notification copy, schemas); API `services/rebalance.ts` (rebalance/repair/sync/skip/custom plans), Spec 8 `services/operations.ts` + `services/positions.ts` extended (settlement effects, buy scaling at quote, cash reconciliation, drift, states), `services/notifications.ts` (inbox, delivery, fan-out, adoption), `providers/fcm.ts`; worker queue `notifications`; web rebalance review, repair/sync, inbox + bell, push toggle, adoption table, wizard thresholds.

**Tech Stack:** Express 5, Drizzle + Postgres 17, BullMQ (Spec 7 worker), Resend (installed), new pinned deps `firebase-admin` (API) and `firebase` (web) — newest versions allowed by the pnpm minimum release age, Next.js 16, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-rebalance-drift-repair-design.md`

## Global Constraints

- Follow existing patterns: Spec 8 `services/operations.ts` (`insertPlan`, `planQuote`, `findByKey`, `lockOperation`, `setLegStatus`, `setOperationStatus`, `refreshOperationStatus`, `cancelIfExpired`, gas reservation/release), `services/positions.ts` (`settleLeg`, `reconcilePositions`, `getPortfolio`, `resolveLeg`), `services/investability.ts`, `services/baskets.ts` (`requireBasketAction`, `notifyBasket`, `versionDiff`), `providers/resend.ts` (email maps, idempotency keys, log-only failures), `queues.ts`/`worker.ts` (`enqueue`, `_` job ids), `middleware/{auth,validate,rate-limit}.ts`, `services/audit.ts`; tests `apps/api/test/execution/*` (`helpers.ts`, `chain-mocks.ts`); web `components/{invest,portfolio,profile}/*`, tests `apps/web/test/*` (`invest-fixtures.tsx`).
- **No extra functions:** no one-caller helpers, no wrappers. The pure functions in `@repo/validator/rebalance.ts` are justified (money logic tested in isolation, called by the service and tests). Invoke `ponytail`.
- **Official docs first** (record what you confirmed in the report): Firebase Admin `getMessaging().sendEachForMulticast` (error codes for invalid/unregistered tokens), Firebase JS `getMessaging`/`getToken`/`onMessage` with a VAPID key and `firebase-messaging-sw.js` in Next.js `public/`; Postgres `ALTER TYPE … ADD VALUE` transaction rules; Drizzle `selectDistinctOn`.
- **Supply chain:** pin exact versions; newest allowed by pnpm minimum release age; never add `minimumReleaseAgeExclude`.
- **Money:** BigInt raw base units and micro-USDC; prices as BigInt micro-USD per whole token (`priceMicro`); no JS `number` in authoritative math. Floats only for display.
- Values exactly: `MIN_TRADE_BPS_DEFAULT = 50`, `MIN_TRADE_USDC_DEFAULT = "5"`; version override bounds `minTradeBps` 10–1000, `minTradeUsdc` "1"–"100"; `DRIFT_THRESHOLD_BPS_DEFAULT = 500`; drift email/push at most once per position per 7 days; stale reconciliation after 26 h; adoption counts below 5 → `"<5"`; rate limits: rebalance/repair plans share the Spec 8 10 operations/h limit, sync 10/h per user, notification reads 120/min.
- Enums exactly: `operation_kind` + `rebalance`, `repair`; `ledger_reason` + `rebalance`, `repair`, `sync`; `cash_reason` = `rebalance_sell, rebalance_buy, network_fee, sell, sync`; `decision_kind` = `skip, keep_custom, revert_custom, sync`; `allocation_status` = `ALIGNED, WEIGHT_DRIFT, CUSTOMIZED`; `notification_kind` = `rebalance_available, drifted, repair_required, execution_incomplete, basket_paused, basket_unpaused, basket_retirement_pending, basket_retired, lead_changed`. Headlines (priority order) `EXECUTION_PENDING, REPAIR_REQUIRED, EXECUTION_INCOMPLETE, REBALANCE_AVAILABLE, DRIFTED, CUSTOMIZED, ALIGNED`.
- New error codes exactly: `DATA_STALE`, `REPAIR_REQUIRED`, `SHORTFALL_CHANGED`, `VERSION_NOT_CURRENT`. "Already aligned" is a 200 body `{ aligned: true }`, not an error.
- **Safety:** every value-moving transaction is user-signed through the Spec 8 leg flow (unchanged quote/submit/claim/track); publishing a version never trades; sells never exceed `min(allocated, wallet balance)`; buys never spend free USDC; basket cash never counts as free USDC (Spec 8 invest and sell balance checks change to free USDC); `SHORT` blocks rebalance; nothing is retried automatically. **Tests mock LI.FI, RPC, Alchemy, wallets, Resend and FCM — no real network calls, no real funds.**
- Runtime DB role: SELECT/INSERT/UPDATE (no DELETE); ledger, cash, decisions, reconciliation and notifications are append-only except `notifications.read_at`, `push_tokens.revoked_at`, `basket_positions.allocation_*`.
- Web: dark design system, 44 px targets, status text + icon, lucide only; no mobile changes. Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`.
- Known issues: Windows vitest worker crash 3221226505 → re-run crashed files alone; `mobile#check-types` fails on `main` already — ignore that task only; never run two test suites concurrently.

## Review Focus

1. **Basket cash spent as free USDC:** after a `PARTIAL` rebalance leaves 300 USDC of basket cash, a new invest of 300 must fail `INSUFFICIENT_BALANCE` when the wallet holds only that 300; test in Task 2 (`invest refuses basket cash`).
2. **Sells settle at a worse price than planned:** buys must be scaled down to the cash that actually arrived, the last buy taking the rounding remainder, never spending free USDC; test in Task 2 (`buy scaling down`).
3. **Manager publishes v3 while the user's v2 plan is `PLANNED`:** the plan is cancelled with its gas released, the user is notified once; an `IN_PROGRESS` plan keeps running; test in Task 3.
4. **Two baskets short on the same asset and the user clicks Buy back on each:** one plan (second request returns the same plan by idempotency key or 409 `OPERATION_IN_PROGRESS`), received amount split once with remainder; test in Task 2.
5. **Shortfall changes between opening the sync form and saving** (another wallet movement): 409 `SHORTFALL_CHANGED` with fresh figures, nothing written; test in Task 2.

---

## File Structure

```
packages/validator/src/rebalance.ts (+ rebalance.test.ts)  planner math, fee placement, buy scaling, repair split, headline, notification copy, schemas
packages/validator/src/{baskets,errors,execution,index}.ts minTradeBps/minTradeUsdc; error codes; operation kinds; portfolio schema additions
packages/db/src/schema/execution.ts                         enums, cash entries, decisions, operation/ledger/reconciliation column changes
packages/db/src/schema/notifications.ts                     notifications, push_tokens (export from index)
packages/db/migrations/0012_rebalance.sql
apps/api/src/services/rebalance.ts                          createRebalancePlan, createRepairPlan, syncShortfall, skipVersion, keepCustom, revertCustom
apps/api/src/services/operations.ts                         free USDC in invest/sell; buy scaling in quoteLeg
apps/api/src/services/positions.ts                          settleLeg effects; cash reconciliation; allocation status; states in getPortfolio
apps/api/src/services/notifications.ts                      notify, deliverNotification, fanOutToHolders, onVersionPublished, listNotifications, markRead, adoption
apps/api/src/providers/fcm.ts                               firebase-admin messaging (optional credential)
apps/api/src/providers/resend.ts                            sendNotificationEmail
apps/api/src/routes/{operations,portfolio,me,baskets}.ts    new endpoints
apps/api/src/{queues,worker,env}.ts                         notifications queue; FIREBASE_SERVICE_ACCOUNT
apps/api/src/services/{basket-review,baskets}.ts            enqueue publish/basket-notice fan-out
apps/api/test/execution/{rebalance,repair,sync,drift}.test.ts, apps/api/test/notifications/*.test.ts
packages/api-client/src/client.ts
apps/web/app/(app)/portfolio/[positionId]/rebalance/page.tsx, apps/web/app/(app)/portfolio/repair/[asset]/page.tsx, apps/web/app/(app)/notifications/page.tsx
apps/web/components/portfolio/{rebalance-review,repair-panel,position-actions}.tsx, apps/web/components/notifications/{bell,inbox,push-toggle}.tsx
apps/web/components/organization/… adoption table; basket wizard threshold fields
apps/web/public/firebase-messaging-sw.js, apps/web/lib/firebase.ts
apps/web/test/{rebalance-review,repair-panel,notifications,push-toggle,adoption}.test.tsx
docs/…                                                      ADR-015, ADR-013 amend, D-023 rewrite, D-076+, domain, ARCHITECTURE, FUTURE-PLANS, api README, HANDOFF
```

---

### Task 1: Data model, validator and planner math

**Files:** create `packages/validator/src/rebalance.ts` + `rebalance.test.ts`, `packages/db/src/schema/notifications.ts`, migration `0012_rebalance.sql`; modify `packages/validator/src/{baskets,errors,execution,index}.ts`, `packages/db/src/schema/{execution,index}.ts`.

**Produces (exact names, used by Tasks 2–4):**
- `MIN_TRADE_BPS_DEFAULT`, `MIN_TRADE_USDC_DEFAULT`, `DRIFT_THRESHOLD_BPS_DEFAULT`, `POSITION_HEADLINES`, `NOTIFICATION_KINDS`
- `planRebalance(i: PlanInput): PlanResult`, `feePlacement(i): FeePlacement | null`, `scaleBuys(planned: bigint[], available: bigint): bigint[]`, `splitRepair(received: bigint, shares: { positionId: string; shortfall: bigint }[]): Map<string, bigint>`, `headlineOf(s: PositionStates): Headline`, `notificationText(kind, data): { title: string; body: string; link: string }`
- Schemas: `rebalanceRequestSchema { positionId, target: "latest"|"applied", slippageBps (default 100, 1–300), idempotencyKey }`, `repairRequestSchema { deploymentId, slippageBps, idempotencyKey }`, `skipRequestSchema { versionId }`, `syncRequestSchema { asset: { deploymentId: uuid } | "cash", split: { positionId, quantity: rawUnits string }[] (1–50), idempotencyKey }`, `notificationSchema`, `listNotificationsQuerySchema { cursor?, limit 1–50 default 20 }`, `markReadSchema { ids: uuid[] (1–100) } | { all: true }`, `pushTokenSchema { token: string 1–4096, userAgent?: string ≤ 300 }`, `adoptionSchema`, portfolio additions (`states`, `headline`, `cashMicro`, `latestVersion`, `appliedVersionNumber`, `driftThresholdBps`, `repairs[]`).
- `basketRebalanceSchema` gains optional `minTradeBps` (int 10–1000) and `minTradeUsdc` (`DecimalString`, 1–100).
- DB tables/columns per spec §6.

- [ ] **Step 1: Write failing validator tests** (`rebalance.test.ts`), concrete cases:
  - `planRebalance`: V = $10,000 (BTC 4,000 / ETH 3,000 / SOL 2,000 / cash 1,000), target BTC 35 · ETH 35 · SOL 20 · ARB 10 → sells BTC worth $500; buys ETH $500 and ARB $1,000 (cash + sell proceeds = $1,500 covers both); SOL untouched.
  - threshold: weight gap 40 bps → no trade; value gap $4 with 600 bps → no trade (V = $60); both above → trade.
  - removed asset (target 0) of $3 → sold in full despite threshold.
  - everything within threshold → `{ sells: [], buys: [] }`.
  - `reserveMicro` (fee from cash) reduces buys pro-rata.
  - `scaleBuys([300n, 700n], 500n)` → `[150n, 350n]`; `scaleBuys([300n, 700n], 1001n)` → `[300n, 701n]`; `scaleBuys([1n,1n,1n], 2n)` → `[0n,0n,2n]` (last takes remainder).
  - `feePlacement`: free ≥ fee → first/not from cash; no sells, cash ≥ fee → first/from cash; Solana-only sells → after_sells/from cash; any EVM or bitcoin sell and free < fee → null.
  - `splitRepair(10n, [{A,6n},{B,9n}])` → A 4, B 6 (remainder to largest); `splitRepair(20n, …)` → A 6, B 9 (capped); first-listed wins a tie.
  - `headlineOf` priority table; `notificationText` never contains "executed", "bought" or "sold".
- [ ] **Step 2: Run** `pnpm --filter @repo/validator test` → FAIL (module missing).
- [ ] **Step 3: Implement `rebalance.ts`.** Exact money code:

```ts
export const MIN_TRADE_BPS_DEFAULT = 50;
export const MIN_TRADE_USDC_DEFAULT = "5";
export const DRIFT_THRESHOLD_BPS_DEFAULT = 500;

export interface PlanHolding { deploymentId: string; chain: AssetChain; quantity: bigint; decimals: number; priceMicro: bigint }
export interface PlanTarget { deploymentId: string; chain: AssetChain; decimals: number; priceMicro: bigint; bps: number }
export interface PlanInput { holdings: PlanHolding[]; cashMicro: bigint; targets: PlanTarget[]; minTradeBps: number; minTradeMicro: bigint; reserveMicro: bigint }
export interface PlanResult { valueMicro: bigint; sells: { deploymentId: string; chain: AssetChain; quantity: bigint; valueMicro: bigint }[]; buys: { deploymentId: string; chain: AssetChain; amountMicro: bigint }[] }

const abs = (x: bigint) => (x < 0n ? -x : x);
const valueOf = (q: bigint, price: bigint, decimals: number) => (q * price) / 10n ** BigInt(decimals);

/** Current holdings (reconciled, allocated) + basket cash → sells and buys toward the target weights. Removed assets are sold in full. */
export function planRebalance(i: PlanInput): PlanResult {
  const held = new Map(i.holdings.map((h) => [h.deploymentId, h]));
  const valueMicro = i.holdings.reduce((s, h) => s + valueOf(h.quantity, h.priceMicro, h.decimals), i.cashMicro);
  if (valueMicro <= 0n) return { valueMicro, sells: [], buys: [] };
  const sells: PlanResult["sells"] = [];
  const buys: PlanResult["buys"] = [];
  const targetIds = new Set(i.targets.map((t) => t.deploymentId));
  for (const h of i.holdings) {
    if (targetIds.has(h.deploymentId) || h.quantity <= 0n) continue;
    sells.push({ deploymentId: h.deploymentId, chain: h.chain, quantity: h.quantity, valueMicro: valueOf(h.quantity, h.priceMicro, h.decimals) });
  }
  for (const t of i.targets) {
    const h = held.get(t.deploymentId);
    const current = h ? valueOf(h.quantity, h.priceMicro, h.decimals) : 0n;
    const target = (valueMicro * BigInt(t.bps)) / 10_000n;
    const gap = target - current;
    const weightGapBps = abs((current * 10_000n) / valueMicro - BigInt(t.bps));
    if (weightGapBps < BigInt(i.minTradeBps) || abs(gap) < i.minTradeMicro) continue;
    if (gap > 0n) buys.push({ deploymentId: t.deploymentId, chain: t.chain, amountMicro: gap });
    else if (h) {
      const q = (-gap * 10n ** BigInt(h.decimals)) / h.priceMicro;
      const quantity = q < h.quantity ? q : h.quantity;
      if (quantity > 0n) sells.push({ deploymentId: h.deploymentId, chain: h.chain, quantity, valueMicro: valueOf(quantity, h.priceMicro, h.decimals) });
    }
  }
  const available = sells.reduce((s, x) => s + x.valueMicro, i.cashMicro) - i.reserveMicro;
  const wanted = buys.reduce((s, b) => s + b.amountMicro, 0n);
  if (wanted > available) {
    const scaled = scaleBuys(buys.map((b) => b.amountMicro), available > 0n ? available : 0n);
    buys.forEach((b, n) => (b.amountMicro = scaled[n]!));
  }
  return { valueMicro, sells, buys: buys.filter((b) => b.amountMicro > 0n) };
}

/** Proportional split of `available` over planned amounts; the last takes the rounding remainder so nothing is stranded. */
export function scaleBuys(planned: bigint[], available: bigint): bigint[] {
  const total = planned.reduce((s, p) => s + p, 0n);
  if (total === 0n) return planned.map(() => 0n);
  const out = planned.map((p) => (p * available) / total);
  out[out.length - 1] = available - out.slice(0, -1).reduce((s, x) => s + x, 0n);
  return out;
}

export type FeePlacement = { at: "first" | "after_sells"; fromCash: boolean };
/** D-071 extended (spec §4.4). null = refuse with INSUFFICIENT_BALANCE. */
export function feePlacement(i: { freeMicro: bigint; cashMicro: bigint; feeMicro: bigint; sellChains: AssetChain[] }): FeePlacement | null {
  if (i.freeMicro >= i.feeMicro) return { at: "first", fromCash: false };
  if (i.sellChains.length === 0) return i.cashMicro >= i.feeMicro ? { at: "first", fromCash: true } : null;
  return i.sellChains.every((c) => c === "solana") ? { at: "after_sells", fromCash: true } : null;
}

/** Received buy-back split by shortfall share; remainder to the largest (first listed on a tie); each capped at its shortfall (excess stays outside baskets). */
export function splitRepair(received: bigint, shares: { positionId: string; shortfall: bigint }[]): Map<string, bigint> {
  const total = shares.reduce((s, x) => s + x.shortfall, 0n);
  const parts = shares.map((s) => (total > 0n ? (received * s.shortfall) / total : 0n));
  const largest = shares.reduce((m, s, n) => (s.shortfall > shares[m]!.shortfall ? n : m), 0);
  parts[largest]! += received - parts.reduce((s, x) => s + x, 0n);
  return new Map(shares.map((s, n) => [s.positionId, parts[n]! < s.shortfall ? parts[n]! : s.shortfall]));
}
```

  `headlineOf({ version, backing, allocation, execution })`: `PENDING → EXECUTION_PENDING`, `REPAIR_REQUIRED`, `INCOMPLETE → EXECUTION_INCOMPLETE`, `OUT_OF_DATE → REBALANCE_AVAILABLE` (SKIPPED does not raise it), `WEIGHT_DRIFT → DRIFTED`, `CUSTOMIZED`, else `ALIGNED`. `notificationText` copy per spec §9 (placeholder wording; links `/portfolio/<positionId>/rebalance`, `/portfolio/repair/<deploymentId|cash>`, `/portfolio`, `/baskets/<slug>`).
- [ ] **Step 4: Errors, kinds, basket schema.** Add the four error codes to `errors.ts` (+ errors test); `OPERATION_KINDS` gains `rebalance`, `repair`; `basketRebalanceSchema` gains the two optional fields (+ baskets test bounds); export from `index.ts`.
- [ ] **Step 5: Schema + migration.** In `schema/execution.ts`: enum additions; `operations.basketId` nullable, new `deploymentId` (repair), `repairShares jsonb<Record<string,string>>`, `buyScale jsonb<{ num: string; den: string }>`; check `operations_repair_basket` = `(kind::text = 'repair') = (basket_id is null)` (**`::text` cast**: a new enum value cannot be used as an enum literal in the transaction that adds it); `positionLedgerEntries.legId` nullable + `decisionId` (FK `position_decisions`), check exactly one of the two set, drop unique `position_ledger_leg_deployment`, add uniques `(leg_id, position_id, deployment_id)` and `(decision_id, position_id, deployment_id)`; `positionReconciliations.deploymentId` nullable (cash row); `basketPositions.allocationStatus` default `ALIGNED`, `allocationCheckedAt`; new `positionCashEntries` (`id, positionId, amountMicro numeric, reason cash_reason, legId?, decisionId?, createdAt`; check exactly one of leg/decision; unique `(leg_id, position_id, reason)`; index `(position_id)`); new `positionDecisions` (`id, positionId, kind, versionId?, data jsonb, actorUserId, createdAt`; unique partial `(position_id, version_id) where kind::text = 'skip'`; index `(position_id, created_at)`). `schema/notifications.ts`: `notifications` (`id, userId, kind, basketId?, positionId?, data jsonb not null default {}, dedupeKey text not null, readAt, createdAt`; unique `(user_id, dedupe_key)`; index `(user_id, created_at desc)`), `pushTokens` (`id, userId, token unique, userAgent, createdAt, revokedAt`; index `(user_id)`). `pnpm --filter @repo/db db:generate --name=rebalance`; edit the generated SQL so every check/index that names a new enum value uses `::text`; append grants (SELECT/INSERT/UPDATE to the runtime role) and RLS like `0010_positions.sql`; regenerate → "No schema changes"; `pnpm --filter @repo/db db:migrate`.
- [ ] **Step 6: Run** `pnpm --filter @repo/validator test` and `pnpm turbo run check-types --filter=@repo/db --filter=@repo/validator --filter=api` → PASS (fix API type errors from the nullable `basketId`/`legId`/`deploymentId` with narrowings at the existing call sites; behavior unchanged).
- [ ] **Step 7: Commit** `feat(db,validator): rebalance data model and planner math`.

---

### Task 2: Rebalance, repair, sync, skip and custom operations

**Files:** create `apps/api/src/services/rebalance.ts`, `apps/api/test/execution/{rebalance,repair,sync}.test.ts`; modify `apps/api/src/services/{operations,positions}.ts`, `apps/api/src/routes/{operations,portfolio}.ts`, `packages/api-client/src/client.ts`.

**Consumes:** Task 1 names. **Produces:** `createRebalancePlan(ctx, body): Promise<OperationView | { aligned: true }>`, `createRepairPlan(ctx, body)`, `syncShortfall(ctx, body)`, `skipVersion(ctx, positionId, body)`, `keepCustom(ctx, positionId)`, `revertCustom(ctx, positionId)`; `freeUsdcMicro(db, userId, walletUsdc: bigint): Promise<bigint>` (used by invest, sell, rebalance, repair — 4 callers); `basketCashMicro(db, positionId)` (rebalance, sell, states).

- [ ] **Step 1: Failing tests** (mock LI.FI/RPC with `chain-mocks.ts`; seed with `helpers.ts`):
  - `rebalance.test.ts`: apply latest from v1 holdings → legs in order sells → buys, fee first when free USDC covers it; between sells and buys for Solana-only sells without free USDC; EVM sell without free USDC → 409 `INSUFFICIENT_BALANCE`; everything within thresholds → `{ aligned: true }`, position `appliedVersionId` = latest, no operation, audit `position.version_applied`; `target: "applied"` when applied ≠ current → 409 `VERSION_NOT_CURRENT`; `SHORT` deployment → 409 `REPAIR_REQUIRED`; missing price → 409 `DATA_STALE`; skip of v2 then apply v4 after a manual extra buy (wallet surplus) plans from allocated holdings only (surplus untouched); **buy scaling down** (sells settle 10% under estimate → buy legs' `amountIn`/`minOut` rescaled at the first buy quote, last takes remainder, `buyScale` set once; second quote call does not rescale); buy scaling up; settlement effects (sell: ledger −amountIn, cash +received; buy: cash −amountIn, ledger +received; fee from cash: cash −fee); `COMPLETED` sets `appliedVersionId` and ends an active keep-custom (`revert_custom`, `{ reason: "rebalanced" }`); `PARTIAL` keeps the old applied version; **invest refuses basket cash** (wallet USDC = basket cash → `INSUFFICIENT_BALANCE`); Sell to USDC 50% releases 50% of basket cash (cash entry `sell`); idempotency key reuse with a different body → `VALIDATION_FAILED`.
  - `repair.test.ts`: two positions short 6 and 9 on one deployment → one operation, `repairShares` {A: 6, B: 9}, fee first; free USDC below fee + buy → 409 `INSUFFICIENT_BALANCE`; settled received 10 → ledger `repair` A 4, B 6; received 20 → A 6, B 9 (excess outside); second request with a new key while the first is open → 409 `OPERATION_IN_PROGRESS`; deployment not short → 409 `VALIDATION_FAILED`.
  - `sync.test.ts`: exact split writes `sync` ledger entries (negative) + decisions + audit, latest reconciliation then shows OK; sum ≠ shortfall → `VALIDATION_FAILED`; a position omitted or a foreign position → `VALIDATION_FAILED`; **shortfall changed** since the form (reconcile now returns a different total) → 409 `SHORTFALL_CHANGED` with `details: { totalShortfall, positions }`, nothing written; cash sync writes cash entries; skip: records once (second call idempotent), refuses a non-current or already-applied version (`VERSION_NOT_CURRENT`); keep custom stores current weights, refused when `SHORT`; revert writes `revert_custom`.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run test/execution/rebalance.test.ts test/execution/repair.test.ts test/execution/sync.test.ts` → FAIL.
- [ ] **Step 3: Free USDC + Spec 8 changes.** `freeUsdcMicro = max(0, walletUsdc − Σ cash of the user's OPEN positions)`. `createInvestPlan` checks `freeUsdc >= amount`; `createSellPlan` uses free USDC for fee placement. Basket cash release on Sell to USDC / Sell former (`cash × percent / 100`, cash entry `sell`, negative): written in the transaction that claims the operation's **first** leg (`PLANNED → SUBMITTING`, the moment the plan stops being cancellable), keyed by that leg id (unique `(leg_id, position_id, reason)` makes it once per operation). A cancelled or expired sell releases nothing.
- [ ] **Step 4: `createRebalancePlan`.** Under `pg_advisory_xact_lock(hashtext('plan:' || userId))`: idempotency (`findByKey`, kind `rebalance`, same positionId/target else `reused()`); load the OPEN position (owner check → 404); `reconcilePositions(userId)`; latest reconciliation rows for the position: any `SHORT` (deployment or cash) → `REPAIR_REQUIRED`; resolve target version (`latest` = basket `currentVersionId`; `applied` requires `appliedVersionId === currentVersionId` else `VERSION_NOT_CURRENT`); `getInvestability` must be investable for latest (reuse its errors, as invest); prices via `getPrices` — any held or target instrument without a fresh market price → `DATA_STALE`; build `PlanInput` (holdings = `allocatedQuantity`, quantities capped at wallet balance; Bitcoin spendable rule from `createSellPlan`); thresholds from the version `rebalance` (defaults); quote sells (deployment → USDC Solana) and buys (USDC Solana → deployment) with `planQuote`; network fee as Spec 8 (`networkFeeMicro`); `feePlacement` → null → the D-071 409 message; if `fromCash` and placement is first, the fee leg row carries `routeSummary.fromCash = true`; re-run `planRebalance` with `reserveMicro = fee` when `fromCash`; no sells and no buys → write `appliedVersionId` + audit and return `{ aligned: true }`; else `insertPlan` with `kind: "rebalance", positionId, basketId, versionId: target, sellPercent: null, amountUsdc: null`, legs sequence: [fee if first], sells, [fee if after_sells], buys (buy legs `routeSummary.planned = true`), gas reservation as Spec 8.
- [ ] **Step 5: Buy scaling at quote time** (`quoteLeg` in `operations.ts`), under the operation lock, only for `rebalance` operations when the leg is the first buy leg (`fromDeploymentId === null && kind !== "network_fee"`) and `op.buyScale` is null. Exact logic:

```ts
// All earlier legs are final here (legs are sequential). Spend only basket cash: what the settled sells credited plus earlier cash, minus a fee paid from cash.
const available = await basketCashMicro(tx, op.positionId!);
const buys = legs.filter((l) => l.sequence >= leg.sequence && l.fromDeploymentId === null && l.kind !== "network_fee");
const planned = buys.map((l) => BigInt(l.amountIn));
const scaled = scaleBuys(planned, available);
for (const [n, l] of buys.entries()) {
  if (scaled[n]! <= 0n) await setLegStatus(tx, ctx, l, "FAILED", { failureReason: "NO_FUNDS" });
  else await tx.update(operationLegs).set({ amountIn: scaled[n]!.toString(), minOut: ((BigInt(l.minOut!) * scaled[n]!) / planned[n]!).toString() }).where(eq(operationLegs.id, l.id));
}
await tx.update(operations).set({ buyScale: { num: available.toString(), den: planned.reduce((s, p) => s + p, 0n).toString() } }).where(eq(operations.id, op.id));
// If the leg being quoted became FAILED, refreshOperationStatus and return 409 VALIDATION_FAILED "Nothing left to buy".
```

  The existing D-073 price guard then compares the fresh quote to the leg's (scaled) `minOut`.
- [ ] **Step 6: Settlement effects** in `settleLeg` (`positions.ts`), replacing the two-way ledger insert:

```ts
if (leg.kind === "network_fee") {
  if (op.kind === "rebalance" && leg.routeSummary?.fromCash) await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: (-BigInt(leg.amountIn)).toString(), reason: "network_fee", legId: leg.id });
} else if (op.kind === "invest") {
  await tx.insert(positionLedgerEntries).values({ positionId: op.positionId ?? (await openPosition(tx, op)), deploymentId: leg.toDeploymentId!, quantityDelta: received!.toString(), reason: "invest", legId: leg.id });
} else if (op.kind === "repair") {
  const shares = Object.entries(op.repairShares!).map(([positionId, s]) => ({ positionId, shortfall: BigInt(s) }));
  const parts = splitRepair(received!, shares);
  await tx.insert(positionLedgerEntries).values([...parts].filter(([, q]) => q > 0n).map(([positionId, q]) => ({ positionId, deploymentId: leg.toDeploymentId!, quantityDelta: q.toString(), reason: "repair" as const, legId: leg.id })));
} else if (leg.fromDeploymentId) {
  // sell side (sell_to_usdc, sell_former, rebalance sell)
  await tx.insert(positionLedgerEntries).values({ positionId: op.positionId!, deploymentId: leg.fromDeploymentId, quantityDelta: (-BigInt(leg.amountIn)).toString(), reason: op.kind === "rebalance" ? "rebalance" : "sell", legId: leg.id });
  if (op.kind === "rebalance") await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: received!.toString(), reason: "rebalance_sell", legId: leg.id });
} else {
  // rebalance buy
  await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: (-BigInt(leg.amountIn)).toString(), reason: "rebalance_buy", legId: leg.id });
  await tx.insert(positionLedgerEntries).values({ positionId: op.positionId!, deploymentId: leg.toDeploymentId!, quantityDelta: received!.toString(), reason: "rebalance", legId: leg.id });
}
```

  Confirm `received` for sell legs is the chain-evidence USDC amount (Spec 8 `receivedOnChain` for the Solana USDC destination); if Spec 8 left it null for sells, read it the same way the invest path does. In `refreshOperationStatus`, when a `rebalance` becomes `COMPLETED`: set `appliedVersionId = op.versionId`, end active keep-custom, audit `position.version_applied`. (The `execution_incomplete` notification on `PARTIAL`/`FAILED` is added in Task 3, Step 6.)
- [ ] **Step 7: Repair, sync, skip, custom** per spec §4.5 and §5. `createRepairPlan`: advisory lock + idempotency; reconcile; collect OPEN positions with latest reconciliation `SHORT` for the deployment (ordered by `openedAt`); none → `VALIDATION_FAILED`; `S` = Σ (ledger − allocated); fresh price required (`DATA_STALE`); buy amount = `ceil(S × priceMicro × (10_000 + slippageBps) / (10^decimals × 10_000))`; fee via `networkFeeMicro`; `freeUsdc >= fee + buy` else `INSUFFICIENT_BALANCE`; route must be `ACTIVE` (investability constituent check for that deployment); insert `kind: "repair", basketId: null, positionId: null, deploymentId, repairShares, versionId` = the first affected position's applied version (column is NOT NULL). `syncShortfall`: advisory lock + idempotency via `position_decisions.data.idempotencyKey` (same key returns the earlier result); reconcile; compute current shortfalls; compare to the submitted split → rules in spec §5; write in one transaction. `skipVersion`, `keepCustom` (weights from `getPortfolio`-style valuation: reuse the valuation code by computing it once in `rebalance.ts` and calling it from both keep-custom and drift — 2 callers), `revertCustom`.
- [ ] **Step 8: Routes + client.** `POST /v1/operations/rebalance`, `POST /v1/operations/repair` (operations router: requires the Spec 8 eligibility middleware and the 10/h operation limiter); `POST /v1/positions/:id/skip|custom|custom/revert`; `POST /v1/portfolio/sync` (limiter 10/h). `api-client` methods: `rebalance`, `repair`, `skipVersion`, `keepCustom`, `revertCustom`, `sync`.
- [ ] **Step 9: Run** the three new files, then the whole `test/execution` folder (Spec 8 regressions: invest, sell, tracking, reconcile) one file at a time if the Windows crash hits → PASS. `pnpm turbo run lint check-types --filter=api` → PASS.
- [ ] **Step 10: Commit** `feat(api): rebalance, repair, sync, skip and keep-custom operations`.

---

### Task 3: States, cash reconciliation, drift, notifications, invalidation, adoption

**Files:** create `apps/api/src/services/notifications.ts`, `apps/api/src/providers/fcm.ts`, `apps/api/test/execution/drift.test.ts`, `apps/api/test/notifications/{inbox,delivery,fanout,adoption}.test.ts`; modify `apps/api/src/services/{positions,basket-review,baskets,rebalance,operations}.ts`, `apps/api/src/providers/resend.ts`, `apps/api/src/{queues,worker,env}.ts`, `apps/api/src/routes/{me,baskets,portfolio}.ts`, `apps/api/package.json` (`firebase-admin`), `packages/api-client/src/client.ts`.

**Produces:** `notify(tx, n: { userId; kind; basketId?; positionId?; data; dedupeKey }): Promise<string | null>` (returns the new id or null on dedupe; caller enqueues `deliver` after commit); worker queue `notifications` with jobs `deliver { notificationId }`, `version-published { basketId, versionId }`, `basket-notice { basketId, kind, eventId }`; `GET /v1/me/notifications`, `POST /v1/me/notifications/read`, `POST /v1/me/push-tokens`, `POST /v1/me/push-tokens/revoke`, `GET /v1/baskets/:id/adoption`; portfolio states.

- [ ] **Step 1: Failing tests.**
  - `drift.test.ts`: reconcile writes a cash row (wallet USDC 100, Σ cash 150 over two positions 100/50 → shortfall 50 split 33/16 + remainder 1 to the larger → allocated cash 66 and 34, both `SHORT`); drift: weights off by 600 bps with threshold 500 → `WEIGHT_DRIFT` + one `drifted` notification; second reconcile same day → no new notification; 8 days later still drifted → a new one; keep custom snapshot → `CUSTOMIZED`, weights move 600 bps from snapshot → `WEIGHT_DRIFT` + `revert_custom { reason: "moved" }`; new `SHORT` → one `repair_required`; missing price → allocation untouched; portfolio `states`/`headline` per spec §7 table (one case per headline), `DATA_STALE` when the newest reconciliation is 27 h old.
  - `inbox.test.ts`: list newest first with keyset cursor and `unreadCount`; mark read by ids (only own rows) and `all`; dedupe key conflict inserts nothing; other user's ids ignored.
  - `delivery.test.ts`: preference gating per kind (`rebalance`, `portfolioUpdates`, `managerUpdates`); email only to a verified email contact; FCM mock receives non-revoked tokens; FCM `messaging/registration-token-not-registered` and `messaging/invalid-registration-token` revoke that token; Resend or FCM failure logs and resolves; no `FIREBASE_SERVICE_ACCOUNT` → push skipped.
  - `fanout.test.ts`: publish v3 → `version-published` cancels the PLANNED rebalance of that basket (gas reservation released, audit) but not an IN_PROGRESS one; every OPEN position holder gets one `rebalance_available` (dedupe `rebalance:<versionId>:<positionId>`); platform pause / resume / retire / retirement pending / lead approved → matching kind to holders only (closed positions excluded); rebalance `PARTIAL` → `execution_incomplete`.
  - `adoption.test.ts`: counts per published version: open positions on it, applied, skipped, not responded, in progress; values 1–4 → `"<5"`, 0 → 0; non-member → 403/404 as `requireBasketAction` does; no user ids in the body.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Reconcile + drift** (`positions.ts`): after the deployment loop, per user: wallet USDC on Solana vs Σ cash per OPEN position → cash rows (`deploymentId: null`), same pro-rata/remainder rule. Then per OPEN position with every price fresh: actual weights from allocated quantities and prices; target = applied version weights, or the latest active `keep_custom` snapshot; threshold = version `driftThresholdBps ?? DRIFT_THRESHOLD_BPS_DEFAULT`; next status: CUSTOMIZED stays unless a weight moved ≥ threshold from the snapshot (→ `WEIGHT_DRIFT` + `revert_custom { reason: "moved" }`); else `WEIGHT_DRIFT` if any gap ≥ threshold, else `ALIGNED`. Update `allocationStatus`/`allocationCheckedAt`; transition into `WEIGHT_DRIFT` → `notify(drifted)` only when no `drifted` notification for the position in the last 7 days (dedupe key `drifted:<positionId>:<yyyy-mm-dd>`). New `SHORT` row (previous latest row for the same position/asset not SHORT) → `notify(repair_required)` dedupe `short:<positionId>:<deploymentId|cash>:<reconciliation id>`. Enqueue `deliver` for each inserted id after the transaction.
- [ ] **Step 4: Portfolio states** (`getPortfolio`): add per position `states { version, backing, allocation, execution }`, `headline` (`headlineOf`), `cashMicro`, `latestVersion { id, number, rationale, diff }` (reuse `versionDiff`), `appliedVersionNumber`, `driftThresholdBps`; top-level `repairs[]` = per SHORT deployment or cash: `{ asset, symbol, totalShortfall, positions: [{ positionId, basketSlug, ledger, shortfall }] }`.
- [ ] **Step 5: Notifications service + providers.** `providers/fcm.ts`: `initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) })` only when set (envalid `str({ default: "" })`; startup `logger.warn` when empty); `sendPush(tokens, { title, body, link })` → `sendEachForMulticast({ tokens, notification: { title, body }, webpush: { fcmOptions: { link } } })`, returns the tokens whose error code means invalid/unregistered (confirm codes from docs). `resend.ts`: `sendNotificationEmail(to, { title, body, link }, idempotencyKey)` log-only failures, link absolute via `env.WEB_ORIGIN` (or the existing web URL env — check `env.ts`). `notifications.ts`: `notify`, `deliverNotification(id)` (throws when the row is not visible yet so BullMQ retries), `fanOutToHolders(basketId, kind, data, eventKey)`, `onVersionPublished`, `listNotifications`, `markRead`, `registerPushToken` (upsert: un-revoke an existing token for the same user), `revokePushToken`, `getAdoption`. Queue `notifications` + worker entries.
- [ ] **Step 6: Triggers.** `publishVersion` (`basket-review.ts`) enqueues `version-published` after commit when a new version became current (not on the first publish of a new basket). Basket notices: enqueue `basket-notice` next to the existing `notifyBasket` calls for `platform_paused` → `basket_paused`, `platform_resumed` → `basket_unpaused`, `retired` → `basket_retired`, `lead_approved` → `lead_changed`, and at the transition into `RETIREMENT_PENDING` (find it in `basket-review.ts`; it has no manager email today) → `basket_retirement_pending`; manager-initiated pause/resume transitions (if they exist in `baskets.ts`/`basket-review.ts`) → same kinds. `refreshOperationStatus` (Task 2 hook) now calls `notify`.
- [ ] **Step 7: Routes + client.** `me.ts`: notifications list/read (limiter 120/min), push tokens; `baskets.ts`: adoption; client methods `notifications`, `markNotificationsRead`, `registerPushToken`, `revokePushToken`, `basketAdoption`.
- [ ] **Step 8: Run** the five new files, then `test/execution/reconcile.test.ts`, `test/baskets/*` (publish/pause regressions) one at a time if needed → PASS; `pnpm turbo run lint check-types test --filter=api --filter=@repo/validator` → PASS (re-run crashed files alone).
- [ ] **Step 9: Docs for env:** `apps/api/README.md` — `FIREBASE_SERVICE_ACCOUNT`, notifications queue, drift job behavior. **Commit** `feat(api): portfolio states, drift, notifications, push and adoption`.

---

### Task 4: Web

**Files:** create `apps/web/app/(app)/portfolio/[positionId]/rebalance/page.tsx`, `apps/web/app/(app)/portfolio/repair/[asset]/page.tsx`, `apps/web/app/(app)/notifications/page.tsx`, `apps/web/components/portfolio/{rebalance-review,repair-panel,position-actions}.tsx`, `apps/web/components/notifications/{bell,inbox,push-toggle}.tsx`, `apps/web/lib/firebase.ts`, `apps/web/public/firebase-messaging-sw.js`; modify `apps/web/components/portfolio/positions-list.tsx`, `apps/web/components/app-shell.tsx`, `apps/web/components/profile/notifications-section.tsx`, the organization basket page component (adoption table), the basket wizard rebalance step (threshold fields), ops basket review and public basket page (show thresholds), `apps/web/package.json` (`firebase`).

**Consumes:** Task 2–3 API and client methods; `headline`/`states` from the portfolio; `notificationText` for the inbox.

- [ ] **Step 1: Portfolio actions.** `position-actions.tsx` renders the headline badge (status text + lucide icon) and the matching actions: Review update (`REBALANCE_AVAILABLE`/`SKIPPED`), Rebalance to target and Keep custom (`DRIFTED`), Revert custom (`CUSTOMIZED`), Repair (`REPAIR_REQUIRED` → `/portfolio/repair/<asset>`), Continue (`EXECUTION_INCOMPLETE` → rebalance to the same target), operation link (`EXECUTION_PENDING`). Basket cash shown as a "Cash (USDC)" holding row.
- [ ] **Step 2: Rebalance review page.** `?target=latest|applied`. Shows applied → latest version numbers, manager rationale, diff (weights before/after), current vs target weights; "Create plan" calls `rebalance` with a fresh idempotency key (one per page mount) → plan preview reusing the invest wizard's leg list (`leg-progress.tsx`) with: sells, network fee and its source ("paid from your free USDC" / "paid from this basket's sale proceeds"), buys with estimated and minimum output and the note "Buy amounts are resized to what your sales actually return", "No platform or manager fees are charged yet"; then the Spec 8 signer flow. `{ aligned: true }` → "Already aligned with this version — recorded." Skip button (latest only) with "Skipping changes nothing in your wallet." Errors `REPAIR_REQUIRED` (link to repair), `VERSION_NOT_CURRENT`, `DATA_STALE`, `INSUFFICIENT_BALANCE` shown with their messages.
- [ ] **Step 3: Repair page.** Affected baskets with recorded, allocated and shortfall; two tabs: Buy back (cost preview → plan → signer; hidden for `cash`) and Sync (number inputs per basket prefilled pro-rata from the API figures, live sum check "Must add up to N", Save disabled until exact; `SHORTFALL_CHANGED` → refresh figures and show "Your holdings changed — review the new figures"). Quantities displayed with decimals, sent as raw unit strings.
- [ ] **Step 4: Notifications.** `bell.tsx` in `app-shell.tsx` header (unread count badge, `aria-label` with the count, fetch on mount and `visibilitychange`); `/notifications` list (`notificationText` title/body, relative time, unread marker, link), "Mark all read", load more with cursor. `push-toggle.tsx` in the profile notifications section: unsupported browser or missing `NEXT_PUBLIC_FIREBASE_*` → hidden; on enable → `Notification.requestPermission()` → `getToken(messaging, { vapidKey, serviceWorkerRegistration })` → `registerPushToken`; on disable → `revokePushToken` + `deleteToken`. `lib/firebase.ts` initialises the app lazily from `NEXT_PUBLIC_FIREBASE_API_KEY`, `…_PROJECT_ID`, `…_MESSAGING_SENDER_ID`, `…_APP_ID`, `…_VAPID_KEY`; `public/firebase-messaging-sw.js` uses the compat scripts from the same pinned version per Firebase docs (check CSP in `next.config.js` allows them; update CSP if needed and its test).
- [ ] **Step 5: Manager and wizard.** Adoption table on the organization basket detail (per version: open positions, applied, skipped, not responded, in progress; "<5" verbatim). Wizard rebalance step: optional "Minimum trade (bps)" and "Minimum trade (USDC)" inputs with validator bounds and helper text; ops review and the public basket page show them when set.
- [ ] **Step 6: Run** `pnpm --filter web lint check-types build` → PASS (existing tests still pass: `pnpm --filter web test`). **Commit** `feat(web): rebalance review, repair and sync, notifications and push`.

---

### Task 5: Web tests and docs

**Files:** create `apps/web/test/{rebalance-review,repair-panel,notifications,push-toggle,adoption,position-actions}.test.tsx`; modify `apps/web/test/invest-fixtures.tsx` (portfolio fixtures with states); docs below.

- [ ] **Step 1: Web tests** (mock the api client and `firebase/messaging`): position actions per headline; rebalance review renders diff and fee source, aligned response, skip, `REPAIR_REQUIRED` link; repair Sync sum validation, prefill, `SHORTFALL_CHANGED` refresh, Buy back hidden for cash; bell count and mark-all-read; push toggle hidden without config, enable registers the token, disable revokes; adoption "<5"; wizard threshold bounds error. Run `pnpm --filter web test` → PASS. Commit `test(web): rebalance, repair, notifications`.
- [ ] **Step 2: Docs (rewrite in place):** new `docs/decisions/ADR-015-REBALANCE-REPAIR-NOTIFICATIONS.md` (hub routing, thresholds, basket cash, fee placement, buy scaling, repair/sync, states, drift, notifications/FCM, adoption; alternatives: direct pairing, per-basket repair, webhooks); ADR-013 §2/§5/alternatives (hub chosen for release 1, D-023 user-editable split, Solana-hub alternative rewritten); `DECISION-REGISTER.md` D-023 and D-028 rewritten, new D-076.. (routing hub, thresholds, basket cash, fee placement, repair/sync, states/drift, notifications/push, adoption); `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md` (implemented section replaces "Not built"), `docs/domains/USER-FEATURES.md` and `FUND-MANAGER-FEATURES.md` where they describe rebalance/notifications; `ARCHITECTURE.md` (tables, queue, FCM); `FUTURE-PLANS.md` (direct pairing, combined repair plan, Alchemy webhooks, mobile push/screens); `apps/api/README.md` (if not done in Task 3); `apps/web/README.md` Firebase env. Commit `docs: spec 9 rebalance, repair and notifications`.
- [ ] **Step 3: Full gate** `pnpm turbo run lint check-types test build --continue` (re-run crashed api files alone; `mobile#check-types` known failure) → report.

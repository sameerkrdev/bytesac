# Spec 10 — Manager Fees, Platform Fees and Earnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** few large tasks (five here), tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle (money); everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Users pay the manager's investment/rebalance fee straight to the organization's verified payout wallet and an ops-configured platform fee to a revenue treasury, as transfers inside the one user-signed fee leg of each plan; organizations see earnings, ops see revenue.

**Architecture:** migration `0013_fees.sql`; `@repo/validator` `fees.ts` (fee math, schedule resolution, schemas); API `services/fees.ts` (`planFees` used by invest, rebalance, repair and sell; schedules; earnings; revenue; reconcile), `providers/solana-tx.ts` `buildFeeTransfer` takes several transfers; existing `network_fee` leg carries every fee; web previews, ops fees admin, earnings, revenue, public fees page.

**Tech Stack:** Express 5, Drizzle + Postgres 17, BullMQ worker, `@solana/web3.js` 1.99.0 (installed), Next.js 16, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-02-fees-payouts-design.md`

## Global Constraints

- Follow existing patterns: Spec 8/9 `services/operations.ts` (`insertPlan`, `createInvestPlan`, `createSellPlan`, `quoteLeg`, `operationView`), `services/rebalance.ts` (`createRebalancePlan`, `createRepairPlan`, `freeUsdcMicro`), `services/positions.ts` (`settleLeg`), `providers/solana-tx.ts` (`buildFeeTransfer`, `sponsorExposure`, `cosign`), `providers/resend.ts` (`sendOrganizationEmail`, idempotency keys, log-only failures), `services/baskets.ts` (`requireBasketAction`), members permission checks (`ROLE_PERMISSIONS` in `@repo/validator/members.ts`), ops routes and `services/ops.ts` role checks, `queues.ts`/`worker.ts` schedulers, `services/audit.ts`; tests `apps/api/test/execution/*` (`helpers.ts`, `chain-mocks.ts`); web `components/{invest,portfolio,ops,organization,baskets}/*`, tests `apps/web/test/*`.
- **No extra functions:** no one-caller helpers, no wrappers; `planFees` has four callers. Invoke `ponytail`.
- **The combined fee leg keeps the kind `network_fee`** (no new leg kind; spec §5): its `amountIn` is the total of charged fees; the UI labels it "Fees".
- **Money:** BigInt micro-USDC; percent math floors; no JS `number` in authoritative math.
- Values exactly: manager percent 0–100 bps with optional `maxUsdc` (`DecimalString`, > 0); platform bps 0–100, optional `minUsdc`/`maxUsdc` (min ≤ max); dust threshold `FEE_DUST_MICRO = 10_000n` (0.01 USDC) → not charged, `waivedReason: "dust"`; platform operation kinds `invest, rebalance_apply, rebalance_drift, repair, sell_to_usdc, sell_former`; fee kinds `network, manager_entry, manager_rebalance, platform`; waived reasons `payout_wallet_unavailable, dust, no_price`; transfer order network → manager → platform; permission `earnings.read` for `OWNER` and `ADMIN`; schedule `reason` 1–500 chars; reconcile job daily 04:00 UTC; waiver email at most once per organization per UTC day (idempotency key `fee-waived/<orgId>/<yyyy-mm-dd>`); env `REVENUE_TREASURY_SOLANA_ADDRESS` (optional; a plan with a platform fee > 0 and no address → 503 `ROUTE_UNAVAILABLE`).
- Manager rebalance fee only for `rebalance` with `target: "latest"` whose target differs from the applied version; never for drift fix, repair, sync or sell. Management and subscription fees are never charged ("Disclosed — not collected in this release").
- Fees are snapshotted in `operation_fees` at plan creation; later schedule or version changes never alter an existing plan. Fees are not refunded.
- **Safety:** every fee is a transfer inside the user-signed fee leg; the fee payer co-signs only the byte-identical stored message; payout addresses only from a `VERIFIED` payout wallet read at plan time. **Tests mock RPC, LI.FI, Resend and wallets; nothing is broadcast.**
- Runtime DB role: SELECT/INSERT/UPDATE (no DELETE). New error codes: none.
- Web: dark design system, 44 px targets, lucide only; no mobile changes. Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`.
- Known issues: Windows vitest worker crash 3221226505 → re-run crashed files alone; run vitest in the foreground with stdin `< /dev/null` (background runs hang); no timers/monitors; `mobile#check-types` fails on `main` already; never run two test suites concurrently.

## Review Focus

1. **Invest of exactly the minimum with fees:** deployable `A − all fees` must stay > 0 and every constituent share > 0, else `VALIDATION_FAILED` "The amount doesn't cover the fees."; test in Task 2.
2. **Ops raises the platform fee while a user's plan is `PLANNED`:** the user signs the original amounts (fee leg built from `operation_fees`, not the live schedule); test in Task 2.
3. **Organization's payout wallet revoked between two invests:** second plan waives the manager fee (no transfer to any address), records the waiver, emails the owner once per day; test in Task 2.
4. **Fee transaction tampered** (recipient swapped to an attacker's token account): 409 `TX_MISMATCH`, fee payer never signs; test in Task 2.
5. **Manager, Analyst or Viewer requests earnings:** 403; Owner/Admin get only their organization's settled fees; test in Task 3.

---

## File Structure

```
packages/validator/src/fees.ts (+ fees.test.ts)      fee math, schedule resolution, schemas (schedules, earnings, revenue, public fees, operation fees)
packages/validator/src/{baskets,members,execution,index}.ts  feeSchema maxUsdc; earnings.read; operation view fees[]
packages/db/src/schema/fees.ts                         operation_fees, platform_fee_schedules (export from index)
packages/db/src/schema/execution.ts                    platform_wallet_purpose + revenue_treasury
packages/db/migrations/0013_fees.sql
apps/api/src/services/fees.ts                          planFees, schedules (list/save/override/end), earnings, revenue, reconcileRevenue
apps/api/src/services/{operations,rebalance,positions}.ts  fee integration, fee leg build from operation_fees, settledAt
apps/api/src/providers/solana-tx.ts                    buildFeeTransfer(transfers[])
apps/api/src/providers/resend.ts                       organization email kind fee_waived
apps/api/src/routes/{ops,organizations,public}.ts      new endpoints
apps/api/src/{env,queues,worker}.ts                    REVENUE_TREASURY_SOLANA_ADDRESS; revenue-reconcile
apps/api/test/fees/{plan-fees,schedules,earnings,reconcile}.test.ts
packages/api-client/src/client.ts
apps/web/app/(ops)/ops/fees/page.tsx, apps/web/app/(ops)/ops/revenue/page.tsx, apps/web/app/(app)/organization/earnings/page.tsx, apps/web/app/fees/page.tsx
apps/web/components/{ops/fee-schedules,ops/revenue,organization/earnings,invest/fee-lines}.tsx (+ existing previews and wizard)
apps/web/test/{fee-lines,ops-fees,earnings,public-fees}.test.tsx
docs/…                                                 ADR-016, ADR-013 Q3 closed, ADR-011/D-058, D-079 rewritten, D-085+, FUTURE-PLANS, READMEs
```

---

### Task 1: Data model, validator and fee math

**Files:** create `packages/validator/src/fees.ts` + `fees.test.ts`, `packages/db/src/schema/fees.ts`, migration `0013_fees.sql`; modify `packages/validator/src/{baskets,members,execution,index}.ts`, `packages/db/src/schema/{execution,index}.ts`, `apps/api/src/env.ts`.

**Produces:** `FEE_DUST_MICRO`, `PLATFORM_FEE_OPERATIONS`, `FEE_KINDS`, `WAIVED_REASONS`, `managerFeeMicro(fee: Fee | undefined, baseMicro: bigint): bigint`, `platformFeeMicro(s: { bps: number; minMicro: bigint | null; maxMicro: bigint | null }, baseMicro: bigint): bigint`, `resolvePlatformSchedule<T extends ScheduleRow>(rows: T[], i: { organizationId: string | null; basketId: string | null; operation: PlatformFeeOperation; now: Date }): T | null`; schemas `platformFeeScheduleInputSchema { operationKind, bps 0–100, minUsdc?, maxUsdc?, reason }`, `platformFeeOverrideInputSchema` (+ `scope: "organization" | "basket"`, `scopeId: uuid`, `endsAt?` future ISO datetime), `operationFeeViewSchema { kind, amountMicro, recipientLabel, waivedReason }`, `earningsQuerySchema { from?, to?, format?: "json" | "csv" }`, `earningsSchema`, `revenueSchema`, `publicFeesSchema`; `feeSchema` percent variant + optional `maxUsdc`; `ROLE_PERMISSIONS` OWNER and ADMIN gain `earnings.read` (add to the `OrganizationPermission` union).

- [ ] **Step 1: Failing tests** (`fees.test.ts`): manager percent 100 bps of 1 000 USDC = 10 USDC; with `maxUsdc: "5"` → 5; fixed `"2.5"` → 2 500 000; undefined fee → 0; rounding floors (`33 bps` of 1 micro → 0); platform clamp min/max (25 bps of $10 with min $0.10 → 100 000; of $1 000 000 with max $50 → 50 000 000); resolution: basket override beats organization override beats default; superseded rows ignored; expired override (`endsAt` past) ignored; no row → null; schema: `maxUsdc` must be > 0, min ≤ max refine, reason required; `ROLE_PERMISSIONS` earnings.read only for OWNER/ADMIN (members test).
- [ ] **Step 2: Run** `pnpm --filter @repo/validator test` → FAIL.
- [ ] **Step 3: Implement.** Exact money code:

```ts
export const FEE_DUST_MICRO = 10_000n;
export const PLATFORM_FEE_OPERATIONS = ["invest", "rebalance_apply", "rebalance_drift", "repair", "sell_to_usdc", "sell_former"] as const;
export type PlatformFeeOperation = (typeof PLATFORM_FEE_OPERATIONS)[number];

/** Manager entry/rebalance fee on `baseMicro`: percent floors and is capped by `maxUsdc`; fixed is the amount. */
export function managerFeeMicro(fee: Fee | undefined, baseMicro: bigint): bigint {
  if (!fee) return 0n;
  if (fee.type === "fixed") return micro(fee.amountUsdc);
  const pct = (baseMicro * BigInt(fee.bps)) / 10_000n;
  return fee.maxUsdc && pct > micro(fee.maxUsdc) ? micro(fee.maxUsdc) : pct;
}

export function platformFeeMicro(s: { bps: number; minMicro: bigint | null; maxMicro: bigint | null }, baseMicro: bigint): bigint {
  const pct = (baseMicro * BigInt(s.bps)) / 10_000n;
  if (s.bps === 0) return 0n;
  if (s.minMicro !== null && pct < s.minMicro) return s.minMicro;
  if (s.maxMicro !== null && pct > s.maxMicro) return s.maxMicro;
  return pct;
}

export interface ScheduleRow { scope: "default" | "organization" | "basket"; scopeId: string | null; operationKind: PlatformFeeOperation; supersededAt: Date | null; endsAt: Date | null }
/** Active basket override > active organization override > default; superseded or ended rows never apply. */
export function resolvePlatformSchedule<T extends ScheduleRow>(rows: T[], i: { organizationId: string | null; basketId: string | null; operation: PlatformFeeOperation; now: Date }): T | null {
  const live = rows.filter((r) => r.operationKind === i.operation && r.supersededAt === null && (r.endsAt === null || r.endsAt > i.now));
  return live.find((r) => r.scope === "basket" && r.scopeId === i.basketId)
    ?? live.find((r) => r.scope === "organization" && r.scopeId === i.organizationId)
    ?? live.find((r) => r.scope === "default") ?? null;
}
```

  (`micro` is the existing USDC decimal → micro BigInt helper in `execution.ts`.) A platform fee with bps 0 is 0 even when a minimum is set.
- [ ] **Step 4: Schema + migration.** `schema/fees.ts`: enums `fee_kind`, `platform_fee_operation`, `fee_scope`; `operationFees` (spec §8: `id, operationId, legId?, kind, baseMicro numeric, bps?, capMicro?, amountMicro numeric, recipientAddress?, organizationId?, basketId?, scheduleId?, waivedReason?, settledAt?, createdAt`; indexes `(organization_id, settled_at)`, `(kind, settled_at)`, `(operation_id)`), `platformFeeSchedules` (`id, scope, scopeId?, operationKind, bps int check 0–100, minMicro?, maxMicro?, endsAt?, reason, createdBy → users, createdAt, supersededAt?`; check `min_micro <= max_micro` when both set; partial unique on `(scope, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'), operation_kind) where superseded_at is null`). `platform_wallet_purpose` + `revenue_treasury` (only referenced via `::text` in the same migration, as `0012`). `pnpm --filter @repo/db db:generate --name=fees`; grants SELECT/INSERT/UPDATE + RLS like `0012`; regenerate → "No schema changes"; `db:migrate`. `env.ts`: `REVENUE_TREASURY_SOLANA_ADDRESS: str({ default: "" })`.
- [ ] **Step 5: Run** validator tests, `pnpm turbo run lint check-types --filter=@repo/db --filter=@repo/validator --filter=api --filter=web` → PASS. **Commit** `feat(db,validator): fee schedules, operation fees and fee math`.

---

### Task 2: Fee integration into plans and the fee leg

**Files:** create `apps/api/src/services/fees.ts`, `apps/api/test/fees/plan-fees.test.ts`; modify `apps/api/src/services/{operations,rebalance,positions}.ts`, `apps/api/src/providers/{solana-tx,resend}.ts`, `packages/api-client/src/client.ts`.

**Consumes:** Task 1. **Produces:** `planFees(conn, i: PlanFeesInput): Promise<PlannedFees>` (exported from `services/fees.ts`), operation view `fees[]`.

- [ ] **Step 1: Failing tests** (`plan-fees.test.ts`, mocks as Spec 9 execution tests; seed a VERIFIED payout wallet, a default platform schedule and fee terms on the version):
  - invest 1 000 USDC, entry 100 bps cap $5, platform invest 25 bps → `operation_fees` rows network / manager_entry 5 USDC / platform 2.5 USDC; one `network_fee` leg with `amountIn` = total; deployable = 1 000 − total; quote of the fee leg returns a transaction whose decoded instructions are 3 `TransferChecked` to the gas treasury, payout wallet and revenue treasury token accounts (+ CreateIdempotent each) with the recorded amounts.
  - **minimum invest** where fees leave a 0 share → `VALIDATION_FAILED` "The amount doesn't cover the fees.".
  - **schedule edited after plan creation** (ops saves 100 bps) → quoting the fee leg still uses 25 bps amounts.
  - **payout wallet revoked** → manager row `waivedReason: payout_wallet_unavailable`, `amountMicro` 0, no transfer to it; Resend mock called once for two plans the same day.
  - **tampered fee transaction** (recipient changed) at submit → 409 `TX_MISMATCH`.
  - dust: platform fee 0.005 USDC → row `waivedReason: dust`, no transfer.
  - rebalance apply latest: manager_rebalance on `T` (Σ sell values + min(cash, Σ buys)); fees in D-079 branches (free USDC covers total → first; Solana-only sells and no free USDC → between, cash debit = total; EVM sell without free USDC → 409 `INSUFFICIENT_BALANCE` mentioning the total).
  - drift fix (`target: applied`): no manager fee, platform `rebalance_drift` fee applied; repair: no manager fee, platform `repair` on the buy cost, free-USDC check includes it; sell 50%: platform `sell_to_usdc` on planned sale value, no manager fee; sell with no price → platform `no_price` waived.
  - plan with no manager or platform fee → exactly one transfer (unchanged Spec 9 behavior).
  - settlement: fee leg SETTLED → every charged row of the operation gets `settledAt`; FAILED → none.
  - no `REVENUE_TREASURY_SOLANA_ADDRESS` with a platform fee > 0 → 503 `ROUTE_UNAVAILABLE`.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run test/fees/plan-fees.test.ts < /dev/null` → FAIL.
- [ ] **Step 3: `planFees`** in `services/fees.ts`. Exact shape and rules:

```ts
export interface PlanFeesInput {
  networkMicro: bigint;
  operation: PlatformFeeOperation;
  platformBaseMicro: bigint | null;            // null → platform fee waived "no_price"
  manager: { kind: "manager_entry" | "manager_rebalance"; fee: Fee | undefined; baseMicro: bigint } | null;
  organizationId: string | null; basketId: string | null;
}
export interface PlannedFee { kind: FeeKind; baseMicro: bigint; bps: number | null; capMicro: bigint | null; amountMicro: bigint; recipientAddress: string | null; scheduleId: string | null; waivedReason: WaivedReason | null }
export interface PlannedFees { rows: PlannedFee[]; totalMicro: bigint; transfers: { recipient: string; amountMicro: bigint }[] }
```

  Rules: network row always (recipient `env.GAS_TREASURY_SOLANA_ADDRESS`, amount `networkMicro`). Manager: `managerFeeMicro`; if > 0 read the organization's `VERIFIED` payout wallet (`organization_payout_wallets` status `VERIFIED`) — none → amount 0, waived `payout_wallet_unavailable`, then (log-only, sent from `planFees` itself; the daily idempotency key makes a plan that later fails harmless) `sendOrganizationEmail("fee_waived", ownerEmail, {}, "fee-waived/<orgId>/<UTC date>")` + `logger.warn`; < `FEE_DUST_MICRO` → amount 0, waived `dust`. Platform: load schedule rows, `resolvePlatformSchedule`; no row or bps 0 → no platform row; base null → waived `no_price`; `platformFeeMicro`; dust rule; > 0 and no revenue treasury env → throw 503 `ROUTE_UNAVAILABLE`. `transfers` = charged rows (amount > 0) in order network, manager, platform; `totalMicro` = Σ transfers. Callers insert the rows (with `operationId`, `legId` of the fee leg) inside `insertPlan`'s transaction — extend `insertPlan` to take `fees: PlannedFee[]` and insert them after the legs.
- [ ] **Step 4: Wire the four planners.** Invest: `networkMicro` as today, `operation: "invest"`, platform base `A`, manager `{ manager_entry, version fees.entry, A }`; `splitInvestment(A, totalMicro, weights)`; the refusal message for a non-positive deployable or zero share becomes "The amount doesn't cover the fees.". Rebalance: compute `T` from the first `planRebalance` pass; `operation: target === "latest" ? "rebalance_apply" : "rebalance_drift"`; manager only when `target === "latest"` and the target version id ≠ applied (`fees.rebalance`, base `T`); `feePlacement` and `reserveMicro` use `totalMicro`. Repair: `operation: "repair"`, platform base = buy cost, balance check `free ≥ totalMicro + buy`. Sell: `operation: sell_to_usdc | sell_former`, platform base = Σ quantity × fresh market price (any price missing → null), D-071 placement with `totalMicro`.
- [ ] **Step 5: Fee leg build + settlement.** `buildFeeTransfer(i: { owner: string; transfers: { recipient: string; amountMicro: bigint }[] })`: one `CreateIdempotent` + `TransferChecked` per transfer (recipient ATA from recipient + USDC mint), same payer/blockhash as today; `quoteLeg` reads the operation's charged `operation_fees` rows ordered network → manager → platform to build `transfers` (never the live schedule). The gas estimate and reservation count one token-account rent per recipient whose ATA may be created (reuse `sponsorExposure` on the built transaction as today). `settleLeg`: when a `network_fee` leg settles, `update operation_fees set settled_at = now() where operation_id = op.id and amount_micro > 0`. `operationView` gains `fees[]` (`recipientLabel`: "Bytesac (network)", the organization display name, "Bytesac (platform)"). `resend.ts`: `OrganizationEmailKind` + `fee_waived` ("Your organization has no verified payout wallet, so manager fees on your baskets are being waived. Verify a payout wallet to receive fees.").
- [ ] **Step 6: Run** the new file, then `test/execution` one file at a time if the crash hits (Spec 8/9 regressions: invest, sell, rebalance, repair, sync, tracking, solana-cosign) → PASS; `pnpm turbo run lint check-types --filter=api --filter=@repo/validator` → PASS. **Commit** `feat(api): manager and platform fees in plans and the fee leg`.

---

### Task 3: Schedules, public fees, earnings, revenue and reconciliation

**Files:** create `apps/api/test/fees/{schedules,earnings,reconcile}.test.ts`; modify `apps/api/src/services/fees.ts`, `apps/api/src/routes/{ops,organizations,public,baskets}.ts`, `apps/api/src/{queues,worker}.ts`, `packages/api-client/src/client.ts`, `apps/api/README.md`.

**Produces:** `GET/POST /v1/ops/fees`, `GET/POST /v1/ops/fees/overrides`, `POST /v1/ops/fees/overrides/:id/end`, `GET /v1/public/fees`, public basket detail `platformFee`, `GET /v1/organizations/:id/earnings`, `GET /v1/ops/revenue`, worker job `revenue-reconcile`.

- [ ] **Step 1: Failing tests.**
  - `schedules.test.ts`: `ops_admin` saves default invest 25 bps → new row, previous superseded in the same transaction, audit `platform_fee.updated` with reason; `ops_reviewer` save → 403, read → 200; override for an organization then a basket → resolution order visible through `GET /v1/public/baskets/:slug` `platformFee`; end override → superseded, audit `platform_fee.override_ended`; override with past `endsAt` → `VALIDATION_FAILED`; min > max → `VALIDATION_FAILED`; concurrent saves → exactly one active row (partial unique index; second gets a retry-safe 409 `VALIDATION_FAILED` or succeeds superseding — assert one active row). `GET /v1/public/fees` → active defaults only, no reasons.
  - `earnings.test.ts`: OWNER and ADMIN → 200 with settled manager fees grouped by basket, version, kind, month and recent transactions with explorer links; MANAGER, ANALYST, VIEWER → 403; another organization's id → 403/404 per existing org checks; unsettled and waived rows excluded from totals, waived counted separately; `format=csv` → `text/csv` with header `date,basket,version,kind,amount_usdc,tx`; ops revenue → platform totals by operation and month, waived manager fees by reason, CSV; non-ops → 403.
  - `reconcile.test.ts`: settled platform fees for a day equal treasury inflows (mocked RPC) → no warning; differ → `logger.warn("revenue reconciliation mismatch", …)` with both totals; RPC failure → warning, job does not throw.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in `services/fees.ts` (+ routes): schedule list/save/override/end (`ops_admin` for writes; existing ops role middleware; save supersedes under `pg_advisory_xact_lock(hashtext('platform_fee:' || scope || coalesce(scope_id) || operation))`); public fees; basket public detail `platformFee` per operation (resolved for that basket and its organization); earnings (`earnings.read` through the existing organization permission helper) with SQL `date_trunc('month', settled_at)` grouping and CSV built with a plain join (escape commas/quotes); revenue; `reconcileRevenue(day)` reading the revenue treasury USDC ATA signatures for the UTC day via `connection.getSignaturesForAddress` + `getParsedTransactions` (inflows to that ATA only). Queue `revenue-reconcile` with `upsertJobScheduler` cron `0 4 * * *` (UTC), reconciling the previous UTC day.
- [ ] **Step 4: Run** the three files + `test/fees/plan-fees.test.ts` → PASS; lint + check-types. `apps/api/README.md`: `REVENUE_TREASURY_SOLANA_ADDRESS`, fee configuration, the reconcile job. **Commit** `feat(api): platform fee schedules, earnings, revenue and reconciliation`.

---

### Task 4: Web

**Files:** create `apps/web/app/(ops)/ops/fees/page.tsx`, `apps/web/app/(ops)/ops/revenue/page.tsx`, `apps/web/app/(app)/organization/earnings/page.tsx`, `apps/web/app/fees/page.tsx`, `apps/web/components/invest/fee-lines.tsx`, `apps/web/components/ops/{fee-schedules,revenue}.tsx`, `apps/web/components/organization/earnings.tsx`; modify the invest wizard, rebalance review, repair panel and exit dialogs (fee lines), basket wizard fee step (cap input), ops basket review and public basket fee display, ops navigation, organization navigation (Earnings visible with `earnings.read`).

- [ ] **Step 1: Fee lines.** `fee-lines.tsx` renders `operation.fees[]`: "Network fee (paid to Bytesac for gas)", "Manager fee (to <organization>)", "Platform fee", with "Waived — <reason copy>" (`payout_wallet_unavailable` → "the manager has no verified payout wallet", `dust` → "below $0.01", `no_price` → "price unavailable"), total, and "Fees are not refunded if the operation does not complete." Used by every preview; remove "No platform or manager fees are charged yet".
- [ ] **Step 2: Wizard and displays.** Percent fee input gains "Maximum (USDC, optional)"; displays render "1% up to $50"; management and subscription show "Disclosed — not collected in this release"; public basket page shows the platform rates (`platformFee`).
- [ ] **Step 3: Ops.** `/ops/fees`: default schedule table per operation (bps, min, max, last changed by/when, reason) with an edit form (reason required) visible to `ops_admin`; history list; overrides list with create (scope organization/basket by id, operation, bps, min, max, end date, reason) and End. `/ops/revenue`: date range, totals by operation and month, waived manager fees, CSV link.
- [ ] **Step 4: Organization earnings.** `/organization/earnings` (hidden without `earnings.read`): date range, totals by basket/version/kind/month, recent transactions with explorer links, waived count, CSV link. Public `/fees` page: active default schedule plus the note that managers set their own fees shown on each basket.
- [ ] **Step 5: Run** `pnpm --filter web lint check-types build` and `pnpm --filter web test < /dev/null` → PASS. **Commit** `feat(web): fee previews, ops fee admin, earnings, revenue and public fees`.

---

### Task 5: Web tests and docs

**Files:** create `apps/web/test/{fee-lines,ops-fees,earnings,public-fees}.test.tsx`; modify fixtures; docs below.

- [ ] **Step 1: Web tests** (mock the api client): fee lines with all kinds, waived labels and the no-refund note; wizard cap input bounds and "1% up to $50" display; ops fees edit requires reason, reviewer sees read-only; override create/end; earnings page hidden without permission, totals and CSV link; public fees page; revenue page CSV link. Run `pnpm --filter web test < /dev/null` → PASS. Commit `test(web): fee previews, ops fees, earnings`.
- [ ] **Step 2: Docs (rewrite in place):** new `docs/decisions/ADR-016-FEES-AND-EARNINGS.md` (recipients, platform fee schedules and overrides, fee math and caps, timing/no refund, combined fee leg, waivers, reporting, reconciliation; alternatives: treasury + payouts, take rate, subscriptions via delegation); ADR-013 open question 3 closed; ADR-011 and D-058 (cap; management and subscription not collected); D-067/D-079 (fee leg carries every fee; placement uses the total); new D-085..; `docs/domains/{FUND-MANAGER-FEATURES,USER-FEATURES,INVESTMENT-REBALANCING-DRIFT-FIX,BASKET-CREATION}.md`; `ARCHITECTURE.md`; `FUTURE-PLANS.md` (subscriptions: prepaid periods, auto-renew delegation ADR, lapse; management fee accrual; manager and platform fees always up front; fee credits/refunds; platform take rate; tax statements); `apps/web/README.md`. Commit `docs: spec 10 fees and earnings`.
- [ ] **Step 3: Full gate** `pnpm turbo run lint check-types test build --continue < /dev/null` (re-run crashed api files alone; `mobile#check-types` known) → report.

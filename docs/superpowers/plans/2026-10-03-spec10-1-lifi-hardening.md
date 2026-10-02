# Spec 10.1 — LI.FI Integration Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** few large tasks (five here), tests per task, **one review at the end** (plus one fix wave). Full code only where logic is subtle; otherwise paths, interfaces, exact names/values and concrete test cases pointing at existing patterns.

**Goal:** Harden the LI.FI integration: balance-free plan-time estimates for rebalance buys, `SOL_REQUIRED`, Mayan denied for contract destinations, an in-operation recovery leg after a failed destination swap, refund messaging, a 5% price-impact limit, an ops deny list for bridges/exchanges, route fees in previews, and ops tools (LI.FI transfer lookup, token verification, fee-on-transfer flag).

**Architecture:** migration `0014_lifi_hardening.sql`; `providers/routes/{types,lifi}.ts` (`estimate`, `maxPriceImpact`, deny lists, `routeFees`, `priceImpact`, substatus, `SOL_REQUIRED`); `services/operations.ts` (`planQuote` fallback to `estimate`), `services/rebalance.ts` (buys via `estimate`); `services/positions.ts` (`trackOnce` recovery detection, settlement split source/destination); `services/routing.ts` (deny list, tools cache, analytics proxy, token verification); web previews, leg progress, ops routing.

**Tech Stack:** Express 5, Drizzle + Postgres 17, viem (installed), LI.FI REST, Next.js 16, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-lifi-hardening-design.md`

## Global Constraints

- Follow existing patterns: `providers/routes/lifi.ts` (zod-validated responses, `AbortSignal.timeout(10_000)`, `x-lifi-api-key`, Redis-cached `connections`), `services/operations.ts` (`planQuote`, `quoteLeg`, `sponsoredCost`, `lockOperation`, `setLegStatus`, `refreshOperationStatus`, gas reservation in `services/gas.ts`), `services/positions.ts` (`trackOnce`, `settleLeg`, `receivedOnChain`, chain-evidence readers), `providers/evm-rpc.ts` (viem clients), ops routes/role checks, `services/audit.ts`; tests `apps/api/test/execution/*` (`chain-mocks.ts`, `helpers.ts`); web `components/{invest,portfolio,ops}/*`.
- **No extra functions:** no one-caller helpers, no wrappers; the `estimate` method is justified (interface for providers). Invoke `ponytail`.
- **Official docs first:** LI.FI API reference for `POST /v1/advanced/routes` (body shape, `options.maxPriceImpact`, `options.bridges.deny`, `options.exchanges.deny`), `GET /v1/quote` (`maxPriceImpact`, `denyBridges`, `denyExchanges`), `estimate.feeCosts`, `GET /v1/tools`, `GET /v1/tokens` (`verificationStatus` or equivalent field), `GET /v1/analytics/transfers`, the status `substatus` values and the no-SOL refusal message; record exactly what you confirmed and what remains a real-key check.
- Values exactly: `MAX_PRICE_IMPACT = 0.05`; preview warning at price impact ≥ 0.02; conservative Solana estimate exposure = `LAMPORTS_PER_SIGNATURE (5_000n) + MAX_PRIORITY_LAMPORTS (1_000_000n) + TOKEN_ACCOUNT_RENT_LAMPORTS (2_039_280n)`; deny list cache 60 s in-process; tools cache 1 h (Redis); `eth_getCode` result cache per address 1 h (Redis); token verification cache 24 h per chain (Redis); analytics window ±24 h around the leg's `submittedAt`; route policy `reason` 1–500 chars; failure reason `DESTINATION_SWAP_FAILED`; error code `SOL_REQUIRED` (409, "Add a small amount of SOL (~0.003) to your Solana wallet to continue."); price-impact refusal 503 `ROUTE_UNAVAILABLE` "Price impact too high for this trade size."; Mayan tool keys = `/v1/tools` bridge keys starting with `mayan`.
- **Safety:** estimates never authorize anything; execution quotes and every Spec 8 validation are unchanged; the recovery leg is user-signed, sized from chain evidence, ledgered on settlement from chain evidence only (D-075); one recovery per leg; recovery gas within existing caps; deny lists only narrow routes; analytics proxy is `ops_admin` and read-only. **Tests mock LI.FI, RPC and wallets; nothing is broadcast.**
- Runtime DB role: SELECT/INSERT/UPDATE (no DELETE). Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`. No mobile changes.
- Known issues: Windows vitest crash 3221226505 → re-run the crashed file alone; run vitest in the foreground with stdin `< /dev/null`; no timers/monitors; `mobile#check-types` fails on `main`; never run two suites concurrently.

## Review Focus

1. **Recovery double-counting:** a sell leg recovered after a failed destination swap must debit the sold asset once (at failure) and credit proceeds once (at recovery settlement), even if the tracker re-runs; test in Task 2 (re-run `trackOnce` twice).
2. **Recovery from a provider-reported amount:** with LI.FI saying 300 USDC delivered but chain evidence 299, the recovery leg's `amountIn` is 299; with no readable evidence, no recovery leg and the leg is `UNKNOWN`; test in Task 2.
3. **User stops during recovery:** operation `PARTIAL`, the recovery leg cancelled (never sent), gas reservation released per D-072, delivered token untouched; test in Task 2.
4. **Deny list applied everywhere:** estimate, plan quote and execution quote all carry the active deny list and Mayan rule; test in Task 1.
5. **Rebalance with zero free USDC and all value in assets:** planning succeeds via estimates for buys and the plan's buy minimums come from `toAmountMin`; test in Task 1.

---

## File Structure

```
packages/db/src/schema/{execution,assets,routing}.ts   recovery_of, recovery_token; fee_on_transfer; route_policy_entries (new file, export from index)
packages/db/migrations/0014_lifi_hardening.sql
packages/validator/src/{errors,execution,assets}.ts     SOL_REQUIRED; leg view fields; routing schemas; feeOnTransfer
apps/api/src/providers/routes/{types,lifi}.ts           estimate, impact, fees, deny lists, substatus, SOL_REQUIRED
apps/api/src/services/{operations,rebalance,positions,gas}.ts  planQuote fallback, buys via estimate, recovery, settlement split
apps/api/src/services/routing.ts                         deny list, tools, analytics proxy, token verification, contract-destination check
apps/api/src/routes/ops.ts                               /v1/ops/routing*, lifi-transfers, asset fee-on-transfer edit
apps/api/test/execution/{lifi-hardening,recovery}.test.ts, apps/api/test/ops/routing.test.ts
packages/api-client/src/client.ts
apps/web/components/invest/{leg-progress,fee-lines}.tsx, apps/web/components/ops/{routing,lifi-transfers}.tsx, asset review/editor
apps/web/app/(ops)/ops/routing/page.tsx
apps/web/test/{route-fees,recovery,ops-routing}.test.tsx
docs/…                                                   ADR-017, ADR-014 rewritten in place, D-093+, FUTURE-PLANS, OPEN-ITEMS, api README
```

---

### Task 1: Adapter, data model and planners

**Files:** create `packages/db/src/schema/routing.ts`, migration `0014_lifi_hardening.sql`, `apps/api/src/services/routing.ts`, `apps/api/test/execution/lifi-hardening.test.ts`; modify `packages/db/src/schema/{execution,assets,index}.ts`, `packages/validator/src/{errors,execution,assets,index}.ts`, `apps/api/src/providers/routes/{types,lifi}.ts`, `apps/api/src/services/{operations,rebalance}.ts`.

**Produces:** `RouteProvider.estimate(i: LegEstimateInput): Promise<LegEstimate>`; `LegQuote`/`LegEstimate` gain `priceImpact: number | null`, `routeFees: { name: string; amountUsd: number; included: boolean }[]`; `LegStatus` variants gain `substatus?: string`; `routeDenyList(toChain: AssetChain, toAddress: string): Promise<{ bridges: string[]; exchanges: string[] }>` in `services/routing.ts` (called by `planQuote`, `quoteLeg` and the recovery estimate — 3 callers); schema `routePolicyEntries`; `operationLegs.recoveryOf`, `operationLegs.recoveryToken`; `instrumentDeployments.feeOnTransfer`.

- [ ] **Step 1: Failing tests** (`lifi-hardening.test.ts`, LI.FI and RPC mocked via `chain-mocks.ts`): `estimate` posts to `/v1/advanced/routes` without `fromAddress` and maps the first route (toAmount, toAmountMin, gas, fees, tool summary); `quote` and `estimate` both send `maxPriceImpact: 0.05` and the deny lists; a denied bridge row and a contract destination (mock `getCode` → `0x60...`) produce `denyBridges` containing that key and every `mayan*` key, an EOA destination (`0x`) only the policy key; `feeCosts` → `routeFees` with `included`; `priceImpact` from `fromAmountUSD`/`toAmountUSD` (null when missing); LI.FI no-SOL refusal → 409 `SOL_REQUIRED`; LI.FI price-impact no-route → 503 `ROUTE_UNAVAILABLE` with the exact message; status `substatus` passed through; **rebalance with zero free USDC** (all value in assets, Solana-only sells) plans successfully, buy legs from `estimate` with `minOut` = scaled `toAmountMin`, Solana gas reservation includes the conservative estimate exposure per buy leg; an invest whose plan quote returns LI.FI 1001 retries with `estimate` and plans.
- [ ] **Step 2: Run** `pnpm --filter api exec vitest run test/execution/lifi-hardening.test.ts < /dev/null` → FAIL.
- [ ] **Step 3: Data.** `routePolicyEntries` (`id, kind enum route_tool_kind (bridge|exchange), toolKey text, reason text, createdBy → users, createdAt, removedBy?, removedAt?`; partial unique `(kind, tool_key) where removed_at is null`); `operationLegs.recoveryOf uuid references operation_legs.id unique nullable`, `operationLegs.recoveryToken jsonb<{ chain; address: string | null; decimals; symbol; amount: string }> nullable`; `instrumentDeployments.feeOnTransfer boolean not null default false`. `db:generate --name=lifi_hardening`; grants/RLS like `0013`; regenerate → "No schema changes"; `db:migrate`. Validator: `SOL_REQUIRED` error code (409); leg view + `priceImpact`, `routeFees`, `providerSubstatus`, `recoveryOf`, `recoveryToken`, `feeOnTransfer`; routing schemas (`routePolicyInputSchema { kind, toolKey: string 1–100, reason 1–500 }`).
- [ ] **Step 4: Adapter + routing service.** `lifi.ts`: shared request options builder inline in both methods (no helper unless reused by both — then one local const); `estimate` per the API reference; parse `feeCosts` and USD amounts; error mapping. `routing.ts`: `routeDenyList` reads active policy rows (module-level cache `{ at, rows }` refreshed after 60 s) and, for an EVM `toChain`, `getCode` via the existing viem client for that chain (Redis `code:<chain>:<address>` 1 h) → add Mayan keys from the tools list (`/v1/tools`, Redis `lifi:tools` 1 h).
- [ ] **Step 5: Planners.** `planQuote(i)` calls `quote`; on LI.FI 1001 (insufficient balance) it calls `estimate` and returns an estimate-shaped result with `transaction: null`. `sponsoredCost` for a result without a transaction returns the conservative exposure constant for a Solana source. `createRebalancePlan` estimates buy legs with `estimate` directly. `routeSummary` stores `routeFees`, `priceImpact`. `quoteLeg` passes the deny list (unchanged validation).
- [ ] **Step 6: Run** the new file, then `test/execution/{invest,sell,rebalance,repair,lifi}.test.ts` and `test/fees/plan-fees.test.ts` one at a time → PASS; `pnpm turbo run lint check-types --filter=api --filter=@repo/validator --filter=@repo/db --filter=web` → PASS. **Commit** `feat(api): LI.FI estimates, price impact, route fees and deny lists`.

---

### Task 2: Recovery leg

**Files:** create `apps/api/test/execution/recovery.test.ts`; modify `apps/api/src/services/{positions,operations,gas}.ts`.

**Consumes:** Task 1 (`estimate`, `routeDenyList`, `recoveryOf`, `recoveryToken`, `substatus`).

- [ ] **Step 1: Failing tests** (`recovery.test.ts`): invest cross-chain leg, LI.FI `DONE` + `PARTIAL` with receiving token USDC on Arbitrum, chain evidence 299 USDC → original `FAILED` `DESTINATION_SWAP_FAILED` with `recoveryToken.amount = "299000000"`, a recovery `swap` leg appended (next sequence, `fromChain: arbitrum`, `routeSummary.fromToken` = USDC Arbitrum, `toDeploymentId` = original target, `amountIn` 299000000, `gasPayer: platform_gas_drop`), operation still `IN_PROGRESS`; **provider says 300, evidence 299** → 299; **no evidence** → original `UNKNOWN`, no recovery leg; recovery quoted (gas top-up reserved within caps; cap exhausted → 409 `GAS_BUDGET_EXHAUSTED`), signed and settled → position ledger `invest` with the recovery's received amount, operation `COMPLETED`; **re-run `trackOnce` twice** on the failed original → still one recovery leg and no duplicate ledger/cash rows; rebalance buy recovery → cash debit of the original `amountIn` at failure, ledger `rebalance` credit at recovery settlement; rebalance sell recovery → ledger debit at failure, cash `rebalance_sell` at recovery; repair recovery → D-080 split at settlement; **stop during recovery** → operation `PARTIAL`, recovery leg never sent (status stays `PLANNED`, excluded), unspent gas reservation released as D-072; a recovery leg whose own destination swap fails → `UNKNOWN`, no second recovery; substatus `NOT_PROCESSABLE_REFUND_NEEDED` → leg stays `PENDING_CHAIN` with `providerSubstatus`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Detection and creation** in `trackOnce` (positions.ts), under the operation lock, idempotent on `recovery_of` unique:

```ts
// LI.FI finished the transfer but delivered a different token (destination swap failed).
if (status.state === "UNKNOWN" && status.substatus === "PARTIAL" && leg.kind === "cross_chain" && status.receiving?.token && status.receiving.txHash && !leg.recoveryOf) {
  const evidenced = await receivedOnChain(leg.toChain, addressOn(addresses, leg.toChain), status.receiving.token.address, status.receiving.txHash);
  if (evidenced === null || evidenced <= 0n) { /* keep UNKNOWN as today */ }
  else {
  // Network calls stay outside the DB transaction (existing rule): estimate first, then write under the lock.
  const est = await routeProviderById(leg.provider!)!.estimate({ fromChain: leg.toChain, fromToken: status.receiving.token.address, toChain: targetChain, toToken: targetToken, fromAmount: evidenced, toAddress: addressOn(addresses, targetChain), slippageBps: op.slippageBps });
  await db.transaction(async (tx) => {
    const op = await lockOperation(tx, leg.operationId);
    const [existing] = await tx.select({ id: operationLegs.id }).from(operationLegs).where(eq(operationLegs.recoveryOf, leg.id));
    if (existing) return; // already created by an earlier run
    const recoveryToken = { chain: leg.toChain, address: status.receiving.token.address, decimals: status.receiving.token.decimals, symbol: status.receiving.token.symbol, amount: evidenced.toString() };
    await setLegStatus(tx, null, leg, "FAILED", { failureReason: "DESTINATION_SWAP_FAILED", destinationTx: status.receiving.txHash, recoveryToken });
    await writeSourceSideEffect(tx, op, leg); // sell: ledger debit; rebalance buy: cash debit; invest/repair: nothing — inline in settleLeg's module, shared with settleLeg (2 callers)
    const [{ next }] = await tx.select({ next: sql<number>`max(${operationLegs.sequence}) + 1` }).from(operationLegs).where(eq(operationLegs.operationId, op.id));
    await tx.insert(operationLegs).values({ operationId: op.id, sequence: next, kind: "swap", fromChain: leg.toChain, fromDeploymentId: null, toChain: targetChain, toDeploymentId: leg.toDeploymentId,
      amountIn: evidenced.toString(), minOut: est.minOut.toString(), provider: leg.provider, routeSummary: { fromToken: recoveryToken.address, symbol: recoveryToken.symbol, decimals: recoveryToken.decimals, tool: est.toolSummary, routeFees: est.routeFees, priceImpact: est.priceImpact },
      gasPayer: gasPayerFor(leg.toChain), recoveryOf: leg.id, expectedTx: leg.toChain === "solana" ? null : { gasReserved: false } });
  });
  }
}
```

  Target: the original leg's `toDeploymentId` (chain/address from the deployment) or, for a sell leg (`toDeploymentId` null), USDC on Solana. `LegStatus` `UNKNOWN` for `PARTIAL` must carry `substatus` and `receiving { txHash, token { address, decimals, symbol } }` from the LI.FI status response (extend the zod schema). `receivedOnChain` must accept a non-registry token address (it already takes `token`). If the existing helper names differ, adapt but keep one shared source-side writer used by both `settleLeg` and the failure path.
- [ ] **Step 4: Status, quote, gas and settlement.** `refreshOperationStatus`: a `FAILED` leg with a recovery leg that is not `FAILED`/`UNKNOWN` does not count as failed; completion requires every non-recovered leg and every recovery to be `SETTLED`. `quoteLeg` for a recovery leg: source token from `routeSummary.fromToken` (not a deployment), EVM gas drop with top-up: if the planned drop is not in the reservation (`expectedTx.gasReserved === false`), reserve it now via `services/gas.ts` (same per-chain advisory lock and caps; refusal → 409 `GAS_BUDGET_EXHAUSTED`), then mark `gasReserved: true`. Leg ordering check (`sequence` order) unchanged: the recovery is the last sequence, but a recovery leg may be quoted while later-sequenced legs are settled — allow quoting a recovery leg when every leg except other recoveries is final. `settleLeg` for a recovery: destination-side effect of the **original** leg's operation kind from the recovery's received amount (invest → ledger `invest`; rebalance buy → ledger `rebalance`; repair → `splitRepair`; rebalance sell → cash `rebalance_sell`; sell to USDC/former → nothing). Stop: the existing stop path treats a `PLANNED` recovery like any unsent leg (operation `PARTIAL`), releasing unspent reservation per D-072.
- [ ] **Step 5: Run** `recovery.test.ts`, then `test/execution/{tracking,invest,sell,rebalance,repair,gas}.test.ts` one at a time → PASS; lint + check-types. **Commit** `feat(api): recovery leg after a failed destination swap`.

---

### Task 3: Ops APIs

**Files:** create `apps/api/test/ops/routing.test.ts`; modify `apps/api/src/services/routing.ts`, `apps/api/src/routes/ops.ts`, asset service/routes for the fee-on-transfer edit and verification field, `packages/api-client/src/client.ts`, `apps/api/README.md`.

- [ ] **Step 1: Failing tests:** `GET /v1/ops/routing` (ops roles) → tools from mocked `/v1/tools` with deny state; `POST /v1/ops/routing/deny { kind, toolKey, reason }` (`ops_admin`; reviewer 403; duplicate active → 409 `VALIDATION_FAILED`; unknown tool key → `VALIDATION_FAILED`) audited `route_policy.denied`; `POST /v1/ops/routing/:id/allow` sets `removedAt/removedBy`, audited `route_policy.allowed`; the next quote no longer carries it (after cache expiry — test with cache bypass/time mock); `GET /v1/ops/operations/:id/legs/:legId/lifi-transfers` (`ops_admin` only) calls mocked analytics with the leg's source address and `status=ALL` and filters to ±24 h of `submittedAt`; asset review deployment view has `lifiVerification` from mocked `/v1/tokens` (flagged/verified/unverified/null); `PATCH` fee-on-transfer flag (`ops_admin`, audited) and operation previews show `feeOnTransfer: true` on legs touching that deployment.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per spec §7 with the caches in Global Constraints. **Step 4: Run** the file + `test/assets/*` regressions one at a time → PASS; lint + check-types; README: routing policy, analytics proxy, real-key checks. **Commit** `feat(api): ops routing policy, LI.FI transfer lookup, token verification, fee-on-transfer flag`.

---

### Task 4: Web

**Files:** create `apps/web/app/(ops)/ops/routing/page.tsx`, `apps/web/components/ops/{routing,lifi-transfers}.tsx`; modify `apps/web/components/invest/{leg-progress,fee-lines,invest-wizard}.tsx`, rebalance review, repair panel, exit dialogs, ops leg resolve view, ops asset review/editor, ops navigation, `packages/app-core` error copy (`SOL_REQUIRED`).

- [ ] **Step 1:** Previews: per leg "Route fees (LI.FI, DEX, bridge): $X — included in the estimate" (sum of `routeFees` with `included`), price impact (text; warning style at ≥ 2%), fee-on-transfer note "This token charges a transfer tax; amounts are estimates."
- [ ] **Step 2:** Leg progress: `providerSubstatus === "NOT_PROCESSABLE_REFUND_NEEDED"` → "Refund in progress (the route couldn't complete)"; failed with refunded substatus → "Funds returned to your wallet"; a `FAILED` leg with `recoveryToken` → "Arrived as <amount> <symbol> on <chain>" and its recovery leg as "Complete swap" (signed through the existing signer; EVM gas drop wait as sells); "Stop here" unchanged.
- [ ] **Step 3:** `SOL_REQUIRED` copy in app-core error copy and the wizard.
- [ ] **Step 4:** Ops: `/ops/routing` (bridges and exchanges tables with deny/allow, reason required, `ops_admin` only for actions); LI.FI transfers panel on the leg resolve view; asset review verification badge ("LI.FI: verified/unverified/flagged", flagged in warning style) and fee-on-transfer toggle in the asset editor.
- [ ] **Step 5: Run** `pnpm --filter web lint check-types build` and `pnpm --filter web test < /dev/null` → PASS. **Commit** `feat(web): route fees, price impact, refund and recovery states, ops routing`.

---

### Task 5: Web tests and docs

- [ ] **Step 1: Web tests** (`route-fees`, `recovery`, `ops-routing`): route fees and impact lines, warning at ≥ 2%; refund and returned states; recovery "Complete swap" flow with mocked client; `SOL_REQUIRED` copy; ops deny requires reason, reviewer read-only; verification badge; fee-on-transfer note. Run `pnpm --filter web test < /dev/null` → PASS. Commit `test(web): LI.FI hardening`.
- [ ] **Step 2: Docs (rewrite in place):** new `docs/decisions/ADR-017-LIFI-HARDENING.md` (estimates vs quotes, `SOL_REQUIRED`, Mayan rule, recovery leg and its accounting, refund messaging, price impact, deny list, route fees, ops tools; alternatives: separate recover operation, platform SOL drop, allow list, ops-configurable impact); ADR-014 sections that change (planning, tracking `PARTIAL`, provider options); `DECISION-REGISTER.md` D-075 (PARTIAL now recovered with evidence) and new D-093..; `INVESTMENT-REBALANCING-DRIFT-FIX.md`, `ASSET-REGISTRY.md` (verification badge, fee-on-transfer), `ARCHITECTURE.md`; `FUTURE-PLANS.md` (B1 platform fee via LI.FI integrator `fee`; B4 `order` per route kind; B8 `skipSimulation` / step transactions; separate `recover` operation; ops-configurable price-impact limits; platform SOL drop); `docs/OPEN-ITEMS.md` (real-key checks from spec §14; tick nothing else); `apps/api/README.md`. Commit `docs: spec 10.1 LI.FI hardening`.
- [ ] **Step 3: Full gate** `pnpm turbo run lint check-types test build --continue < /dev/null` (re-run crashed api files alone; known `mobile#check-types`) → report.

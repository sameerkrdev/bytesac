# Spec 10.1 — LI.FI Integration Hardening (Design)

- **Date:** 2026-10-03
- **Status:** Approved in conversation (2026-10-03); written spec pending user review
- **Series:** Spec 10.1 — after Specs 1–10, before Spec 11
- **Builds on:** Spec 5 (registry, asset review), Spec 8 (`RouteProvider`, LI.FI adapter, legs, tracking, gas drops, ops leg resolve), Spec 9 (rebalance/repair planners, buys sized from proceeds), Spec 10 (fees, previews).
- **Sources:** LI.FI FAQ pages (fees & monetization, troubleshooting, integration, slippage & price impact, route availability, token support; read 2026-10-03); ADR-013, ADR-014 (D-067..D-075), ADR-015, ADR-016.

## 1. Intent

Close the risks the LI.FI FAQ revealed in our flow and add safety and transparency controls: plan-time estimates that do not need the user's balance, a clear error when LI.FI refuses Solana wallets without SOL, no Mayan routes to smart-contract destinations, a user-signed recovery when a cross-chain destination swap fails, refund messaging, a price-impact limit, an ops-managed bridge/exchange deny list, disclosed route fees, and ops tools (LI.FI transfer lookup, token verification, fee-on-transfer flag).

**Success criteria**
1. A rebalance can be planned when the buy legs will be funded by sale proceeds the wallet does not hold yet.
2. A destination-swap failure leaves the user one signature away from the intended asset, with amounts from chain evidence only.
3. No route above 5% price impact executes; every preview shows route fees and price impact.
4. Ops can deny a bridge or exchange in minutes, audited, without a deploy.
5. Nothing new moves value without a user signature; recovery gas stays within the per-user caps.

## 2. Decisions (this brainstorm)

| # | Topic | Decision |
|---|---|---|
| A1 | Plan-time estimates | Use LI.FI `POST /v1/advanced/routes` (wallet optional, no balance check) where the wallet does not hold the funds yet (rebalance buys, balance-refused quotes); `/v1/quote` elsewhere and always at execution. |
| A2 | No-SOL refusal | Detect LI.FI's refusal for Solana wallets without SOL and return 409 `SOL_REQUIRED` with guidance; no platform SOL drop. Real-key check before launch. |
| A3 | Contract destinations | `eth_getCode` on the destination EVM address; when it has code, deny Mayan bridges. |
| A4 | Destination swap failed | A recovery leg inside the same operation (user-signed swap from the delivered token to the target asset), ledgered as the original leg; no new network fee. A separate `recover` operation is a future plan. |
| A5 | Refund messaging | Expose LI.FI substatus; "Refund in progress" for `NOT_PROCESSABLE_REFUND_NEEDED`, "Funds returned" for refunded failures. |
| A6 | Route fees | Parse `feeCosts`; show route fees (LI.FI 0.25% service fee, DEX, bridge) per leg and in total, "included in the estimate". |
| B2 | Price impact | Platform constant `MAX_PRICE_IMPACT = 0.05` passed as `maxPriceImpact`; refusal → 503 `ROUTE_UNAVAILABLE`; impact displayed. Ops-configurable limits are a future plan. |
| B3 | Route policy | Ops-managed deny list (bridges, exchanges) from LI.FI `/v1/tools`, empty by default, audited, passed on every estimate and quote. |
| B5 | Transfer lookup | Ops panel using LI.FI `GET /v1/analytics/transfers?wallet=…&status=ALL` (read-only aid; resolve still needs chain evidence). |
| B6 | Token verification | Show LI.FI `/v1/tokens` `verified/unverified/flagged` in ops asset review; warn on flagged. |
| B7 | Fee-on-transfer | Ops flag `feeOnTransfer` on a deployment; preview note; ledger unchanged. |
| Future | B1, B4, B8 | Platform fee via LI.FI integrator `fee`; `order` FASTEST/CHEAPEST per route kind; `skipSimulation` / step-transaction flow. |

## 3. Out of scope (recorded in `docs/domains/FUTURE-PLANS.md`)

B1 (platform fee through LI.FI's integrator `fee` parameter, collected in each leg's `fromToken` to the integrator wallet), B4 (`order` per route kind), B8 (`/advanced/stepTransaction` with `skipSimulation=true`), a separate `recover` operation (own network fee) instead of the in-operation recovery leg, ops-configurable price-impact limits per chain or asset, a platform SOL drop for wallets without SOL.

## 4. Provider adapter (`apps/api/src/providers/routes/`)

- `RouteProvider` gains `estimate(i: EstimateInput): Promise<LegEstimate>` beside `quote`, `connections`, `status`. `EstimateInput` = quote input without the requirement for a funded `fromAddress` (`fromAddress` optional; `toAddress` passed when known). LI.FI implementation: `POST /v1/advanced/routes` with `fromChainId`, `toChainId`, `fromTokenAddress`, `toTokenAddress`, `fromAmount`, `fromAddress?`, `toAddress?`, `options: { slippage, integrator, maxPriceImpact, bridges: { deny }, exchanges: { deny } }`; the first route is used: `toAmount`, `toAmountMin`, gas and fee costs from its steps, tool summary. Parameter names are confirmed from the LI.FI API reference during implementation.
- `quote` (`GET /v1/quote`) additionally passes `maxPriceImpact`, `denyBridges`, `denyExchanges`; existing validation unchanged.
- Both return `priceImpact` (1 − toAmountUSD / fromAmountUSD, `null` when USD values are missing) and `routeFees: { name, amountUsd, included }[]` from `feeCosts` (all steps).
- Errors: LI.FI's no-SOL refusal (code/message pattern confirmed with a real key; until then matched on the documented message) → 409 `SOL_REQUIRED`; a no-route response caused by price impact → 503 `ROUTE_UNAVAILABLE` "Price impact too high for this trade size"; others unchanged.
- `status` returns `substatus` to callers (`providerSubstatus` on the leg).
- Deny lists: active `route_policy_entries` (cached in-process 60 s) plus Mayan keys when the destination is an EVM address with code (`eth_getCode` via the existing viem clients, cached per address 1 h). Mayan tool keys are taken from `/v1/tools` (names starting with `mayan`).

## 5. Planners

Planners keep calling `quote` when the wallet already holds the source funds (invest, repair, sells, rebalance sells): the provider-built Solana transaction is what bounds the platform fee payer's exposure (D-072). Rebalance buy legs (funded by proceeds that arrive later) and any plan quote LI.FI refuses for balance (error 1001) use `estimate` instead, with a conservative Solana sponsor exposure of signature fee + `MAX_PRIORITY_LAMPORTS` + one `TOKEN_ACCOUNT_RENT_LAMPORTS`. Execution (`quoteLeg`) always calls `quote` (unchanged). The plan stores `toAmountMin` as the plan minimum (D-073 price guard unchanged), `routeFees`, `priceImpact` and the tool summary in `routeSummary`.

## 6. Recovery leg (A4)

- Detection in `trackLeg`: LI.FI reports the transfer finished with a different delivered token (`DONE`/`PARTIAL`, or `FAILED` with a receiving transaction and token) on a `cross_chain` leg. The tracker reads chain evidence on the destination chain (Transfer logs / balance change at the destination transaction for the delivered token to the user's address); no evidence → `UNKNOWN` as today.
- With evidence: under the operation lock, the original leg → `FAILED` (`failureReason: "DESTINATION_SWAP_FAILED"`, `recoveryToken: { chain, address, decimals, symbol, amount }`), and a recovery leg is appended (next `sequence`): kind `swap`, `fromChain` = destination chain, from token = delivered token (`fromDeploymentId` null; the token address lives in `routeSummary.fromToken`), `toChain`/`toDeploymentId` = the original leg's target (for a sell: USDC on Solana, `toDeploymentId` null), `amountIn` = evidenced amount, `minOut` = evidenced amount priced into the target with the operation's slippage (from a fresh `estimate`), gas payer by source chain (EVM: `platform_gas_drop`; Solana: `platform_fee_payer`), `recoveryOf` = original leg id.
- Status: `refreshOperationStatus` treats a `FAILED` leg with a non-failed recovery as pending; the operation completes when the recovery settles (and all other legs settled); a failed recovery → the operation rules as today (`PARTIAL`/`FAILED`); one recovery per leg (unique `recovery_of`); a recovery whose own destination swap fails is not recovered again (`UNKNOWN` for ops).
- Settlement: the source funds of the original leg left the wallet, so its **source-side** effect is written when it turns `FAILED` with recovery evidence (a sell: position ledger debit of the sold quantity; a rebalance buy: basket cash debit of its `amountIn`; invest and repair buys spend free USDC, no entry). The **destination-side** effect is written when the recovery leg settles, from the recovery's chain-evidenced received amount: invest → position ledger `invest`; rebalance buy → ledger `rebalance`; repair → D-080 split; rebalance sell → cash `rebalance_sell`; sell to USDC / sell former → nothing (proceeds are wallet USDC). If the user stops, the delivered token stays outside baskets and a rebalance basket may show cash `SHORT` until synced (D-078).
- Gas: the recovery's gas drop uses the operation's remaining reservation; any shortfall is reserved at quote time under the existing per-chain lock and caps, else 409 `GAS_BUDGET_EXHAUSTED`. No new network fee.
- Stop: "Stop here" ends the operation `PARTIAL`; the delivered token stays in the user's wallet outside baskets; the portfolio history shows "Arrived as <amount> <symbol> on <chain>".
- Data: `operation_legs.recovery_of` (uuid FK, unique, nullable), `operation_legs.recovery_token` (jsonb, nullable).

## 7. Route policy, ops tools, token data

- `route_policy_entries`: `id, kind (bridge | exchange), tool_key, reason (1–500), created_by, created_at, removed_by?, removed_at?`; partial unique `(kind, tool_key) where removed_at is null`; audited (`route_policy.denied`, `route_policy.allowed`). API: `GET /v1/ops/routing` (ops roles; tools list from LI.FI `/v1/tools` cached 1 h, each with its deny state), `POST /v1/ops/routing/deny`, `POST /v1/ops/routing/:id/allow` (`ops_admin`).
- `GET /v1/ops/operations/:id/legs/:legId/lifi-transfers` (`ops_admin`): proxies `GET /v1/analytics/transfers?wallet=<leg source address>&status=ALL` limited to ±24 h around the leg's submission; read-only.
- Asset review: deployment view gains `lifiVerification: "verified" | "unverified" | "flagged" | null` from `/v1/tokens` (cached 24 h per chain); flagged shows a warning.
- `instrument_deployments.fee_on_transfer` boolean default false, editable by `ops_admin` in the asset editor (audited); operation previews include `feeOnTransfer: true` per leg when the deployment is flagged.

## 8. Data model (migration `0014_lifi_hardening.sql`)

`operation_legs.recovery_of`, `operation_legs.recovery_token`; `route_policy_entries`; `instrument_deployments.fee_on_transfer`. Grants SELECT/INSERT/UPDATE, RLS as earlier migrations; no DELETE.

## 9. API and errors

New error code `SOL_REQUIRED` (409). Operation and leg views gain `priceImpact`, `routeFees`, `providerSubstatus`, `recoveryOf`, `recoveryToken`, `feeOnTransfer`. New ops endpoints in §7.

## 10. Web (no mobile)

Previews: per-leg route fees ("Route fees (LI.FI, DEX, bridge): $X — included in the estimate"), price impact (warning style ≥ 2%), fee-on-transfer note; leg progress: "Refund in progress", "Funds returned to your wallet", "Arrived as <token> — Complete swap" (signs the recovery leg through the existing signer), "Stop here" stays available; `SOL_REQUIRED` copy with the SOL guidance. Ops: `/ops/routing` (tools with deny/allow, reason required, history), LI.FI transfers panel on the leg resolve view, asset review verification badge and fee-on-transfer toggle.

## 11. Security & safety

Estimates never authorize anything; execution quotes and validation are unchanged. Recovery legs are user-signed, built from chain-evidenced amounts, and ledgered only on settlement from chain evidence (D-075). Recovery gas stays within the per-user and global caps. Deny lists only narrow routes. The analytics proxy is `ops_admin`-only and read-only. Tests mock LI.FI, RPC and wallets; nothing is broadcast.

## 12. Testing

Adapter: estimate via routes without `fromAddress`; `maxPriceImpact` and deny lists passed on estimate and quote; Mayan denied for a contract destination and not for an EOA; `feeCosts` → `routeFees`; `priceImpact`; no-SOL error → `SOL_REQUIRED`; price-impact no-route → `ROUTE_UNAVAILABLE`. Planners: rebalance buys planned with an empty USDC balance. Recovery: `PARTIAL` with evidence → original `FAILED` + recovery leg with evidenced amount; no evidence → `UNKNOWN`; recovery settles → ledger/cash effects per operation kind (invest, rebalance buy, repair split, sell); stop → `PARTIAL`; second-level failure not recovered; gas top-up and cap refusal. Refund substatus surfaced. Ops: routing deny/allow audit and permissions; analytics proxy permission and time window; token verification badge; fee-on-transfer flag. Web: preview fees/impact, recovery and refund states, `SOL_REQUIRED`, ops routing.

## 13. Execution shape

Five tasks: (1) adapter (estimate, impact, fee costs, deny lists, Mayan rule, `SOL_REQUIRED`, substatus) + migration + planners switched to estimates; (2) recovery leg (detection, evidence, executor/status, gas, settlement); (3) ops APIs (routing policy, analytics proxy, token verification, fee-on-transfer); (4) web; (5) web tests and docs (ADR-017 LI.FI hardening, D-093+, FUTURE-PLANS, OPEN-ITEMS, ADR-014 rewritten in place where behavior changes).

## 14. Open items

Real-key checks: `/advanced/routes` without `fromAddress` for Solana sources with `svmSponsor`; LI.FI's no-SOL refusal shape and whether `svmSponsor` avoids it; Mayan tool keys; `analytics/transfers` access for our key; `feeCosts` completeness per tool.

# Investment, Rebalancing, Drift and Fix — Domain Context

Source: `First-Investment,-Rebalancing,-Drift-&-Fix.txt`, `User-Detailed-Features.txt`

## Core responsibility split
- Basket engine: published versions and target allocations.
- Portfolio engine: user portfolios, physical holdings and logical basket allocations.
- Transition planner: deterministic desired-state plan.
- Execution orchestrator: authorization-aware multi-step execution.
- Adapters: chain, venue, bridge and RWA provider operations.
- Indexer/reconciler: observed activity, settlement and actual state.

## First investment
Show the user the investment amount, allocation, assets, fees, routes and relevant eligibility before execution. Check balances, gas, minimums, price freshness, route availability and authorization. A basket may span chains or mix crypto and RWA routes; each leg has its own execution and settlement state. Preserve cash residuals and partial outcomes.

## Rebalance
A manager publishes a reviewed basket version and a reason/change summary. The user is notified and chooses whether to apply or skip. The user's operation is separately planned from current reconciled holdings. Multiple changed assets can be netted where safe. Include fees, tolerances, dust, minimums, liquidity and pending operations.

## Skip and catch-up
A skip is a recorded user choice, not automatically a customization. Multiple skipped versions and later manual trades must be handled by a transition from the verified current state to the user's explicitly selected target version.

## Drift and external activity
Drift can result from price movement, external trades/transfers, skipped updates, failed execution or asynchronous settlement. Reconcile first. Distinguish physical wallet balances from logical basket allocations and unassigned assets.

For shared physical assets, a shortage can affect multiple baskets. Create one coordinated discrepancy and prevent duplicate repair orders. Never infer which basket a manual sale was intended to reduce.

## Fix is not one universal action
Distinguish:
- Reconciliation: establish supported actual state.
- Repair/restore: address a discrepancy with explicit authorization.
- Rebalance: move toward a selected basket version.
- Customization: accept an explicit deviation.

A fix may restore quantity, restore value/weights, accept/reallocate the change, or retain a custom allocation, depending on approved product policy. Recompute using current valuation rather than blindly buying the old quantity.

## Operations and state
An investment/rebalance is an operation that can contain multiple steps and transactions. Track operation, step, provider request and blockchain transaction separately. Support pending, partial, failed, unknown and reconciliation states. Do not report success until verified settlement/reconciliation criteria are met.

Before execution:
1. Reconcile positions.
2. Confirm target version and user intent.
3. Re-evaluate eligibility and routes.
4. Recompute if relevant inputs changed.
5. Reserve or serialize shared assets.
6. Execute idempotently with per-step state.
7. Reconcile final state.

## Custody, authority and attribution (decided, ADR-013)
- Self-custody: assets stay in the user's own Solana wallet, linked EVM addresses and linked Bitcoin address; the platform holds no keys or funds. Investments are funded with USDC on Solana; constituents may sit on any supported chain, including native BTC ("ETFs" means tokenized funds/equities).
- Every operation (`invest`, `rebalance`, `fix`, `sell_to_usdc`, `sell_former_assets`) is a plan of legs with 60 s quotes, on-chain minimum output and user slippage (default 1%, max 3%); the user signs every leg on its source chain; EVM approvals are exact-amount. No delegation.
- Leg states `PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`; operations can be `PARTIAL`; unknown outcomes are reconciled, never blindly retried.
- Shortfalls are allocated pro-rata across baskets holding the deployment (`SHORT`); the user chooses Fix or Accept. Surplus is outside baskets and never touched.
- Leave basket keeps assets (no transaction) and a former-basket record; Sell to USDC sells all or part of a basket; Sell former basket assets sells `min(recorded, on-chain)`.

## Implemented first investment and exit (Spec 8, ADR-014)
- **Invest:** the user enters a USDC amount (minimum and increment of the published version; the network fee is taken from it) and slippage (default 1%, max 3%). The server plans legs: a user-signed `network_fee` transfer first, then one `swap` or `cross_chain` leg per constituent, routed by LI.FI to the user's own addresses. The preview shows each leg's estimated and minimum output, the network fee and "No platform or manager fees are charged yet".
- **Signing:** strictly one leg at a time; fresh 60 s quote per leg; Solana legs are co-signed by the platform fee payer only if the signed message is byte-identical (`TX_MISMATCH` otherwise); EVM sells wait for a confirmed platform gas drop and use exact-amount approvals; Bitcoin legs are signed PSBTs checked against the quoted outputs (`PSBT_MISMATCH`). An expired quote needs a new quote and signature.
- **Tracking:** each leg is tracked to `SETTLED`, `FAILED` or `UNKNOWN` (re-checked hourly for 7 days); a settled invest leg adds the amount actually received to the position ledger. `PARTIAL` (some asset legs settled, then a failure or "Stop here") and `FAILED` are terminal; continuing needs a new plan. Nothing is retried.
- **Portfolio:** positions with value, actual against target weights, `SHORT` and outside-baskets notices (display only), open operations that can be continued, history with explorer links, former positions.
- **Exit:** Leave basket (no transaction, ledger kept), Sell to USDC (percentage; quantity `min(ledger x percent, wallet balance)`; network fee paid from the proceeds as the last leg), Sell former assets. No manager approval is needed, and exits work even when the basket or its routes were retired.
- Not built (Spec 9 and later): rebalance, skip and catch-up, drift, Fix and `SHORT` repair, subscriptions and fees, RWAs.

## Open decisions
Fee collection legs for platform and manager fees, fix policy details, rebalance thresholds, price hierarchy and RWA settlement behavior.

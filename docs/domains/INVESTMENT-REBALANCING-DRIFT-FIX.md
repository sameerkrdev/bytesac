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
- Self-custody: assets stay in the user's own Solana wallet and linked EVM addresses; the platform holds no keys or funds. Investments are funded with USDC on Solana; constituents may sit on any supported chain (native BTC excluded in release 1; "ETFs" means tokenized funds/equities).
- Every operation (`invest`, `rebalance`, `fix`, `sell_to_usdc`, `sell_former_assets`) is a plan of legs with 60 s quotes, on-chain minimum output and user slippage (default 1%, max 3%); the user signs every leg on its source chain; EVM approvals are exact-amount. No delegation.
- Leg states `PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`; operations can be `PARTIAL`; unknown outcomes are reconciled, never blindly retried.
- Shortfalls are allocated pro-rata across baskets holding the deployment (`SHORT`); the user chooses Fix or Accept. Surplus is outside baskets and never touched.
- Leave basket keeps assets (no transaction) and a former-basket record; Sell to USDC sells all or part of a basket; Sell former basket assets sells `min(recorded, on-chain)`.

## Open decisions
Route aggregator and gas top-up, fee collection legs, fix policy details, rebalance thresholds, price hierarchy and RWA settlement behavior.

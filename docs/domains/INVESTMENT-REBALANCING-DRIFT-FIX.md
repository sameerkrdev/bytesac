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
- Shortfalls are allocated pro-rata by default across baskets holding the deployment (`SHORT`), block rebalancing until resolved, and the user resolves them with Buy back or Sync (user-editable split, D-023). Surplus is outside baskets and never touched.
- Leave basket keeps assets (no transaction) and a former-basket record; Sell to USDC sells all or part of a basket; Sell former basket assets sells `min(recorded, on-chain)`.

## Implemented first investment and exit (Spec 8, ADR-014)
- **Invest:** the user enters a USDC amount (minimum and increment of the published version; the network fee is taken from it) and slippage (default 1%, max 3%). The server plans legs: a user-signed `network_fee` transfer first, then one `swap` or `cross_chain` leg per constituent, routed by LI.FI to the user's own addresses. The preview shows each leg's estimated and minimum output, the network fee and "No platform or manager fees are charged yet".
- **Signing:** strictly one leg at a time; fresh 60 s quote per leg; Solana legs are co-signed by the platform fee payer only if the signed message is byte-identical (`TX_MISMATCH` otherwise); EVM sells wait for a confirmed platform gas drop and use exact-amount approvals; Bitcoin legs are signed PSBTs checked against the quoted outputs (`PSBT_MISMATCH`). An expired quote needs a new quote and signature.
- **Tracking:** each leg is tracked to `SETTLED`, `FAILED` or `UNKNOWN` (re-checked hourly for 7 days); a settled invest leg adds the amount actually received to the position ledger. `PARTIAL` (some asset legs settled, then a failure or "Stop here") and `FAILED` are terminal; continuing needs a new plan. Nothing is retried.
- **Portfolio:** positions with value, actual against target weights, `SHORT` and outside-baskets notices (display only), open operations that can be continued, history with explorer links, former positions.
- **Exit:** Leave basket (no transaction, ledger kept), Sell to USDC (percentage; quantity `min(ledger x percent, wallet balance)`; network fee paid from the proceeds as the last leg), Sell former assets. No manager approval is needed, and exits work even when the basket or its routes were retired.
- Not built (later specs): subscriptions and fees, RWAs.

## Implemented rebalance, skip, drift, repair and notifications (Spec 9, ADR-015)
- **Apply or skip:** when a basket publishes a newer version a holder with an open position sees "New version available" and **Review update**: the manager's rationale, the diff, current against target weights, and a plan. **Create plan** plans from current reconciled holdings (allocated quantities, fresh prices, basket cash) to the latest version; skipped versions are never replayed. **Skip this version** records the choice and changes nothing in the wallet; Review update stays available. The applied version changes only when the operation completes. If nothing needs trading the answer is "Already aligned with this version" and the version is recorded without a transaction.
- **Routing and sizing (D-076):** sells go to USDC on Solana, then buys run from USDC on Solana, sized from what the sells actually delivered (a scale fixed once at the first buy's quote, the last buy takes the rounding remainder, minimums scale with it). Buys never spend free USDC outside basket cash. The plan preview shows sells, the network fee and where it is paid from ("paid from your free USDC" or "paid from this basket's sale proceeds"), buys with estimated and minimum output, "Buy amounts are resized to what your sales actually return" and "No platform or manager fees are charged yet"; then the same one-leg-at-a-time signer as invest. A plan selling an EVM or Bitcoin asset without the fee in USDC on Solana is refused (`INSUFFICIENT_BALANCE`).
- **Thresholds (D-077):** a trade is skipped under 50 bps of weight or 5 USDC of value unless the version sets `minTradeBps` (10 to 1000) or `minTradeUsdc` (1 to 100) in the wizard's rebalance step (shown on the public and ops views); a removed asset is sold in full.
- **Basket cash (D-078):** unspent proceeds are tracked per position, spent before free USDC, reconciled against the wallet and shown as a "Cash (USDC)" holding row.
- **Drift and keep custom (D-081):** every reconciliation (nightly and on portfolio read) computes weights with fresh prices; a weight at least the version's drift threshold (default 500 bps) from target makes the position "Drifted" with **Rebalance to target** (to the applied version, while it is still current) and **Keep custom**; **Revert custom** returns to the target. A custom allocation stays quiet until a weight moves a threshold away from the snapshot.
- **Repair (D-080):** a shortfall shows "Needs repair" and blocks rebalancing for the affected baskets. `/portfolio/repair/<asset>` lists the baskets with recorded, allocated and short amounts and offers **Buy back** (one plan for the whole asset: cost preview, then signing; not offered for cash) or **Sync** (no transaction; each basket's share is prefilled pro-rata, must add up exactly, and a changed shortfall refreshes the figures with "Your holdings changed — review the new figures").
- **States (D-081):** version, backing, allocation and execution are separate; the headline is execution pending, repair required, execution incomplete (Continue: a new plan to the same target), rebalance available, drifted, customized or aligned. A newer publish cancels untouched `PLANNED` rebalances.
- **Notifications (D-083):** inbox (`/notifications`, header bell with the unread count, mark read), email and browser push (profile toggle; Firebase Cloud Messaging) for new versions, drift, shortfalls, incomplete plans and basket pause, resume, retirement and lead changes, gated by the existing preferences, deduplicated, and never claiming a trade happened.
- **Managers (D-084):** an adoption table per published version (open positions, applied, skipped, not responded, in progress; counts of 1 to 4 read "<5").
- Not built: direct sell-to-buy pairing, one combined repair plan for several short assets, Alchemy webhooks for instant detection, mobile push and mobile rebalance screens (`FUTURE-PLANS.md`).

## Open decisions
Fee collection legs for platform and manager fees, price hierarchy and RWA settlement behavior. Notification copy and threshold tuning after real use.

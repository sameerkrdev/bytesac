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
- Self-custody: assets stay in the user's own Solana wallet, the address linked for each EVM chain and the linked Bitcoin address; the platform holds no keys or funds. Investments are funded with USDC on Solana; constituents may sit on any supported chain, including native BTC ("ETFs" means tokenized funds/equities).
- Every operation (`invest`, `rebalance`, `fix`, `sell_to_usdc`, `sell_former_assets`) is a plan of legs with 60 s quotes, on-chain minimum output and user slippage (default 1%, max 3%); the user signs every leg on its source chain; EVM approvals are exact-amount. No delegation.
- Leg states `PLANNED → SUBMITTED → PENDING_CHAIN → SETTLED | FAILED | UNKNOWN`; operations can be `PARTIAL`; unknown outcomes are reconciled, never blindly retried.
- Shortfalls are allocated pro-rata by default across baskets holding the deployment (`SHORT`), block rebalancing until resolved, and the user resolves them with Buy back or Sync (user-editable split, D-023). Surplus is outside baskets and never touched.
- Leave basket keeps assets (no transaction) and a former-basket record; Sell to USDC sells all or part of a basket; Sell former basket assets sells `min(recorded, on-chain)`.

## first investment and exit (ADR-014)
- **Invest:** the user enters a USDC amount (minimum and increment of the published version; every fee is taken from it) and slippage (default 1%, max 3%). The server plans legs: a user-signed fee transfer first (the `network_fee` leg, carrying every fee, see below), then one `swap` or `cross_chain` leg per constituent, routed by LI.FI to the user's own address on each leg's destination chain. The preview shows each leg's estimated and minimum output and every fee.
- **Signing:** strictly one leg at a time; fresh 60 s quote per leg; Solana legs are co-signed by the platform fee payer only if the signed message is byte-identical (`TX_MISMATCH` otherwise) and the fee payer is used only for fees and ATA `CreateIdempotent` rent; a LI.FI tool whose transaction fails that check is skipped for this quote and the next route is taken (`ROUTE_UNAVAILABLE` if none is sponsorable); EVM sells wait for a confirmed platform gas drop and use exact-amount approvals; Bitcoin legs are signed PSBTs checked against the quoted outputs (`PSBT_MISMATCH`). An expired quote needs a new quote and signature.
- **Tracking:** each leg is tracked to `SETTLED`, `FAILED` or `UNKNOWN` (re-checked hourly for 7 days); a settled invest leg adds the amount actually received to the position ledger. `PARTIAL` (some asset legs settled, then a failure or "Stop here") and `FAILED` are terminal; continuing needs a new plan. Nothing is retried.
- **Portfolio:** positions with value, actual against target weights, `SHORT` and outside-baskets notices (display only), open operations that can be continued, history with explorer links, former positions.
- **Exit:** Leave basket (no transaction, ledger kept), Close position for a position worth under $1 (confirm: "Remaining tokens stay in your wallet outside this basket."; same effect as Leave, refused at $1 or more), automatic close when a sale leaves every holding and the basket cash at 0 (D-110), Sell to USDC (percentage; quantity `min(ledger x percent, wallet balance)`; network fee paid from the proceeds as the last leg), Sell former assets. No manager approval is needed, and exits work even when the basket or its routes were retired.
- **Per-chain addresses (D-120):** every leg uses the address linked for its own chain (`addressOn`), so delivery, EVM gas drops, sells, rebalances, recovery and reconciliation read that chain's address. A plan for a chain with no linked address is refused with `CHAIN_NOT_LINKED` (409), and investability lists the missing chains. A position on one chain never spans two addresses: moving a chain to another wallet is allowed only when it is empty (USER-AUTHENTICATION). Plan creation locks the wallet row, so a plan cannot start while a move runs.
- **Wallet chain coverage (D-119):** each linked address stores the chains its wallet approved at the last sign-in or Add chain account (`wallet_addresses.signable_chains`, client-reported, null = unknown). Checked per chain address, every plan review lists the plan's chains the wallet cannot sign: an investment proceeds after an explicit "I understand" (the assets arrive at the same address; selling them later needs a wallet that signs there), while sells, rebalances and repairs say which wallet those steps need. Unknown lists never warn.
- **Fees (ADR-016, D-085 to D-092):** the `network_fee` leg is the combined fee leg: one server-built Solana transaction (ComputeBudget matching live LI.FI quotes, then one USDC transfer per charged fee: network to the gas treasury, then the manager fee to the organization's verified payout wallet, then the platform fee to the revenue treasury), its amount the total of all fees. Entry fee base: the amount entered; rebalance fee only when applying a newer version (base: planned traded value); platform fee per operation type (`invest`, `rebalance_apply`, `rebalance_drift`, `repair`, `sell_to_usdc`, `sell_former`) from the default schedule with organization and basket overrides (a repair uses only the default). Terms are fixed when the plan is created; a fee below 0.01 USDC is waived, as is a manager fee without a verified payout wallet; fees are not refunded when the operation does not complete. Placement uses the total (D-079, D-071); `operation.fees[]` lists them while `networkFeeUsdc` stays the network row only. The network fee includes the token-account rent of each charged recipient.
- **LI.FI hardening (ADR-017, D-093 to D-099):** rebalance buys are planned from balance-free estimates (minimum from the route's `toAmountMin`), so a rebalance plans with all value in assets; a Solana wallet without SOL gets "SOL needed" (`SOL_REQUIRED`); every leg preview shows route fees ("included in the estimate"), price impact (the server's own fee-excluded check, warning from 2%; refused above 5% on trades of $10 or more) and a transfer-tax note for flagged tokens. When a cross-chain destination swap fails and a different token arrives, the leg shows "Arrived as <amount> <token> on <chain>" and the same operation offers **Complete swap** (a user-signed leg sized from the chain, no new network fee); **Stop here** leaves the token in the wallet and the operation `PARTIAL`; an unsent recovery older than 7 days is stopped automatically and the user is told. A gas top-up is never reserved for a closed operation. Refunds show "Refund in progress" and "Funds returned to your wallet".

## rebalance, skip, drift, repair and notifications (ADR-015)
- **Apply or skip:** when a basket publishes a newer version a holder with an open position sees "New version available" and **Review update**: the manager's rationale, the diff, current against target weights, and a plan. **Create plan** plans from current reconciled holdings (allocated quantities, fresh prices, basket cash) to the latest version; skipped versions are never replayed. **Skip this version** records the choice and changes nothing in the wallet; Review update stays available. The applied version changes only when the operation completes. If nothing needs trading the answer is "Already aligned with this version" and the version is recorded without a transaction.
- **Routing and sizing (D-076):** sells go to USDC on Solana, then buys run from USDC on Solana, sized from what the sells actually delivered (a scale fixed once at the first buy's quote, the last buy takes the rounding remainder, minimums scale with it). Buys never spend free USDC outside basket cash. The plan preview shows sells, the fees and where they are paid from ("paid from your free USDC" or "paid from this basket's sale proceeds"), buys with estimated and minimum output and "Buy amounts are resized to what your sales actually return"; then the same one-leg-at-a-time signer as invest. A plan selling an EVM or Bitcoin asset without the fee in USDC on Solana is refused (`INSUFFICIENT_BALANCE`).
- **Thresholds (D-077):** a trade is skipped under 50 bps of weight or 5 USDC of value unless the version sets `minTradeBps` (10 to 1000) or `minTradeUsdc` (1 to 100) in the wizard's rebalance step (shown on the public and ops views); a removed asset is sold in full.
- **Held assets that stop being investable (D-111):** a rebalance or drift fix keeps the target for a held non-investable asset at the held deployment and is refused (`NOT_INVESTABLE`) only if it would buy it or cannot sell a held asset for lack of a quotable route; ops get an alert listing the affected baskets. The portfolio shows basket names, not slugs.
- **Basket cash (D-078):** unspent proceeds are tracked per position, spent before free USDC, reconciled against the wallet and shown as a "Cash (USDC)" holding row. Selling to USDC releases its share when the first sell leg settles.
- **Drift and keep custom (D-081):** every reconciliation (nightly and on portfolio read) computes weights with fresh prices; a weight at least the version's drift threshold (default 500 bps) from target makes the position "Drifted" with **Rebalance to target** (to the applied version, while it is still current) and **Keep custom**; **Revert custom** returns to the target. A custom allocation stays quiet until a weight moves a threshold away from the snapshot.
- **Repair (D-080):** a shortfall shows "Needs repair" and blocks rebalancing for the affected baskets. `/portfolio/repair/<asset>` lists the baskets with recorded, allocated and short amounts and offers **Buy back** (one plan for the whole asset: cost preview, then signing; not offered for cash) or **Sync** (no transaction; each basket's share is prefilled pro-rata, must add up exactly, and a changed shortfall refreshes the figures with "Your holdings changed — review the new figures"). While a transaction involving the asset is still pending, it is not reconciled and Buy back and Sync wait for it.
- **States (D-081):** version, backing, allocation and execution are separate; the headline is execution pending, repair required, execution incomplete (Continue: a new plan to the same target), rebalance available, drifted, customized or aligned. A newer publish cancels untouched `PLANNED` rebalances that target an older version. A failed or partial rebalance or repair sends a "plan incomplete" notice.
- **Notifications (D-083):** inbox (`/notifications`, header bell with the unread count, mark read), email and browser push (profile toggle; Firebase Cloud Messaging) for new versions, drift, shortfalls, incomplete plans and basket pause, resume, retirement and lead changes, gated by the existing preferences, deduplicated, and never claiming a trade happened.
- **Managers (D-084):** an adoption table per published version (open positions, applied, skipped, not responded, in progress; counts of 1 to 4 read "<5").
- Not built (`FUTURE-PLANS.md`): subscriptions, management-fee collection, direct sell-to-buy pairing, one combined repair plan for several short assets, Alchemy webhooks for instant detection, mobile push and mobile investment screens.

## RWAs and eligibility (ADR-018)
- **What is offered:** permissionless tokenized RWAs (`TOKENIZED_*`) bought and sold through LI.FI exactly like crypto, with the same estimates, quotes, slippage, fees and user-signed legs. Issuer subscription, redemption and asynchronous settlement are not offered.
- **Investability (D-069, D-104, D-105):** an RWA constituent needs a deployment that is not `permissioned`, a route with method `swap` or `secondary_market` whose provider is enabled, and an `ACTIVE` CoinMarketCap market price (NAV is display only); otherwise the basket is not investable (`RWA_PERMISSIONED`, `RWA_ROUTE_UNSUPPORTED`, `RWA_PRICE_REQUIRED`). Per signed-in user, each RWA is evaluated for `acquire`; anything but `ALLOWED` is `NOT_ELIGIBLE_ASSET` (or `DECLARATION_REQUIRED` without a current declaration).
- **Enforcement (D-103):** invest, rebalance (apply and drift fix) and repair buy-back are refused with the reason when an RWA is not `ALLOWED` (409 `NOT_ELIGIBLE` or `DECLARATION_REQUIRED`; Skip, Keep custom, Leave and Sync stay available). A rebalance is refused only when a buy leg would acquire an RWA that is not `ALLOWED`, or a sell leg sells an RWA the user may not sell (each RWA sell leg is evaluated with `sell` at plan time and stored); an RWA that is only held does not refuse it. Every RWA leg is checked again when its quote is requested (earlier settled legs stand), including a recovery leg to an RWA.
- **Exits:** Sell to USDC and Sell former assets evaluate `sell` per RWA; `RESTRICTED`, `KYC_REQUIRED` and `REVIEW_REQUIRED` assets, and RWAs with no current declaration, are left out and returned in `excluded[]` with a notice, and the rest sells; if nothing is left the sale is 409 `NOT_ELIGIBLE` (`DECLARATION_REQUIRED` when a declaration is what is missing). A repeated idempotent request rebuilds `excluded[]` from the stored sell decisions (an exclusion for a missing declaration has none). Nothing is sold without the user, and a restricted asset stays in their wallet.
- **Audit:** `eligibility_decisions` (append-only) records each RWA leg's outcome, rule ids, declaration and IP country at plan time and at every quote; sell exclusions are stored with no leg. Refused plans store none.
- **Not built (`FUTURE-PLANS.md`):** rebalancing without the blocked asset, NAV and LI.FI price fallbacks, permissioned tokens, issuer routes, a KYC vendor.

## Open decisions
Price hierarchy for non-RWA fallbacks, notification copy and threshold tuning after real use (`docs/OPEN-ITEMS.md`).

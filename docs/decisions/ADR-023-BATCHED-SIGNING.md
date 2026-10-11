# ADR-023: Batched signing groups and user-paid Solana gas

- **Status:** APPROVED; P1 IMPLEMENTED (first investment on Solana, website)
- **Date:** 2026-10-11
- **Owners:** Product owner (user), engineering
- **Related:** D-067, D-068, D-072, D-073, D-090, D-094, D-123 to D-126; ADR-014, ADR-015, ADR-016, ADR-017; `docs/superpowers/specs/2026-10-11-batched-signing-direct-routes-design.md` (B-01 to B-23); `docs/superpowers/plans/2026-10-11-spec22-p1-first-investment.md`

## Context
ADR-014 made the user sign one leg at a time and made the platform pay Solana gas as co-signing fee payer. A 12-asset basket meant 13 wallet popups, each with a fresh 60 s quote. The platform fee payer needed funding, per-user and global caps, reservations and a sponsorability retry loop, and wallets that rewrite a transaction (Phantom priority-fee padding, a replaced fee payer) kept failing with `TX_MISMATCH`. A failed leg ended the operation `PARTIAL` or `FAILED` and the user had to start over.

## Decision
P1 covers the first investment on the website. Sells, repairs and rebalances keep the per-leg flow (P2, P3).

- **Signing groups (B-01).** The legs of one operation that share a source chain are signed in groups: quoted together and approved in one wallet interaction. A group is formed at request time from the first `PLANNED` Solana legs in sequence order (`operation_groups`, one open group per operation and chain).
- **Solana sign-only batch (B-02).** The wallet signs the whole chunk with `signAllTransactions`. The server verifies every transaction (message identical to the quote or differing only in ComputeBudget, the user as fee payer, a valid ed25519 signature) before it claims any, claims them all in one transaction (claim before send, D-071), sends the fee transfer with preflight and waits for `confirmed`, then sends the asset legs in order and stops at the first definitive refusal. A refused fee releases every claim (503 `ROUTE_UNAVAILABLE`). The send loop runs in the request, never in a job (D-018).
- **Chunk size (B-17).** `K_SIGN_ALL = 12` and `K_SIGN_AND_SEND = 12` in `@repo/validator`; a group holds at most K transactions (K − 1 asset legs plus the fee when a fee is charged). Tuned from the P0 wallet lab and production telemetry (OPEN-ITEMS).
- **`sendBy` and the blockhash gate.** `sendBy = quotedAt + 40 s` (`GROUP_SEND_WINDOW_MS`). A submit after `sendBy` is 409 `GROUP_EXPIRED` with nothing claimed, and the fee wait is capped at `min(30 s, sendBy − now)`. Each asset leg is gated by its real blockhash: it is sent only if `isBlockhashValid(recentBlockhash, "confirmed")` holds and the block height is at most `quoteBlockHeight + 150 − 20`. The first leg that fails, and every later one, is released unsent with `lastError: "QUOTE_STALE"`. The block height is read before the quotes, so a quote's blockhash is never older than `quoteBlockHeight`.
- **The user pays Solana gas in SOL (B-03, B-23).** Every Solana-source leg is `gasPayer: "user_solana"`, on the group and the per-leg endpoints (mobile too). LI.FI quotes carry no `svmSponsor` and the user is the fee payer. The user also pays the rent of token accounts the transaction creates. The SOL requirement is `Σ (5 000 × signatures + priority fee) + rent + native SOL sold + SOL_BUFFER_LAMPORTS (1 000 000)`; a shortfall is 409 `SOL_REQUIRED` with `details { lamportsRequired, lamportsHeld }`, checked at plan time and again at group quote. There is no SOL top-up (D-094). A plan with nothing charged has no fee leg.
- **No LI.FI integrator fee (B-05).** The fee stays our own server-built transfer (D-089), so a LI.FI transaction is never edited.
- **Fee per group (B-06).** Each asset leg gets a fee share per kind at plan time (`floor(total × legBase / Σ legBase)`, remainder to the largest base). A group's fee transfer charges the uncovered shares of its own legs, in the order network, manager, platform; a kind summing to 0 is left out. The plan's fee leg is reused by the first group (its amount changes only while `PLANNED` and unclaimed); a later group adds a fee leg only while shares remain uncovered. A group never sent is never charged; a fee that was sent is not refunded.
- **`operation_fee_charges`.** A charge is written per settled fee leg and per kind (from `routeSummary.feeCharges`), with the block time. `operation_legs.fee_covered_by` names the fee leg that charged a leg's share. Earnings, revenue and reconciliation read charges; existing `operation_fees` rows were backfilled into charges. A fee leg that never settles writes nothing.
- **Failures stay open (B-08, B-09).** A grouped invest with a failed or unsent leg stays `IN_PROGRESS` with `needsAction`. The user can Continue (new quotes for the remaining legs, balances rechecked, old bytes never reused), Raise slippage (up to 3%), Skip an asset, Invest what's available (remaining amounts and uncovered shares scaled by available ÷ needed) or Stop (`PARTIAL` if an asset leg settled, else `FAILED`). Continue is refused while a leg is in flight and never resends an unknown one. The 5-minute sweep stops an invest after 24 h without progress (`INVEST_AUTO_STOP_HOURS`; rebalance and sell will use 7 days when they get groups), audit `operation.auto_stopped`, notice `execution_incomplete`. Skipping every remaining leg also ends it.
- **Website only (B-21).** The website uses the group endpoints (`POST /v1/operations/:id/groups`, `.../groups/:groupId/submit`, `POST /v1/operations/:id/continue`; Stop is the existing cancel). Mobile keeps the per-leg endpoints; its Solana legs become user-paid in P1. The device check of mobile invest with user-paid SOL is in OPEN-ITEMS.

### Rulings made while building P1
- **Needs-action only for grouped operations.** An operation without a group keeps today's terminal rules (`PARTIAL` or `FAILED` on a failed leg), so mobile behaves as before. Cost if wrong: mobile users see `PARTIAL` after a failure, as today.
- **Per-leg exclusivity.** An operation that has any `operation_groups` row refuses per-leg quote and submit (409 `INVALID_TRANSITION`, "Continue this investment on the website."), and a group request is refused if any leg left `PLANNED` through the per-leg path.
- **Groups are invest-only in P1.** Fee shares exist only on invest legs and a sell puts its fee last. Sell, repair and rebalance keep the per-leg flow; the website shows them the Stop/Continue banner when another operation needs action.
- **The plan's fee leg is reused by the first group**, so a plan with a fee never leaves a second fee leg behind; charges are written per fee leg, with the old rows backfilled.
- **The tier.** The website always sends `tier: "sign_all"` on plan and group requests and downgrades to `single` for the session when the wallet answers "not supported"; a cancelled popup never downgrades. When a plan request has no tier the API assumes `single` (mobile's estimate), not `sign_all`. The tier only chooses the response shape and the approvals estimate; security never depends on it.
- **Group quotes count against the quote rate limit.** A group request consumes one point per transaction (`K_SIGN_ALL`) of the 60 per minute quote limiter.
- **Spec 11 still applies.** The RWA re-evaluation runs for every leg of a group at quote time.
- **D-073 stays waived for the pilot.** The fresh quote is accepted and the stored floor lowered; when a fresh minimum is below the plan's, the website holds the wallet behind an explicit "Accept new prices" tap.
- **Legacy legs.** Legs planned before this release keep `platform_fee_payer` (`svmSponsor`, co-sign, reservations) until P4.

## Alternatives considered
- Keep per-leg signing and only pay the gas differently: still one popup per leg.
- Sign-and-send (the wallet broadcasts, B-07): fewer wallets support it and the server loses control of order and the blockhash gate; built only if P0 finds a target wallet that needs it.
- One merged transaction for the fee plus swaps: LI.FI does not return a merged multi-swap, and size, compute and account limits would force a custom builder (FUTURE-PLANS).
- A platform SOL top-up instead of user-paid gas: platform float, caps and an abuse surface for no gain (D-094 stays).

## Consequences
### Positive
- A 12-asset investment is one wallet approval with the fee in the same popup, about one approval per 11 assets.
- The platform no longer funds, caps or reserves Solana gas, and the wallet-rewrite `TX_MISMATCH` problem for the fee payer is gone.
- A failure leaves a usable investment with a clear next step instead of a dead `PARTIAL`.

### Negative / trade-offs
- The user needs SOL (about 0.004 SOL for a typical basket plus a 0.001 SOL buffer) and gets `SOL_REQUIRED` without it.
- Fees are charged per batch, so a user who stops after a sent fee has paid part of the fees (D-090; legal review OPEN).
- An operation needing action blocks new plans for up to 24 h (one open operation per user); the website shows a Stop banner on every entry point.
- A blockhash lives about 60 s: a large chunk with a slow wallet can expire (`GROUP_EXPIRED`, one more popup).

### Security, financial and operational impact
- The server verifies every transaction before claiming any; a signed set that differs from the quoted set, includes a foreign leg or changes the fee payer or any non-ComputeBudget instruction is refused whole (409 `TX_MISMATCH`) with nothing sent.
- Claim before send; two concurrent submits of the same group send once; an unknown send outcome becomes `SUBMITTED` and is tracked, never resent.
- The USDC balance is rechecked at group quote; a short wallet is refused (`INSUFFICIENT_BALANCE` with `usdcRequiredMicro`) or caught at preflight, which releases every claim. A later chunk checks the finalized balance, which may still include USDC that an earlier chunk's buys have not spent yet.
- Telemetry: the website sends the wallet name and tier with the group request; the server logs `group.quoted { walletName, chain, tier, legs, approvals }` and never an address.

## Migration / rollout
Migration `0025_signing_groups.sql`: `operation_groups`, `operation_fee_charges` (backfilled from `operation_fees`), new leg and operation columns, and `gas_payer` gains `user_solana`. The runtime role gets SELECT, INSERT and UPDATE only. New Solana legs are `user_solana` from deploy; plans created before it keep the co-sign path until P4 retires `svmSponsor`, `sponsorExposure`, `SOLANA_FEE_PAYER_SECRET` and the Solana caps.

## Validation
API integration tests with mocked chain and LI.FI (groups, Continue, auto-stop, user-paid gas, fee charges), validator tests for `feeShares` and `approvalsEstimate`, app-core tests for the group signer, web tests for the review, prices strip, needs action and banner. Mobile Solana signing with user-paid SOL is not device-tested yet.

## Open questions
- Tune `K` and `sendBy` from the P0 wallet lab and the `group.quoted`, `group.expired` and `QUOTE_STALE` telemetry.
- Re-enable the D-073 price guard before public launch.
- Legal review of per-group charging against "charged up front, not refunded".
- P2 and P3 (sells, repairs and rebalances on groups; EVM `wallet_sendCalls`; the direct-route planner; continuation operations) and P4 (retire the fee payer).

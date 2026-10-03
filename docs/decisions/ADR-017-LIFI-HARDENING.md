# ADR-017: LI.FI Integration Hardening — Estimates, Recovery Leg, Price Impact, Deny List and Route Fees

- **Status:** APPROVED (design approved in conversation 2026-10-03; implemented in Spec 10.1)
- **Date:** 2026-10-03
- **Owners:** Product + platform engineering
- **Related:** D-013, D-067, D-068, D-071, D-072, D-073, D-075, D-076, D-078, D-093 to D-099; ADR-014, ADR-015, ADR-016; spec `docs/superpowers/specs/2026-10-03-lifi-hardening-design.md`; `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`; `docs/domains/ASSET-REGISTRY.md`; `docs/domains/FUTURE-PLANS.md`; `apps/api/README.md`

## Context

The LI.FI FAQ and a review of the Spec 8 to 10 flows showed gaps: a rebalance buy is funded by sale proceeds the wallet does not hold when the plan is made, so a per-leg quote for it can fail; LI.FI refuses Solana wallets without SOL with an unhelpful error; Mayan routes can fail to deliver to a smart-contract address; a cross-chain leg can end with a different token delivered (a failed destination swap), which ADR-014 left as `UNKNOWN` for ops; refunds were not explained to the user; there was no price-impact limit; ops could not take a bridge or exchange out of use; route fees were not disclosed; and ops had no way to look at LI.FI's own record of a transfer, check a token against LI.FI's list, or flag a token that charges a transfer tax.

## Decision

### 1. Estimates and quotes (D-093)

- `RouteProvider.estimate` calls LI.FI `POST /v1/advanced/routes` without `fromAddress`, so it needs no balance, and returns the first route (amounts, minimum, gas, route fees, tool summary, price impact).
- Planning uses an estimate where the funds are not held yet: every rebalance buy leg, and any plan quote LI.FI refuses with code 1001 (it cannot build a transaction for this wallet). A rebalance buy's plan minimum is the route's `toAmountMin`, scaled to the buy amount (D-076). Platform gas for a Solana-source estimate is LI.FI's own gas figure from the estimate, plus one token-account rent only when the destination is a Solana token whose account the user's wallet lacks (`getAccountInfo`; an RPC error counts as missing, as in the Spec 10 fee planner); both enter the network fee and the reservation, and the leg records `reservedNative`. At execution, if the platform exposure of the Solana transaction `quoteLeg` builds exceeds what remains reserved for the leg, the reservation is topped up under the per-chain lock and the daily caps (409 `GAS_BUDGET_EXHAUSTED` otherwise).
- An estimate never authorizes anything. Execution still takes a real quote per leg and keeps every Spec 8 validation (D-073 price guard, byte-identical Solana message, EVM `to`/`data`/`value` check, PSBT check).

### 2. `SOL_REQUIRED` (D-094)

LI.FI's refusal of a Solana wallet without SOL is mapped to 409 `SOL_REQUIRED`: "Add a small amount of SOL (~0.003) to your Solana wallet to continue." The platform does not drop SOL to users in this release. LI.FI documents no wording for it. Verified live (2026-10-03): the refusal is HTTP 404, code 1002, with the cause only in `errors.filteredOut[].reason` ("SOL balance insufficient to cover temporary token account creation"); `svmSponsor` does not avoid it for tools that need a temporary token account (observed with `mayanFastMCTP` only; with the full tool set the same wallet got sponsored layerswap and jupiter quotes). `SOL_REQUIRED` is raised when every filtered reason says so and `errors.failed` is empty (no route failed for another reason).

### 3. Mayan and contract destinations (D-095)

A destination EVM address with contract code (`eth_getCode`, cached 1 h) denies every LI.FI bridge whose `/v1/tools` key starts with `mayan`. An EOA does not.

### 4. Recovery leg (D-096)

- When LI.FI reports `DONE` with substatus `PARTIAL` and chain evidence shows a different token delivered to the user's address, the original leg becomes `FAILED` (`DESTINATION_SWAP_FAILED`, `recoveryToken` from the chain) and the same operation gets one user-signed `swap` leg (`recovery_of`, unique per leg) from the delivered token to the intended target (USDC on Solana for a sell). Without readable chain evidence there is no recovery leg and the leg stays `UNKNOWN` for ops (D-075).
- Sized from chain evidence only (a provider-reported amount of 300 with 299 on chain recovers 299). The recovery leg's summary carries the delivered token (`fromSymbol`, `fromDecimals`) and the target (`symbol`, `decimals`). The leg is quoted fresh when signed; its minimum is the fresh quote's, bounded by the operation slippage (there is no plan to renew, so no `PRICE_MOVED`); the web shows that quote's estimate and minimum in the target token before the wallet opens, so the user signs figures they have seen. No new network fee; gas is reserved when the leg is quoted (EVM drop sized at detection, Solana exposure at quote), within the per-user and global caps (`GAS_BUDGET_EXHAUSTED` otherwise), and unspent reservations are released on stop (D-072).
- While any recovery leg is not final (`PLANNED` to `UNKNOWN`) the operation stays `IN_PROGRESS`, even if another leg failed or every buy ended `NO_FUNDS` (a rebalance whose only sell was recovered): the user can still sign it or Stop (`PARTIAL`, unsent recovery released, D-072). Once every recovery is final the usual `COMPLETED`/`PARTIAL`/`FAILED` rules apply. A rebalance-sell recovery runs after the buys, which were sized without its proceeds, so the recovered USDC sits as basket cash until the next reconciliation. A delivered token equal to the target (or a leg with no readable evidence) creates no recovery and stays `UNKNOWN` for ops. LI.FI `FAILED` with a receiving transaction is not recovered (real-key check).
- Recovery is created only while the operation is `IN_PROGRESS` and the delivered transaction is finalized; a recovery whose own destination swap fails is `UNKNOWN`, not recovered again; bitcoin destinations are never recovered.
- Accounting: the source side of the original leg is written once when it fails (sell: position ledger debit; rebalance buy: basket cash debit; invest and repair: free USDC, no entry); the destination side is written once when the recovery settles, from the chain-evidenced received amount, by the original leg's role (invest ledger, rebalance ledger, repair split D-080, rebalance-sell cash). Re-running the tracker changes nothing (checked under the operation lock).
- Ordering: recovered originals never block later legs; a recovery waits until every non-recovery leg is `SETTLED` or `FAILED`. "Stop here" (or the 7-day auto-stop, D-109) leaves the recovery unsent: the operation is `PARTIAL` and the delivered token stays in the wallet, outside baskets (a rebalance basket may show cash `SHORT` until synced, D-078).

### 5. Refund messaging (D-096)

The status check persists LI.FI's `substatus`. `NOT_PROCESSABLE_REFUND_NEEDED` and `REFUND_IN_PROGRESS` show "Refund in progress (the route couldn't complete)"; a failed leg with `REFUNDED` shows "Funds returned to your wallet". `NOT_PROCESSABLE_REFUND_NEEDED` is not documented where it could be read; it is treated as a pending refund when the status is `FAILED` (real-key check).

### 6. Price impact (D-097)

Minimum output (user ruling, Spec 14): a quoted `toAmountMin` is accepted when `quotedMin >= expectedMin - max(floor(expectedMin / 1e6), 10^(decimals - 8), 1)` (BigInt, destination token decimals from our registry (USDC on Solana: `USDC_DECIMALS`), never the response, capped at 18; a response whose `toToken.decimals` differs is refused; 1 ppm or 1 unit for tokens of 8 decimals or fewer). Layerswap rounds 18-decimal amounts to 1e10 wei (about 2.7 ppm on a 0.00185 ETH leg), which a flat 1 ppm refused. A weaker minimum is still refused; D-073 is unaffected. Deeper fix: FUTURE-PLANS (Routing provider robustness).

Every estimate and quote sends `maxPriceImpact = 0.05`. Because LI.FI's honoring of the parameter is unverified, the server also computes the impact itself: 1 - (`toAmountUSD` + included route fees USD) / `fromAmountUSD` (D-107), so a fee-heavy route is not mistaken for slippage. Above 5% it is refused with 503 `ROUTE_UNAVAILABLE`, "Price impact too high for this trade size."; there is no check under $10 or without USD values. Previews show this figure for each leg in warning style from 2%.

### 7. Route deny list and ops tools (D-098, D-099)

- `route_policy_entries` (kind `bridge` or `exchange`, LI.FI tool key, reason 1 to 500 characters, who and when, removed by and when; rows are never deleted). `ops_admin` denies and allows (audited); ops roles read. Active entries are sent as LI.FI deny lists on every estimate and quote (60 s in-process cache); keys absent from LI.FI's current `/v1/tools` are dropped first, because an unknown key makes LI.FI fail the whole request (400, code 1011). This fails open for a renamed tool (user ruling, Spec 14): the drop is logged (`logger.warn`, once per key per process-hour) and `GET /v1/ops/routing` marks the entry `stale: true`; `/ops/routing` shows "Stale: LI.FI no longer lists this key; re-deny under the new key". Quote encoding is repeated query parameters, routes use body arrays. A deny list only narrows routes. `/ops/routing` lists LI.FI's bridges and exchanges (`/v1/tools`, cached 1 h) with deny state and history. Denying an already-denied entry returns 400 `VALIDATION_FAILED`, not 409.
- Route fees: LI.FI `feeCosts` become `routeFees` (`name`, `amountUsd`, `included`) stored with the leg; previews show "Route fees (LI.FI, DEX, bridge): $X — included in the estimate".
- LI.FI transfers (`ops_admin`, read-only): `GET /v1/ops/operations/:id/legs/:legId/lifi-transfers` proxies LI.FI `GET /v2/analytics/transfers` for the leg's source address within 24 h of the submission (the design said v1; the documented path is v2). The records are provider data, an aid and never evidence.
- Token verification: the asset review deployment view shows `lifiVerification` (`verified` when the token's `verificationStatus` is `verified`, `unverified` otherwise, null when unknown; cached 24 h per chain). `flagged` is in the type and never produced until a real-key check finds a flag value.
- Fee-on-transfer: `ops_admin` flags a deployment (`instrument_deployments.fee_on_transfer`, audited as an asset event). Legs touching it carry `feeOnTransfer` and previews say "This token charges a transfer tax; amounts are estimates."

### 8. Recovery auto-stop (D-109)

The 5-minute sweep stops an operation whose recovery leg has been `PLANNED` for more than 7 days, as the user's Stop would (`PARTIAL`, unsent reservations released, audit `operation.auto_stopped`), and notifies the user (`execution_incomplete`, "We stopped your unfinished swap; the tokens that arrived are in your wallet."). The deeper fix is in `docs/domains/FUTURE-PLANS.md` (Execution robustness).

## Alternatives considered

- **A separate `recover` operation instead of an in-operation leg:** cleaner accounting boundary and its own network fee, but a second plan and signing flow for the user and no continuity with the failed operation. Kept as a future plan.
- **Platform SOL drop for wallets without SOL:** removes the failure, but adds a new money-moving path and a new cap. The refusal copy is enough for release 1.
- **Allow list instead of deny list:** safer by default, but ops would have to approve every bridge and exchange for every route change. A deny list only narrows routes and matches how LI.FI exposes the options.
- **Ops-configurable price-impact limits:** a constant 5% is simple and safe; per-chain or per-asset limits wait for data.
- **Recovery for provider-reported amounts:** rejected; a provider amount is never written to a ledger (D-075).

## Consequences

### Positive
- Rebalances plan with all value in assets and no free USDC; users get an actionable SOL message; a failed destination swap is recoverable in the flow the user is already in; refunds are explained; large-impact routes are refused; ops can react to an incident in a minute; route fees are disclosed.

### Negative / trade-offs
- An estimate can differ from the later quote (the minimum is checked on the real quote; D-073 still applies). A recovery can execute at a worse price than the estimate within the operation slippage. `flagged` verification is unavailable until LI.FI exposes a signal. If the user stops, a delivered token sits outside baskets.

### Security, financial and operational impact
- Estimates authorize nothing. The recovery leg is user-signed, sized and ledgered from chain evidence, one per leg, with gas inside the existing caps. Deny lists only narrow routes. The analytics proxy is `ops_admin`, read-only and not evidence. Tests mock LI.FI, RPC and wallets; nothing is broadcast.

## Migration / rollout

Migration `0014_lifi_hardening.sql`: `operation_legs.recovery_of`, `recovery_token`, `provider_substatus`; `route_policy_entries`; `instrument_deployments.fee_on_transfer`; SELECT/INSERT/UPDATE grants and RLS as earlier migrations, no DELETE. New error code `SOL_REQUIRED`. Operation and leg views gain `priceImpact`, `routeFees`, `providerSubstatus`, `recoveryOf`, `recoveryToken`, `feeOnTransfer`. Web: previews, leg progress, `/ops/routing`, LI.FI transfers lookup, deployment badge and flag. Mobile is unchanged (its leg fixtures may need the new fields).

## Validation

Unit and integration tests with mocked LI.FI, RPC and wallets (`lifi-hardening`, `recovery`, `ops/routing`, web `route-fees`, `recovery`, `ops-routing`). Real-key checks are listed in `docs/OPEN-ITEMS.md` and `apps/api/README.md`.

## Open questions

- Confirmed by the keyless live check of 2026-10-03: no-SOL and price-impact shapes, Mayan key names, deny-list encoding, `advanced/routes` without `fromAddress` for Solana, analytics access (seconds, cursor pagination, request `limit=100`), token flag (`verificationStatus`; only `verified` counts). Still open with a real key: `NOT_PROCESSABLE_REFUND_NEEDED`, the code 1001 shape, a `FAILED` status with a receiving transaction (`docs/OPEN-ITEMS.md` section 5).
- Release of unspent gas after a stop credits the operation's creation-day sponsor row (a stop after UTC midnight credits the old day); an operation planned before Spec 12 releases a quote-time leg's top-up only with the whole plan.

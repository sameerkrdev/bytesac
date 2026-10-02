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
- Planning uses an estimate where the funds are not held yet: every rebalance buy leg, and any plan quote LI.FI refuses with code 1001 (it cannot build a transaction for this wallet). A rebalance buy's plan minimum is the route's `toAmountMin`, scaled to the buy amount (D-076). Platform exposure for a Solana-source estimate is conservative: one signature, the priority-fee ceiling and one token-account rent.
- An estimate never authorizes anything. Execution still takes a real quote per leg and keeps every Spec 8 validation (D-073 price guard, byte-identical Solana message, EVM `to`/`data`/`value` check, PSBT check).

### 2. `SOL_REQUIRED` (D-094)

LI.FI's refusal of a Solana wallet without SOL is mapped to 409 `SOL_REQUIRED`: "Add a small amount of SOL (~0.003) to your Solana wallet to continue." The platform does not drop SOL to users in this release. The refusal wording is not documented; the match is a real-key check.

### 3. Mayan and contract destinations (D-095)

A destination EVM address with contract code (`eth_getCode`, cached 1 h) denies every LI.FI bridge whose `/v1/tools` key starts with `mayan`. An EOA does not.

### 4. Recovery leg (D-096)

- When LI.FI reports `DONE` with substatus `PARTIAL` and chain evidence shows a different token delivered to the user's address, the original leg becomes `FAILED` (`DESTINATION_SWAP_FAILED`, `recoveryToken` from the chain) and the same operation gets one user-signed `swap` leg (`recovery_of`, unique per leg) from the delivered token to the intended target (USDC on Solana for a sell). Without readable chain evidence there is no recovery leg and the leg stays `UNKNOWN` for ops (D-075).
- Sized from chain evidence only (a provider-reported amount of 300 with 299 on chain recovers 299). The leg is quoted fresh when signed; its minimum is the fresh quote's, bounded by the operation slippage (there is no plan to renew, so no `PRICE_MOVED`). No new network fee; gas is reserved when the leg is quoted (EVM drop sized at detection, Solana exposure at quote), within the per-user and global caps (`GAS_BUDGET_EXHAUSTED` otherwise), and unspent reservations are released on stop (D-072).
- Recovery is created only while the operation is `IN_PROGRESS` and the delivered transaction is finalized; a recovery whose own destination swap fails is `UNKNOWN`, not recovered again; bitcoin destinations are never recovered.
- Accounting: the source side of the original leg is written once when it fails (sell: position ledger debit; rebalance buy: basket cash debit; invest and repair: free USDC, no entry); the destination side is written once when the recovery settles, from the chain-evidenced received amount, by the original leg's role (invest ledger, rebalance ledger, repair split D-080, rebalance-sell cash). Re-running the tracker changes nothing (checked under the operation lock).
- Ordering: recovered originals never block later legs; a recovery waits until every non-recovery leg is `SETTLED` or `FAILED`. "Stop here" leaves the recovery unsent: the operation is `PARTIAL` and the delivered token stays in the wallet, outside baskets (a rebalance basket may show cash `SHORT` until synced, D-078).

### 5. Refund messaging (D-096)

The status check persists LI.FI's `substatus`. `NOT_PROCESSABLE_REFUND_NEEDED` and `REFUND_IN_PROGRESS` show "Refund in progress (the route couldn't complete)"; a failed leg with `REFUNDED` shows "Funds returned to your wallet". `NOT_PROCESSABLE_REFUND_NEEDED` is not documented where it could be read; it is treated as a pending refund when the status is `FAILED` (real-key check).

### 6. Price impact (D-097)

Every estimate and quote sends `maxPriceImpact = 0.05`. A refusal is 503 `ROUTE_UNAVAILABLE`, "Price impact too high for this trade size." Previews show the price impact of each leg (from `fromAmountUSD` and `toAmountUSD`; absent without USD values) in warning style from 2%.

### 7. Route deny list and ops tools (D-098, D-099)

- `route_policy_entries` (kind `bridge` or `exchange`, LI.FI tool key, reason 1 to 500 characters, who and when, removed by and when; rows are never deleted). `ops_admin` denies and allows (audited); ops roles read. Active entries are sent as LI.FI deny lists on every estimate and quote (60 s in-process cache). A deny list only narrows routes. `/ops/routing` lists LI.FI's bridges and exchanges (`/v1/tools`, cached 1 h) with deny state and history.
- Route fees: LI.FI `feeCosts` become `routeFees` (`name`, `amountUsd`, `included`) stored with the leg; previews show "Route fees (LI.FI, DEX, bridge): $X — included in the estimate".
- LI.FI transfers (`ops_admin`, read-only): `GET /v1/ops/operations/:id/legs/:legId/lifi-transfers` proxies LI.FI `GET /v2/analytics/transfers` for the leg's source address within 24 h of the submission (the design said v1; the documented path is v2). The records are provider data, an aid and never evidence.
- Token verification: the asset review deployment view shows `lifiVerification` (`verified` when LI.FI lists the token, `unverified` when not, null when unknown; cached 24 h per chain). LI.FI's token list documents no flag field, so `flagged` is in the type and never produced until a real-key check finds one.
- Fee-on-transfer: `ops_admin` flags a deployment (`instrument_deployments.fee_on_transfer`, audited as an asset event). Legs touching it carry `feeOnTransfer` and previews say "This token charges a transfer tax; amounts are estimates."

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

- The exact no-SOL and price-impact refusal shapes, `NOT_PROCESSABLE_REFUND_NEEDED`, Mayan key names, deny-list parameter encoding, a token flag field, `advanced/routes` without `fromAddress` for Solana, analytics access and timestamp unit (real-key checks).
- Release of unspent recovery gas after stop credits the current UTC day's budget row, not the day it was reserved.

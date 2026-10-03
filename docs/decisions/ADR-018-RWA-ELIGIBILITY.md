# ADR-018: Secondary-Market RWAs and the Eligibility Engine (Release 1)

- **Status:** APPROVED for the six user decisions of the 2026-10-03 brainstorm (secondary-market only, self-declaration plus geo signal, deny-by-default engine, buys blocked / holdings kept / sells per sell rules, market price required, permissionless only); implemented in Spec 11. Implementation details decided by the controller are labelled "Ruling (controller, 2026-10-03)" and await owner confirmation.
- **Date:** 2026-10-03
- **Owners:** Product + platform engineering
- **Related:** D-025, D-026, D-069, D-100 to D-106; ADR-002, ADR-010, ADR-014, ADR-015, ADR-017; spec `docs/superpowers/specs/2026-10-03-rwa-eligibility-design.md`; `docs/domains/ASSET-REGISTRY.md`; `docs/domains/INVESTMENT-REBALANCING-DRIFT-FIX.md`; `docs/domains/FUTURE-PLANS.md`; `apps/api/README.md`

## Context

D-025 asked for eligibility evaluated per user, instrument, route, jurisdiction and action, and D-026 left RWA execution open per instrument and provider. The registry already stored eligibility rules (Spec 5) and investability refused every tokenized asset (`RWA_NOT_SUPPORTED`, D-069). Tokenized treasuries, funds, equities and commodities that trade permissionlessly on chain can be bought and sold through LI.FI exactly like crypto, so the smallest honest release is those tokens, gated by an engine that records every decision. No KYC vendor exists, and no legal policy value may be invented.

## Decision

### 1. Scope: secondary-market tokens only (D-026)

An RWA is any `TOKENIZED_*` asset type (`RWA_ASSET_TYPES`). Release 1 trades only tokens whose route method is `swap` or `secondary_market` through LI.FI, synchronously, with the same user-signed legs as crypto (ADR-013, ADR-014). Issuer subscription and redemption, asynchronous settlement states, platform inventory and conventional broker-held instruments are never offered; they are future plans.

### 2. Declarations (D-100)

`eligibility_declarations` is append-only: country (ISO 3166-1 alpha-2), investor status (`retail`, `accredited`, `qualified`, `professional`), the attestation version, the IP country seen, and the time. The latest row is current and expires 365 days after it was made. `POST /v1/me/eligibility` (session, 10 per day per user, audited `eligibility.declared`) records one; `GET /v1/me/eligibility` returns `{ declaration }` with `expiresAt` and `expired`, or `null`. The attestation (`ELIGIBILITY_ATTESTATION`, version `2026-10-03`) is placeholder wording that compliance must confirm. A declaration is required only when a basket holds an RWA; the web shows the form in the profile and inline when a plan returns 409 `DECLARATION_REQUIRED`.

### 3. Geo signal (D-101)

The API reads the request header named by `GEO_COUNTRY_HEADER` (for example `CF-IPCountry`) and trusts it only when the variable is set; the edge must strip any client-supplied value. Missing, `XX` and `T1` values are ignored. A signal that differs from the declared country gives `REVIEW_REQUIRED` (`IP_COUNTRY_MISMATCH`). Unset means no signal and no mismatch.

### 4. Engine (D-102)

`evaluateEligibility` in `@repo/validator` is pure. Crypto and stablecoins are untouched by it: enforcement applies to RWA assets only, so an old rule on a crypto asset changes nothing. For an RWA: no current declaration gives `DECLARATION_REQUIRED` (returned to the client, never stored as a leg decision); a geo mismatch gives `REVIEW_REQUIRED`; candidate rules are `ACTIVE`, for the instrument, route null or equal, jurisdiction equal to the declared country or `*`, the same action, and `investorStatuses` empty or containing the user's status. The most specific tier wins (route and country, route and `*`, instrument and country, instrument and `*`); within a tier the strictest outcome wins (`RESTRICTED`, then `KYC_REQUIRED`, `REVIEW_REQUIRED`, `ALLOWED`). No candidate means `RESTRICTED` (`NO_RULE`): deny by default.

### 5. Enforcement (D-103)

| Point | Action | When not `ALLOWED` |
|---|---|---|
| Investability and basket page | `acquire`, each RWA constituent | not investable for the user, reason `NOT_ELIGIBLE_ASSET` or `DECLARATION_REQUIRED` per asset |
| Invest plan | `acquire` | 409 `NOT_ELIGIBLE` (reasons in `details`) or `DECLARATION_REQUIRED` |
| Rebalance (apply, drift fix) | `acquire` for each RWA buy leg, `sell` for each RWA sell leg, at plan time | a buy or sell leg whose outcome is not `ALLOWED` refuses the plan (409 `NOT_ELIGIBLE` with a reason per asset, or `DECLARATION_REQUIRED`); an RWA that is only held never refuses it; Skip, Keep custom and Leave remain |
| Repair buy-back | `acquire` | refused; Sync remains |
| Sell to USDC, Sell former assets | `sell` | `RESTRICTED`, `KYC_REQUIRED` and `REVIEW_REQUIRED` assets, and RWAs with no current declaration, are left out and listed in `excluded[]` with a notice; the rest sells; nothing left is 409 `NOT_ELIGIBLE` (`DECLARATION_REQUIRED` when a declaration is what is missing) |
| Leg quote (every RWA leg, including recovery legs to an RWA) | the leg's action | 409 `NOT_ELIGIBLE`; settled legs stand |

Existing holders are never forced to sell; a restricted asset stays in the user's own wallet. Each RWA leg's decision is stored in `eligibility_decisions` (append-only: operation, leg, user, instrument, route, action, outcome, rule ids, declaration, IP country, time) at plan time and at every quote; sell exclusions are stored with no leg. Every check runs on the server.

Ruling (controller, 2026-10-03): a rebalance is refused only when a buy leg would acquire an RWA whose `acquire` outcome is not `ALLOWED`; a held or sold RWA never refuses it on `acquire` grounds. Ruling (controller, 2026-10-03): an RWA that is held but no longer investable keeps its target at the held deployment and refuses the plan only if it would be bought; selling it needs an `ACTIVE` or `PAUSED` deployment and a quotable route (D-111). Ruling (controller, 2026-10-03): every RWA sell leg of a rebalance is evaluated with `sell` at plan time, stored with its leg, and a non-`ALLOWED` outcome refuses the plan. Ruling (controller, 2026-10-03): a sell with no current declaration excludes each RWA (notice "Confirm your eligibility to sell X through Bytesac.", no decision row, since `DECLARATION_REQUIRED` is never stored) and sells the rest; it is refused only when nothing is left. Ruling (controller, 2026-10-03): creating a recovery leg (a system step with no user or IP) is not checked, its quote is; plan-time refusals and an all-excluded sell store no decision row; a repeated idempotent sell rebuilds `excluded[]` from the stored decisions that have no leg (an exclusion for a missing declaration has none).

### 6. Pricing (D-104)

An RWA is investable only with an `ACTIVE` CoinMarketCap market price reference (fresh within five minutes, ADR-002). NAV stays display only and is never used to size a trade.

### 7. Permissioned tokens (D-105)

`instrument_deployments.permissioned` (default false) is set by `ops_admin` (audited). A deployment with the flag is never investable (`RWA_PERMISSIONED`). The other structural reasons are `RWA_ROUTE_UNSUPPORTED` (no `ACTIVE` `swap` or `secondary_market` route with an enabled provider) and `RWA_PRICE_REQUIRED`. Basket validation turns them into warnings for managers; ops review warns when an RWA has no `ACTIVE` rule ("Restricted everywhere until rules exist").

### 8. Token-2022 (D-106)

No separate refusal. `getParsedTokenAccountsByOwner(owner, { mint })` and the pre and post token balances used for received amounts return accounts of either token program. The associated-token-account derivation for the rent estimate uses the legacy program, so for a Token-2022 mint the estimate wrongly assumes the account is missing and over-reserves (safe). Transfer-fee and transfer-hook extensions are not read; ops use the `feeOnTransfer` flag. Not yet checked against a real RPC (OPEN-ITEMS).

## Alternatives considered

- **KYC vendor now:** needs a vendor, cost and a data-protection design. Self-declaration plus a geo signal is weaker evidence but needs no personal documents; `KYC_REQUIRED` simply blocks. A vendor is a future plan.
- **Issuer subscription and redemption in release 1:** needs asynchronous settlement states, lockups and fees across every issuer. Deferred; no instant redemption is ever implied.
- **Rebalance without the blocked asset:** keeps rebalancing available but silently deviates from the manager's target unless confirmed; detailed in `FUTURE-PLANS.md`.
- **NAV or LI.FI price fallbacks, permissioned tokens via ops records or on-chain allowlists, a platform inventory route:** each needs a hierarchy, evidence or custody decision of its own; all in `FUTURE-PLANS.md`.
- **Trusting the geo header always:** a client could send it. It is trusted only when the deployment names the header, and the edge must overwrite it.

## Consequences

- Baskets can hold tokenized assets, and every acquisition is gated by a recorded server-side decision. With no matching rule an RWA is unavailable to everyone, so ops must enter rules from provider terms before any RWA is offered.
- Eligibility values, investor-status definitions per jurisdiction, the attestation wording and the legal review of offering RWAs on self-declaration are open (`docs/OPEN-ITEMS.md`).
- Each RWA leg quote (every 60 s refresh) appends a decision row; investability reads CoinMarketCap prices (60 s cache) for RWA constituents.
- Web only; mobile does not show the declaration form or notices in this release.

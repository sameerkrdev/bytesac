# Future Plans

Source: `Future-Plans.txt`

The source lists these as future expansion ideas, not initial-release commitments:

- Multiple wallets: connect Phantom, then add MetaMask and other wallets through settings.
- Additional investment options: fixed deposits and recurring deposits.
- Additional assets: US and other-country stocks, ETFs, treasuries, commodities, equity indices, currencies/rates and pre-IPO (including Web2/Web3 companies such as MetaDAO).

- LI.Fuel: route-provided destination gas top-up as an alternative to the platform gas drops of ADR-014 (not used in release 1).
- Conventional ETFs and stocks: broker-held rather than on-chain, so they need a new custody ADR before any specification (ADR-013 covers self-custody of on-chain assets only).
- Direct sell-to-buy pairing for rebalances: match a sale directly to a purchase (one hop per pair) instead of routing through USDC on Solana; needs pairing, partial-fill and per-pair failure handling (ADR-015 alternative).
- One combined repair plan across all short assets, so a user with several shortfalls signs once and pays one network fee (Spec 9 repairs one deployment at a time).
- Subscriptions (the whole feature; the version field stays a disclosure "not collected in this release"): prepaid signed periods, auto-renewal through token delegation (needs its own ADR before any implementation, ADR-013 forbids delegated spending), lapse effects and a subscription management page.
- Management-fee accrual and collection (annual fee on holdings; needs a collection point and a rule for unpaid fees).
- Manager and platform fees always paid up front from free USDC, instead of following the D-079 placement for rebalances.
- Fee credits or refunds for operations that end `PARTIAL` or `FAILED` or are stopped (Spec 10 refunds nothing).
- A platform take rate on manager fees (a share of each manager fee to the platform).
- Tax statements for investors and organizations (fees paid and earned).
- Fees on mobile (Spec 10 is web and API only).
- LI.FI integrator `fee` (B1): charge the platform fee through LI.FI's integrator `fee` parameter, collected in each leg's `fromToken` to the integrator wallet, instead of the up-front USDC fee leg.
- LI.FI route `order` per route kind (B4): choose `FASTEST` or `CHEAPEST` per kind of route.
- LI.FI `stepTransaction` with `skipSimulation=true` and per-step transactions (B8).
- A separate `recover` operation (own network fee) for a failed destination swap, instead of the in-operation recovery leg of ADR-017.
- Ops-configurable price-impact limits per chain or asset (release 1 uses a constant 5%).
- A platform SOL drop for Solana wallets without SOL (release 1 shows `SOL_REQUIRED`).
- Alchemy address-activity webhooks for instant drift and shortfall detection (Spec 9 polls on the nightly job and on portfolio read).
- Mobile push (Firebase Cloud Messaging for iOS and Android) and the mobile portfolio, rebalance, repair and notification screens.
- Moving web and API push from FCM registration tokens to Firebase Installation IDs when the token APIs are removed.

- Discovery extras: investor counts and real returns, price-history backfill, saved searches, personalized recommendations, and a background-jobs dashboard.
- Registry extras: manager asset proposals, Polygon and Bitcoin on-chain verification (Bitcoin data provider).
- Basket commentary from managers to investors.

### RWAs and eligibility (deferred from Spec 11)

- Issuer subscription and redemption routes with asynchronous settlement states (`ELIGIBILITY_PENDING`, `SETTLEMENT_PENDING`, `ISSUANCE_PENDING`, `REDEEMING`, `SETTLED`, `REJECTED`, `CANCELLED`), redemption windows, lockups and fees, and removed-RWA disposition in rebalances (retain as legacy or wait for the window; never a fictional instant sell). Release 1 supports secondary-market RWA tokens through LI.FI only.
- A KYC vendor (identity, residence and accreditation verification) so `KYC_REQUIRED` assets can be offered; release 1 uses self-declared country and investor status plus a geo-IP signal, and blocks `KYC_REQUIRED`.
- **Rebalance without the blocked asset (Spec 11 Q4 option B).** Today a rebalance (or repair) whose buy legs would acquire an RWA the user may not acquire is refused, and the user can Skip, Keep custom or Leave. The alternative: plan every other leg and keep the blocked asset's target share as basket cash. Needed: (1) the planner drops buys whose eligibility is not `ALLOWED` and records each as a `position_decisions` row (`kind: eligibility_exclusion`, instrument, outcome, rule ids); (2) the preview states the deviation ("RWA X is not available to you; its 10% stays as cash in this basket") and the user confirms it explicitly; (3) the position is shown as `CUSTOMIZED` with reason "eligibility" so drift prompts stop for that asset; (4) when the user's eligibility later becomes `ALLOWED` (new declaration or rule change), notify and offer a rebalance that buys it; (5) fee bases exclude the dropped buys. Trade-off: the user can always rebalance, but the basket deviates from the manager's target, which must never happen silently.
- **RWA price fallbacks (Spec 11 Q5 options B and C).** Release 1 requires an `ACTIVE` CoinMarketCap market price for an RWA to be investable; NAV is display only. Alternatives: (B) use the ops-entered NAV when no market price exists, only if updated within a configured number of days, flagged "valued at NAV" in previews and drift; risk: NAV can differ from the DEX price and mis-size trades. (C) use LI.FI token `priceUSD` as a second market source when CoinMarketCap has none; needs a source hierarchy, freshness rules and an ADR-002 amendment.
- **Permissioned RWA tokens (Spec 11 Q6 options B and C).** Release 1 never offers a deployment flagged `permissioned` (allowlisted transfers). Alternatives: (B) ops record "wallet X allowlisted for token Y" from the issuer (manual, audited, per user and chain; the planner checks the record before offering the asset); (C) read the issuer contract's allowlist on chain per user before planning (accurate but every issuer contract differs, so one adapter per issuer).
- A platform inventory route (platform-held RWA inventory sold to users); needs a custody and legal ADR.

### Execution robustness (deferred from Spec 12)

- **Stuck recovery legs, deeper fix (Spec 12 Q4).** Release 1 (Spec 12) stops an operation automatically when its unsent recovery leg is older than 7 days (operation `PARTIAL`, gas released, the delivered token stays in the user's wallet, user alerted). The problem underneath: a user may hold only one `PLANNED`/`IN_PROGRESS` operation, so a pending "Complete swap" blocks every other invest, sell or rebalance until it is signed, stopped or auto-stopped. Deeper fix: (1) replace the per-user lock with **per-asset reservations** so a pending recovery only blocks operations that touch the same deployments or the same basket cash, and unrelated baskets stay usable; (2) reminders through the inbox, email and push at 24 h and 72 h before the auto-stop; (3) after an auto-stop, offer a one-click "Recover now" plan later (a new operation that swaps the delivered token to the original target, with its own network fee — see the separate `recover` operation entry above); (4) let the user choose at failure time between "complete now", "keep the delivered token" (close as `PARTIAL` immediately) and "remind me"; (5) ops view of stuck recoveries. Needs a concurrency review because two operations could then spend the same wallet balance; reservations must be enforced in the planner and at quote time.
- **Held assets that are no longer investable, deeper fix (Spec 12 Q5).** Release 1 (Spec 12) lets a rebalance proceed when only the assets it buys are investable and the assets it sells have a working sell route, and alerts ops with the affected baskets when an instrument stops being investable (permissioned flag, retired route, paused instrument). Deeper fix, a **disposition flow**: (1) notify every holder ("Asset X can no longer be bought through Bytesac") with the reason; (2) offer per-holder choices — sell now where a sell route exists, or keep it as a **legacy holding** shown separately in the basket and excluded from drift and target weights; (3) ask the basket's managers (inbox + email) to publish a replacement version, with an ops deadline and escalation; (4) a portfolio state `LEGACY_HOLDING` and an investability reason shown on the basket page; (5) when the asset becomes investable again, clear the legacy state and notify; (6) RWAs with redemption windows reuse this flow once issuer routes exist (see issuer subscription/redemption above). Needs manager and ops UI and a decision on how fees treat legacy holdings.

Do not expose these as supported production capabilities until separately approved, specified and implemented.

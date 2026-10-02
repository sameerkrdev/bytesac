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

Do not expose these as supported production capabilities until separately approved, specified and implemented.

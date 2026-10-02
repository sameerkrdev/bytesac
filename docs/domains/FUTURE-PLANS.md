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
- Alchemy address-activity webhooks for instant drift and shortfall detection (Spec 9 polls on the nightly job and on portfolio read).
- Mobile push (Firebase Cloud Messaging for iOS and Android) and the mobile portfolio, rebalance, repair and notification screens.
- Moving web and API push from FCM registration tokens to Firebase Installation IDs when the token APIs are removed.

Do not expose these as supported production capabilities until separately approved, specified and implemented.

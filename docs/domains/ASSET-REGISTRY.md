# Universal Asset Registry — Domain Context

Source: `Assets-Registry.txt`

## Purpose and scope
The registry is the platform-approved inventory of investable instruments. Initial scope is crypto assets, crypto tokens and approved RWAs on supported chains. Future instruments (including conventional stocks and ETFs) are not enabled merely because the model is extensible.

## Three-level model
- **Instrument:** economic identity selected by a basket/portfolio.
- **Deployment:** chain-specific representation (contract address, mint or other identifier), decimals and status.
- **Execution route:** provider/venue and supported action such as acquisition, swap, subscription, secondary-market trade, transfer or redemption.

Keep price references and eligibility policies associated with the appropriate instrument/route. A single economic instrument may have multiple deployments, but a deployment is not automatically interchangeable with another.

## Onboarding and approval
- Crypto/token onboarding validates identity, chain, contract/mint, metadata and relevant operational properties.
- RWA onboarding must capture issuer/product details, applicable restrictions, price references and execution/settlement route.
- Platform review controls approval and route activation.
- Managers select approved registry instruments, not arbitrary addresses.

**Logos (ADR-019, D-115).** Ops reviewers may upload a logo (PNG, JPEG or WebP, up to 512 KB, never SVG) for an instrument in any status; it is presentation only and audited. Clients show the uploaded logo first, then the vendored CC0 icon for the ticker, then a monogram.

## Eligibility and routing
Evaluate eligibility in context: user, instrument, provider, route, jurisdiction and action. A direct subscription, secondary-market purchase, transfer, redemption and cross-chain movement may have different requirements. Re-check before execution.

**Decided (ADR-018, D-025, D-026, D-100 to D-106):** release 1 supports only permissionless secondary-market RWA tokens (any `TOKENIZED_*` type) through LI.FI; issuer subscription, redemption and asynchronous settlement are not offered. A pure engine (`evaluateEligibility`) decides `ALLOWED`, `RESTRICTED`, `KYC_REQUIRED`, `REVIEW_REQUIRED` or `DECLARATION_REQUIRED` per user, instrument, route and action from the user's self-declared country and investor status, an optional geo-IP signal and the `ACTIVE` rules; an RWA with no matching rule is `RESTRICTED`, and crypto and stablecoins are not affected. Rules have `investorStatuses` (empty means every status) in the ops rule editor. A deployment flagged `permissioned` (`ops_admin`) is never investable; an RWA needs a route with method `swap` or `secondary_market` and an `ACTIVE` CoinMarketCap price reference to be offered. Ops review and the asset editor warn "Restricted everywhere until rules exist" for an RWA with no `ACTIVE` rule. Policy values come from provider terms, not from the platform.

## Lifecycle and reconciliation
Use explicit lifecycle states for assets, deployments and routes. Do not expose disabled, unverified or inactive routes as executable. Track execution and settlement state and reconcile observed holdings.

## Provider boundary
Providers are capability adapters, not universal guarantees. Keep chain/provider-specific behavior out of basket and portfolio semantics. Verify coverage and commercial/legal terms for each asset and route.

## behavior (ADR-010)
Nothing in the registry executes, signs, broadcasts or moves assets: routes and eligibility rules are records, and every RPC call is read-only.

- **Who:** ops only. `ops_reviewer` drafts, edits and submits; `ops_admin` decides and runs lifecycle actions; the admin who submitted cannot decide. Managers cannot propose assets.
- **Records:** instrument, deployment, execution route, eligibility rule, price reference (plus shared issuers and providers), on the asset chains `solana`, `ethereum`, `base`, `bnb`, `arbitrum`, `polygon`, `bitcoin` (independent of the auth chains; recording a chain does not make it executable).
- **Verification:** ERC-20 metadata on Ethereum, Base, BNB Chain and Arbitrum and Solana mint decimals are read from the chain; native assets and Polygon or Bitcoin deployments are manual and need a source URL. A decimals mismatch or a non-token blocks submit and approval; an unavailable verifier stores nothing.
- **LI.FI badge and fee-on-transfer (ADR-017):** the ops deployment view shows "LI.FI: verified" (the token is on LI.FI's list for its chain) or "LI.FI: unverified" in warning style, and nothing when unknown (native assets, Bitcoin, LI.FI unavailable); it informs the reviewer and blocks nothing. `ops_admin` can flag a deployment as fee-on-transfer; legs touching it warn users that amounts are estimates.
- **Uniqueness:** one live deployment per chain and address across the registry (409 `DEPLOYMENT_EXISTS`); retire the old one to register it again.
- **Lifecycle:** instrument `DRAFT → UNDER_REVIEW → APPROVED` (or `CHANGES_REQUIRED`) `→ ACTIVE ⇄ PAUSED → DEPRECATED → RETIRED`; deployments and routes `DRAFT → APPROVED → ACTIVE ⇄ PAUSED → RETIRED`, with per-item admin approval after launch. Identity fields lock once approved; nothing can be edited while `UNDER_REVIEW` or `RETIRED`; retiring an instrument retires its deployments and routes. Events and audit rows are written for every change; nothing is deleted.
- **Requirements before submit:** a deployment, matching or sourced deployments, a market price reference (crypto and stablecoins), issuer, route and eligibility rule (tokenized assets).
- **Users:** signed-in users read only `ACTIVE` instruments and items with public fields and prices. Rules, review messages, internal notes and observed metadata are never exposed.
- **Prices:** CoinMarketCap market price (stale after 5 min, "unavailable" on failure) and ops-entered NAV, always separate (ADR-002).
- **Sector and tags (ADR-012):** each instrument has one ops-set `sector` (`store_of_value`, `smart_contract_platform`, `layer2`, `defi`, `stablecoin`, `oracle_infra`, `gaming_metaverse`, `ai_data`, `meme`, `rwa_treasury`, `rwa_credit`, `rwa_commodity`, `rwa_equity`, `other`; default `other`) and any number of ops-managed tags (`/ops/tags`, admin: create and retire, never delete). Both are descriptive: audited, editable on a live instrument (not while `UNDER_REVIEW` or `RETIRED`), and used only for discovery filters and basket sector allocation. A retired tag cannot be added; instruments keep it until ops remove it.
- **Price history:** a daily job stores one CoinMarketCap USD price per instrument with an `ACTIVE` market price reference (from the first snapshot, no backfill) for simulated model performance; NAV-only instruments have no snapshots.
- **Not built:** manager proposals, Polygon and Bitcoin on-chain verification, issuer subscription and redemption routes, a KYC vendor, permissioned-token support and NAV or LI.FI price fallbacks (`FUTURE-PLANS.md`).

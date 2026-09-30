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

## Eligibility and routing
Evaluate eligibility in context: user, instrument, provider, route, jurisdiction and action. A direct subscription, secondary-market purchase, transfer, redemption and cross-chain movement may have different requirements. Re-check before execution.

## Lifecycle and reconciliation
Use explicit lifecycle states for assets, deployments and routes. Do not expose disabled, unverified or inactive routes as executable. Track execution and settlement state and reconcile observed holdings.

## Provider boundary
Providers are capability adapters, not universal guarantees. Keep chain/provider-specific behavior out of basket and portfolio semantics. Verify coverage and commercial/legal terms for each asset and route.

## Implemented behavior (Spec 5, ADR-010)
Nothing in the registry executes, signs, broadcasts or moves assets: routes and eligibility rules are records, and every RPC call is read-only.

- **Who:** ops only. `ops_reviewer` drafts, edits and submits; `ops_admin` decides and runs lifecycle actions; the admin who submitted cannot decide. Managers cannot propose assets.
- **Records:** instrument, deployment, execution route, eligibility rule, price reference (plus shared issuers and providers), on the asset chains `solana`, `ethereum`, `base`, `bnb`, `arbitrum`, `polygon`, `bitcoin` (independent of the auth chains; recording a chain does not make it executable).
- **Verification:** ERC-20 metadata on Ethereum, Base, BNB Chain and Arbitrum and Solana mint decimals are read from the chain; native assets and Polygon or Bitcoin deployments are manual and need a source URL. A decimals mismatch or a non-token blocks submit and approval; an unavailable verifier stores nothing.
- **Uniqueness:** one live deployment per chain and address across the registry (409 `DEPLOYMENT_EXISTS`); retire the old one to register it again.
- **Lifecycle:** instrument `DRAFT → UNDER_REVIEW → APPROVED` (or `CHANGES_REQUIRED`) `→ ACTIVE ⇄ PAUSED → DEPRECATED → RETIRED`; deployments and routes `DRAFT → APPROVED → ACTIVE ⇄ PAUSED → RETIRED`, with per-item admin approval after launch. Identity fields lock once approved; nothing can be edited while `UNDER_REVIEW` or `RETIRED`; retiring an instrument retires its deployments and routes. Events and audit rows are written for every change; nothing is deleted.
- **Requirements before submit:** a deployment, matching or sourced deployments, a market price reference (crypto and stablecoins), issuer, route and eligibility rule (tokenized assets).
- **Users:** signed-in users read only `ACTIVE` instruments and items with public fields and prices. Rules, review messages, internal notes and observed metadata are never exposed.
- **Prices:** CoinMarketCap market price (stale after 5 min, "unavailable" on failure) and ops-entered NAV, always separate (ADR-002).
- **Not built:** the eligibility engine, execution and quotes, manager proposals, price history, Polygon and Bitcoin on-chain verification.

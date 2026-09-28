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

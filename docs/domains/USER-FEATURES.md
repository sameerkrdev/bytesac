# User Features — Domain Context

Source: `User-Detailed-Features.txt`

## Discovery
Public basket discovery is available without login. Users can search/filter baskets, research strategy, assets, manager and organization information, and view published performance/history with clear provenance and limitations. AI-powered search is a product feature, not an authority source.

**Implemented (Spec 7, ADR-012):** `/baskets` filters (organization, categories, assets with min and max weight, asset types, sectors, tags, largest single asset, minimum investment, fee ceilings, review frequency, basket age, performance floors, manager experience) and sort live in the URL (`f` param); result cards show 1 y net (or "New"), minimum, management fee, top assets and status. An AI box turns a sentence into those filters (Gemini function calling with one read-only tool), shows them as removable chips with an "Edit these filters" button that opens them all in the filter panel (which has a Keywords field), and the match mode ("Matched by filters", "Closest in meaning", "Keyword match"), falls back to semantic then keyword search, and never shows generated text. Research pages show simulated model performance (net headline, gross secondary, chart with data table, since launch, 30 d, 90 d, 1 y, volatility, max drawdown) always labelled as simulated and before network and swap costs, plus sector allocation and tags. Managers can publish an opt-in profile at `/managers/[handle]` (self-reported claims labelled, "Verified by Bytesac" only while the person has an ACTIVE membership with an approved member verification or is the ACTIVE OWNER of a VERIFIED organization). Not built: investor counts and real returns, price backfill, saved searches, personalized recommendations.

## Wallet and account
Users connect supported chain wallets, authenticate, manage contact verification and notification preferences, and follow the documented wallet/chain-account model. Support wallet migration and independent wallets only through explicit verified flows.

## Investment and ownership
Users can review a basket, eligibility, investment preview, expected acquisition and fees before investing. The intended product principle is that users own underlying assets rather than merely receiving an off-chain representation, subject to the selected custody/execution model and asset-specific issuer terms.

Users can withdraw/cancel according to available routes and product rules; do not imply every RWA is instantly redeemable or transferable.

## Basket updates
Users receive manager version updates and can choose to participate or skip. No silent asset movement. Rebalance preview should show changes, costs and impact. Skips and customizations must be represented distinctly.

## Portfolio
Display states such as aligned, rebalance available, drifted, customized, execution pending and execution failed as supported by the detailed domain state model. Show external activity and discrepancies accurately. Fix requires an explicit, understandable action and authorization.

## Notifications
Support relevant investment, basket, rebalance, portfolio/drift and subscription notifications. Avoid claiming settlement or completion before verified state.

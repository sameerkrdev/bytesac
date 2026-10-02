# User Features — Domain Context

Source: `User-Detailed-Features.txt`

## Discovery
Public basket discovery is available without login. Users can search/filter baskets, research strategy, assets, manager and organization information, and view published performance/history with clear provenance and limitations. AI-powered search is a product feature, not an authority source.

**Implemented (Spec 7, ADR-012):** `/baskets` filters (organization, categories, assets with min and max weight, asset types, sectors, tags, largest single asset, minimum investment, fee ceilings, review frequency, basket age, performance floors, manager experience) and sort live in the URL (`f` param); result cards show 1 y net (or "New"), minimum, management fee, top assets and status. An AI box turns a sentence into those filters (Gemini function calling with one read-only tool), shows them as removable chips with an "Edit these filters" button that opens them all in the filter panel (which has a Keywords field), and the match mode ("Matched by filters", "Closest in meaning", "Keyword match"), falls back to semantic then keyword search, and never shows generated text. Research pages show simulated model performance (net headline, gross secondary, chart with data table, since launch, 30 d, 90 d, 1 y, volatility, max drawdown) always labelled as simulated and before network and swap costs, plus sector allocation and tags. Managers can publish an opt-in profile at `/managers/[handle]` (self-reported claims labelled, "Verified by Bytesac" only while the person has an ACTIVE membership with an approved member verification or is the ACTIVE OWNER of a VERIFIED organization). Not built: investor counts and real returns, price backfill, saved searches, personalized recommendations.

## Wallet and account
Users connect supported chain wallets, authenticate, manage contact verification and notification preferences, and follow the documented wallet/chain-account model. Support wallet migration and independent wallets only through explicit verified flows.

## Investment and ownership
Users can review a basket, eligibility, investment preview, expected acquisition and fees before investing. The intended product principle is that users own underlying assets rather than merely receiving an off-chain representation, subject to the selected custody/execution model and asset-specific issuer terms.

Decided (ADR-013): assets stay in the user's own wallets and every transaction is user-signed. Users can **Leave basket (keep assets)** without any transaction, **Sell to USDC** (all or part, back to USDC on Solana), and later **Sell former basket assets** (up to `min(recorded, on-chain)`); none needs manager approval and there is no lock-in. Do not imply every RWA is instantly redeemable or transferable.

**Implemented (Spec 8, ADR-014):** the basket page shows **Invest** when the basket is investable and the user is eligible (verified email and phone, a linked address per needed chain family, no other open operation); otherwise it names the reason with a link ("Verify your phone", "Link an EVM wallet", "Link a Bitcoin wallet", "Not investable yet"). The wizard asks for the USDC amount and slippage, previews every leg and every fee (network, manager, platform; Spec 10), then walks through each signature (quote, approve in the wallet, submitted, pending, settled), with "Get a new quote" after an expired quote, a Bitcoin confirmation-time note and a result screen (completed, partly completed with the legs that did not run, "Stop here"). **Profile** has a Bitcoin wallet section (BIP-322 through the wallet's PSBT signing, BIP-137 fallback). **/portfolio** lists positions, notices, open operations, history and former positions with Leave, Sell to USDC and Sell former assets.

## Basket updates
Users receive manager version updates and can choose to participate or skip. No silent asset movement. Rebalance preview should show changes, costs and impact. Skips and customizations must be represented distinctly.

**Implemented (Spec 10, ADR-016):** every preview (invest, rebalance, repair, sell) lists each fee: "Network fee (paid to Bytesac for gas)", "Manager fee (to <organization>)" and "Platform fee", a waived fee with its reason ("the manager has no verified payout wallet", "below $0.01", "price unavailable"), the total and "Fees are not refunded if the operation does not complete". The amount entered for an investment includes every fee; fees are paid first in one signed transfer. The basket page shows the manager's terms ("1% up to $50"), the platform rate that applies to the basket and "Disclosed — not collected in this release" for the management fee and subscription; `/fees` lists the default platform rates.

**Implemented (Spec 9, ADR-015):** a holder of an open position sees "New version available" on the portfolio and a notification. **Review update** (`/portfolio/<position>/rebalance`) shows the version change, the manager's reason, the diff and current against target weights; **Create plan** previews sells, the fees and where they are paid from, and buys (sized from what the sells actually return), then the usual signer; **Skip this version** changes nothing in the wallet. When nothing needs trading the version is recorded as "Already aligned". Drifted positions offer **Rebalance to target** or **Keep custom** (and **Revert custom**).

## Portfolio
Display states such as aligned, rebalance available, drifted, customized, execution pending and execution failed as supported by the detailed domain state model. Show external activity and discrepancies accurately. Fix requires an explicit, understandable action and authorization.

**Implemented (Spec 9):** each position shows one headline (operation in progress, needs repair, plan incomplete, new version available, drifted, custom allocation, aligned) with its action: Review update, Rebalance to target, Keep custom, Revert custom, Repair, Continue or View operation. Unspent sale proceeds appear as a "Cash (USDC)" row. **Repair** (`/portfolio/repair/<asset>`) handles a wallet that holds less than the baskets record: Buy back (one plan for the asset) or Sync (record the new reality across the baskets with no transaction).

## Notifications
Support relevant investment, basket, rebalance, portfolio/drift and subscription notifications. Avoid claiming settlement or completion before verified state.

**Implemented (Spec 9):** a header bell and `/notifications` inbox (unread count, mark read, links), email and browser push (Profile, notifications section; asks the browser for permission), gated by the existing preferences. Events: new version, drift, shortfall, incomplete plan, basket paused or resumed, retirement pending or retired, lead manager changed.

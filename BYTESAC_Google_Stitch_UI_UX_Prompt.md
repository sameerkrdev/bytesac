# Google Stitch Prompt --- BYTESAC Web + Mobile UI/UX Reference

You are a senior product designer creating a high-fidelity,
implementation-oriented UI/UX reference for **BYTESAC**, a premium,
dark-first Web3 investment platform for manager-led investment baskets.

Create a coherent **responsive web experience and native mobile app
experience**. Cover the full investor journey and the
fund-manager/organization journey. Produce connected screens, reusable
components, realistic navigation, and important interaction states---not
just a landing page.

## Non-negotiable brand rules

-   **Keep the current BYTESAC logo direction and wordmark.** Use the
    supplied logo reference; do not redesign it.
-   **Do not change the theme colors or typography.**
-   Dark mode is the default and primary mode.
-   Palette: Deep Space `#0B1117`, Slate `#1F2937`, Stone `#6B7280`,
    Sage/Emerald `#10B981`, Mint `#6EE7B7`, Sand `#EEDCC8`, Ivory
    `#FAFAF8`.
-   Typography: **Manrope** for display/headings and **Inter** for
    body/UI/numerals.
-   Use restrained emerald and mint accents. Avoid turning every panel
    green.
-   Brand mood: architectural, precise, premium, calm, modern Web3---not
    a generic crypto exchange.

## Art direction: backgrounds and visual assets

Make the visual design distinctive and polished. Use beautiful,
high-quality background imagery that evokes the BYTESAC identity: - Dark
topographic investment landscapes, layered glass/ceramic forms,
architectural silhouettes, precise emerald light paths, subtle particle
fields, and abstract digital infrastructure. - Use a few striking
full-bleed hero/background images for the marketing landing page and
selected onboarding/empty states. Keep them dark enough for readable
content. - Use 3D objects where they genuinely improve the experience:
abstract layered structures, smoked glass planes, satin-metal objects,
translucent mint elements, and restrained orbital forms. - Prefer
Spline-style interactive 3D for a landing hero or brand scene, with a
static fallback. Use lightweight illustrations or static imagery on
mobile. - Do not use generic coin piles, rockets, random neon grids,
meaningless trading screens, or stock-photo people. - Do not put busy
imagery behind balances, forms, charts, transaction details, or risk
disclosures. Use subtle scrims and clear surface contrast. - Charts and
allocation comparisons must remain flat 2D for accuracy; never use 3D
charts. - Keep motion slow and intentional. Respect reduced-motion
settings.

## Product context and truthfulness

BYTESAC is a manager-led investment-basket platform. The initial
settlement currency is **USDC on Solana**, with a planned path to
additional currencies. The product is multi-chain in its architecture.

Investor authentication is wallet-centric: - User connects a wallet,
selects a supported chain/account, signs an authentication message, and
the backend verifies it. - Wallet connection alone is not
authentication. - One normal user has one logical active investment
wallet, which can contain multiple chain-specific addresses. - Email and
phone are optional contact details.

Fund-manager onboarding: - A person submits a "Become a Fund Manager"
application. - The platform team contacts and verifies the applicant. -
After basic verification, the team requests a wallet address. - If
needed, a user is created for that address and granted permission to
create an organization. - The manager signs in and creates an
organization; the platform reviews and approves it. - An authorized
member can then create a basket draft.

Basket lifecycle: - A new basket is private and starts as `DRAFT`. -
Manager configures identity, thesis, assets, target weights,
constraints, rebalance policy, managers, fees/minimums, risks, and
disclosures. - Basket is submitted for platform review. Review can
approve, request changes, reject, or escalate. - Only approved versions
can be published. Published versions are immutable; edits create a new
version with a visible diff. - Publishing a new strategy version must
not silently trade investor holdings. - Investors review a proposed
rebalance and explicitly apply or skip it; execution requires their
authorization. - Show target allocation, actual holdings, and drift as
distinct concepts. - Do not invent performance, APY, risk ratings, fees,
supported features, or transaction success.

## Required WEB screens

### Public / discovery

1.  **Marketing landing page**
    -   Premium hero with BYTESAC wordmark, short value proposition,
        primary "Explore baskets" CTA and secondary "Become a fund
        manager" CTA.
    -   Strong atmospheric background using dark topography/abstract
        glass 3D, with readable content.
    -   Sections for how it works, investor control, manager
        verification, transparency, supported assets/chains (only where
        configured), FAQ, and footer with legal/disclosure links.
2.  **Explore baskets**
    -   Search, filters, sorting, category chips, and basket cards.
    -   Cards include manager/organization, short thesis, allocation
        preview, fee/minimum where configured, status, version/update
        context, and clear disclosures.
    -   Include loading, no-results, and error states.
3.  **Basket detail**
    -   Overview/thesis, manager and organization profile, allocation,
        asset list, rebalance methodology, fees/minimums, minimum
        investment, risk disclosures, history/version timeline, and
        on-chain/verification links when available.
    -   Clear "Invest" CTA only when the basket is publicly investable.
4.  **Become a fund manager**
    -   Application form with clear sections, validation, save/submit
        states, privacy notice, and what happens next.
    -   Do not imply instant approval.

### Investor authenticated app

5.  **Connect wallet / authentication**
    -   Wallet selection, chain/account selection, signature
        explanation, signing/pending/error/success states.
    -   Separate connection from authentication.
6.  **Investor home/dashboard**
    -   Portfolio snapshot, basket positions, recent activity, pending
        rebalance proposals, and relevant actions.
    -   Use sample data only if marked illustrative.
7.  **Portfolio**
    -   Total value, asset/chain breakdown, basket positions, holdings,
        allocation and drift.
    -   Show data timestamp and stale/loading/error states.
8.  **Invest in basket flow**
    -   Select basket, enter amount, show settlement currency (initially
        USDC on Solana), fees and estimates when configured, review,
        wallet authorization, pending, confirmed/failed/partial states.
    -   Make clear what is and is not guaranteed; no fabricated quote.
9.  **Rebalance proposal**
    -   Compare current holdings/weights against proposed weights.
    -   Show changed assets, estimated amounts/fees when available,
        reason/version context, and Apply / Skip actions.
    -   Explicit consent before wallet authorization. Include
        partial/failure states.
10. **Activity / transaction history**
    -   Deposits/investments, rebalance actions, wallet events, status
        filters, timestamps, chain, transaction hash/explorer link where
        available.
11. **Profile and settings**
    -   Wallet and linked chain addresses, optional email/phone
        verification, notification preferences, session/logout,
        security/account information.
12. **Notifications / inbox**
    -   Rebalance proposals, portfolio updates, manager/basket updates,
        transaction states, and security notifications; separate
        marketing preferences.
13. **Help, risk and legal information**
    -   Risk disclosures, support, FAQs, privacy and terms entry points.
        Keep legal copy as clearly marked placeholder if not supplied.

## Required MANAGER / ORGANIZATION WEB screens

14. **Manager workspace overview**
    -   Organization context, review status, basket summary,
        tasks/alerts, analytics preview.
15. **Organization creation**
    -   Multi-step form for organization details, authorized
        representatives, required documents, review/submit status, and
        save/resume.
    -   Clearly show that submission is not approval.
16. **Organization profile and team/access**
    -   Organization details, verification state, team members,
        roles/permissions, invitation and removal confirmation.
17. **Basket list**
    -   Tabs/filters for Drafts, Under review, Changes required,
        Published/active, Paused, Retired.
    -   Rows/cards show name, status, current version, last updated, and
        allowed actions.
18. **Basket creation/edit wizard**
    -   Stepper and autosave indicator. Include:
        -   Identity and description
        -   Objective and investment thesis
        -   Assets selected only from the platform registry
        -   Target allocations and optional min/max constraints
        -   Rebalance methodology/settings
        -   Assigned managers
        -   Fees and minimum investment
        -   Risks and mandatory disclosures
        -   Validation summary and public preview
    -   Show allocation total live. Do not silently normalize invalid
        values.
    -   Draft is private; distinguish draft from published data.
19. **Basket review and submission**
    -   Immutable submission snapshot, validation checklist, preview,
        confirmation and submission state.
20. **Review feedback / version history**
    -   Manager-visible review status, field/section-anchored feedback,
        severity, resolution and resubmission.
    -   Show public version history and before/after diff. Keep internal
        reviewer notes hidden.
21. **Manager analytics**
    -   Investors, AUM/value with methodology and timestamp, basket
        performance, historical allocation, rebalance participation,
        subscriptions, fee categories, execution outcome counts.
    -   Clearly distinguish deposits from current value and gross fees
        from net revenue. No private investor identities/balances unless
        authorized.

## Required MOBILE screens

Design a complete mobile app, not just scaled-down web pages: 1. Welcome
/ connect wallet 2. Wallet selection, chain/account selection, signature
and authentication states 3. Home dashboard 4. Explore and search
baskets 5. Basket detail 6. Invest amount and review 7. Wallet
authorization / transaction progress / result 8. Portfolio overview and
holdings 9. Rebalance proposal comparison with Apply / Skip 10. Activity
and transaction detail 11. Notifications 12. Profile, linked chains,
contact verification and preferences 13. Become a fund manager
application 14. Manager workspace overview 15. Organization creation and
review status 16. Basket list and basket wizard steps 17. Basket
preview, submit and review feedback

Mobile requirements: - Use bottom navigation for primary investor
destinations (Home, Explore, Portfolio, Activity, Profile). - Manager
tools can use a workspace switcher and secondary navigation. - Make
important actions reachable, touch targets at least 44×44 px, and forms
comfortable to complete. - Use bottom sheets for contextual actions
where appropriate. - Keep transaction, fee, chain, and risk information
readable without horizontal scrolling.

## Reusable components to design

-   Web app shell, top navigation, mobile bottom nav, manager workspace
    switcher
-   Buttons (primary, secondary, ghost, destructive), icon buttons,
    inputs, select, segmented control, checkbox, tabs, tooltip, modal,
    drawer, toast
-   Wallet connect button, wallet/chain badge, shortened address + copy,
    transaction status
-   Basket card, allocation bar/donut, asset row, fee/minimum summary,
    risk disclosure panel
-   Portfolio summary, holding row, drift indicator, rebalance
    comparison, activity timeline
-   Manager/organization identity card, verification badge, team member
    row, review feedback panel
-   Wizard stepper, autosave state, validation summary, public preview
-   Skeleton, empty state, error state, stale-data banner, confirmation
    sheet

## Interaction and state requirements

For each important flow, show the key states: - Default, hover/focus,
selected, disabled, loading, empty, validation error, success, pending,
failed, and partial where applicable. - Confirm before destructive or
high-impact actions. - Keep user input when a recoverable error
occurs. - Make review feedback actionable and anchored to the relevant
field/section. - Use clear progress and back navigation in multi-step
flows. - Do not claim an on-chain action is complete until confirmed.

## Layout and typography

-   Use a refined dark-first layout with strong typographic hierarchy
    and ample whitespace.
-   Manrope for headings and display; Inter for body, UI and financial
    numbers.
-   Desktop: spacious 12-column grid, consistent max content width, calm
    side panels.
-   Mobile: single-column reading order, compact but comfortable cards,
    persistent primary navigation.
-   Use tabular numerals for balances, prices, percentages and
    timestamps.
-   Use consistent radii, subtle borders, restrained shadows, and
    high-contrast focus rings.

## Output expectations

-   Generate a cohesive set of connected web and mobile screens using
    one design system.
-   Prioritize polished real-world visual quality, clear information
    hierarchy, and believable product behavior.
-   Include desktop and mobile responsive references for core screens.
-   Keep the generated work implementation-friendly: name components,
    show variants, maintain spacing consistency, and avoid one-off
    styling.
-   Use placeholder legal text and illustrative sample data only when
    clearly labeled.
-   Do not omit required pages; if the tool cannot generate every screen
    at once, organize the output into clearly named screen groups and
    preserve the same design system across them.

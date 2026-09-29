# BYTESAC Design System

**Version:** 1.0 · **Status:** Working design specification · **Theme:**
Dark-first

This document is the visual source of truth for BYTESAC interfaces. Use
it when generating or implementing web and mobile UI with AI. Preserve
the existing logo direction, color palette, and typography. Do not
invent a new brand palette or substitute fonts.

> **Asset note:** The supplied logo is a visual reference. For
> production, use approved transparent PNGs or, preferably, clean SVG
> exports. Do not redraw, distort, recolor, or add effects to the logo
> without approval.

------------------------------------------------------------------------

## 1. Brand foundation

-   **Brand:** BYTESAC
-   **Product:** Manager-led, multi-chain investment baskets.
-   **Visual character:** modern Web3, composed, premium, precise,
    transparent, calm.
-   **Design principle:** fintech clarity first; Web3 atmosphere second.
-   **Dark mode:** default and primary experience. Light surfaces may
    appear only where specified for contrast or document-like content;
    do not make light mode the default.
-   **Core product values:** investor control, legibility, auditability,
    transparent strategy history.

Avoid generic exchange visuals: coin piles, random neon grids, excessive
glows, noisy gradients, and decorative candlestick charts with no
product meaning.

## 2. Color tokens

Use these exact values as the initial brand tokens. The palette follows
the latest BYTESAC logo direction.

  -----------------------------------------------------------------------
  Token                   Hex                     Intended use
  ----------------------- ----------------------- -----------------------
  `space`                 `#0B1117`               Main dark canvas and
                                                  app background

  `slate`                 `#1F2937`               Elevated dark surfaces,
                                                  panels, navigation

  `stone`                 `#6B7280`               Secondary text, subdued
                                                  icons, disabled content

  `sage`                  `#10B981`               Primary brand/action
                                                  accent; use sparingly

  `mint`                  `#6EE7B7`               Positive emphasis,
                                                  subtle highlights,
                                                  selected states

  `sand`                  `#EEDCC8`               Warm accent for
                                                  editorial/brand
                                                  moments, not status
                                                  meaning

  `ivory`                 `#FAFAF8`               High-contrast text and
                                                  rare light surfaces
  -----------------------------------------------------------------------

### Semantic colors

These are functional status colors, not replacements for the brand
palette. Keep their use restrained and pair color with text/icon labels.

  Token           Hex                Use
  --------------- ------------------ -----------------------------
  `success`       `#22C55E`          Confirmed success
  `warning`       `#F59E0B`          Caution, pending attention
  `danger`        `#F87171`          Errors, destructive actions
  `info`          `#60A5FA`          Informational notices
  `border-dark`   `#26323D`          Dark surface borders
  `overlay`       `#05090D` at 72%   Modal/backdrop overlay

### Color usage rules

-   Keep 70--85% of most screens in dark neutrals; reserve emerald/mint
    for focus and action.
-   Use `ivory` for primary text on dark surfaces and `stone` for
    secondary text. Check contrast before using muted text for essential
    data.
-   Use `sage` for the primary CTA, active navigation, key selection,
    and positive trend accents. Do not make every card green.
-   `mint` can highlight selected data or a subtle glow. Avoid large
    bright mint panels.
-   `sand` is a brand/editorial accent only; do not use it to imply
    profit, loss, warning, or safety.
-   Never rely on color alone for risk, execution, review, or
    transaction status.
-   Charts should use a consistent series mapping and labels; do not use
    green to imply guaranteed gains.

## 3. Typography

**Primary display and headings:** Manrope\
**Body, UI, data and numerals:** Inter

Use the fonts as named. If unavailable, load them from a licensed/local
font package; do not silently substitute a different design font.

  --------------------------------------------------------------------------
  Role          Font                     Weight Size / line   Notes
                                                height        
  ------------- ------------- ----------------- ------------- --------------
  Display       Manrope                     700 48/56 px      Landing hero
                                                desktop;      only
                                                36/44 mobile  

  H1            Manrope                     700 36/44 px      One per page
                                                desktop;      
                                                30/38 mobile  

  H2            Manrope                650--700 28/36 px      Main sections

  H3            Manrope                     600 22/30 px      Cards and
                                                              subsections

  H4            Manrope                     600 18/26 px      Compact
                                                              headings

  Body large    Inter                       400 16/26 px      Introductory
                                                              copy

  Body          Inter                       400 14/22 px      Default UI
                                                              copy

  Label         Inter                       500 12/18 px      Field labels,
                                                              metadata

  Button        Inter                       600 14/20 px      Button labels

  Data          Inter                  500--600 13--16 px     Tabular
                                                              numerals

  Micro         Inter                  400--500 11/16 px      Non-critical
                                                              metadata only
  --------------------------------------------------------------------------

Use `font-variant-numeric: tabular-nums` for balances, percentages,
prices, timestamps, and table columns. Use sentence case for headings
and buttons. Avoid all-caps except compact eyebrow labels; increase
letter spacing only for those labels.

## 4. Layout and spacing

-   **Base spacing unit:** 4 px.
-   **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px.
-   **Desktop content width:** 1200--1440 px; keep readable text columns
    narrower.
-   **Mobile gutters:** 16--20 px.
-   **Tablet gutters:** 24--32 px.
-   **Desktop gutters:** 32--48 px.
-   **Grid:** 12 columns desktop, 8 tablet, 4 mobile.
-   **Page structure:** persistent navigation + clear page title + main
    content + optional contextual rail.
-   Prefer generous spacing and deliberate hierarchy over dense
    dashboard clutter.
-   Use responsive tables with a mobile card/list alternative; do not
    force wide financial tables onto small screens.

## 5. Shape, borders, elevation

  Element                              Radius
  ------------------------------- -----------
  Small controls / badges                8 px
  Inputs / buttons                  10--12 px
  Cards / panels                        16 px
  Large feature panels / modals     20--24 px
  Pills                                999 px

-   Borders: 1 px solid `#26323D` on dark surfaces.
-   Use elevation primarily through subtle surface contrast, not heavy
    shadows.
-   Card shadow (web): `0 12px 32px rgba(0,0,0,.20)`.
-   Focus ring: 2 px `#6EE7B7`, with a 2 px offset where supported.
-   Avoid excessive glassmorphism. If used, preserve text contrast and
    avoid making every surface translucent.

## 6. Component standards

### Buttons

-   **Primary:** `sage` fill, `space` or near-black label, clear
    hover/pressed/disabled states.
-   **Secondary:** `slate` surface with `border-dark` border and `ivory`
    label.
-   **Tertiary/ghost:** transparent with a visible hover surface.
-   **Destructive:** danger treatment and confirmation for irreversible
    actions.
-   Minimum interactive target: 44×44 px on mobile.
-   Loading states must preserve button width and clearly indicate
    progress.

### Inputs and forms

-   Dark input surface, visible border, `ivory` entered text, `stone`
    placeholder.
-   Labels remain visible; do not rely on placeholder-only labels.
-   Include focus, error, success, disabled, and helper-text states.
-   Show field-level errors and preserve entered values after
    recoverable errors.
-   Wallet connection is not authentication: present signature
    confirmation distinctly from connection.
-   Never display seed phrases or private keys.

### Cards

-   Use a consistent surface hierarchy: page `space`, card `slate` or a
    slightly lifted dark surface.
-   Basket cards should show name, status, manager/organization, concise
    thesis, allocation preview, fees/minimums when available, and
    version/update context.
-   Do not fabricate APY, performance, ratings, risk scores, AUM, or
    transaction state.

### Financial data

-   Always label currency and chain where relevant.
-   Separate target allocation, current holdings, drift, and proposed
    allocation.
-   Include timestamps and data freshness for balances/performance.
-   Show empty, loading, stale, partial, and error states.
-   Avoid misleading precision; format values consistently and make
    rounding explicit where material.
-   Historical performance must not be styled as a promise.

### Status badges

Use text plus icon or shape. Suggested statuses include Draft, Under
review, Changes required, Published, Paused, Retired, Pending,
Confirmed, Failed, and Needs attention. Keep status semantics consistent
across investor and manager surfaces.

### Navigation

-   Web investor navigation: Home, Explore, Portfolio, Activity,
    Profile.
-   Manager workspace: Overview, Baskets, Analytics, Organization,
    Team/Access, Activity.
-   Mobile: compact bottom navigation for primary investor destinations;
    use a drawer or workspace switcher for secondary destinations.
-   Clearly indicate the active route and preserve navigation context in
    multi-step flows.

### Modals and transaction confirmation

-   Summarize asset, chain, amount, estimated fees,
    destination/recipient, and the action being authorized.
-   Explain what the wallet will ask the user to sign.
-   Distinguish platform confirmation from on-chain confirmation.
-   Show pending, confirmed, failed, and partial outcomes with a
    transaction explorer link when available.
-   Do not imply that a transaction succeeded before verified
    confirmation.

### Charts and allocation visuals

-   Prefer clean donut/stacked-bar allocation views and restrained
    time-series charts.
-   Always include legends, units, date range, and accessible text
    equivalents.
-   Avoid 3D charts: perspective distorts financial comparisons.
-   Use animation only to explain a change, never to obscure exact
    values.

## 7. 3D, motion and visual atmosphere

Use 3D as a supporting brand layer, not as the primary way to
communicate financial information.

### Preferred providers and approaches

1.  **Spline** --- rapid authoring of interactive 3D scenes; useful for
    a landing hero, abstract asset structures, or subtle ambient
    objects. Use optimized embeds and provide a static fallback.
2.  **Three.js / React Three Fiber** --- custom 3D when precise control,
    reusable components, or integration with application state is
    needed.
3.  **`<model-viewer>`** --- suitable for displaying individual GLB/glTF
    objects with a relatively simple integration.
4.  **Sketchfab** --- source individual models only after checking
    license, attribution, optimization, and commercial-use terms.
5.  **Rive / Lottie** --- use for lightweight motion and state feedback
    where true 3D is unnecessary.

### BYTESAC 3D art direction

-   Motifs: layered architectural forms, abstract asset blocks, floating
    glass planes, topographic investment landscapes, restrained orbital
    paths, and subtle light refractions.
-   Materials: smoked glass, satin metal, dark ceramic, translucent mint
    glass.
-   Lighting: low-key deep navy environment with a restrained
    emerald/mint key light; warm sand light only as a small editorial
    accent.
-   Camera: slow, stable, deliberate; no aggressive spins or parallax
    that harms reading.
-   Use 3D objects in hero/marketing, onboarding illustration, and empty
    states. Keep portfolio tables, forms, allocation editing, and
    transaction review flat and highly legible.
-   Never use 3D coins, generic rockets, piles of tokens, or decorative
    trading screens.
-   Do not encode investment performance or risk using decorative 3D
    shapes.

### Performance and accessibility

-   Lazy-load scenes below the fold.
-   Provide a static image fallback and respect reduced-motion
    preferences.
-   Pause or reduce animation when off-screen, on low-power devices, or
    when the user requests reduced motion.
-   Keep mobile scenes lightweight; prefer static render on constrained
    devices.
-   Ensure 3D never blocks navigation, wallet connection, keyboard use,
    or critical content.
-   Confirm licenses and usage rights before shipping third-party
    assets.

## 8. Imagery and backgrounds

-   Use cinematic, abstract backgrounds that evoke digital
    infrastructure and long-term investing: dark topographic terrain,
    layered glass structures, precise light paths, architectural
    silhouettes, and subtle data-like particles.
-   Match the logo's deep-space, emerald/mint, and restrained warm-light
    mood.
-   Place imagery behind spacious content zones. Add a dark scrim or
    gradient for legibility.
-   Avoid generic stock photos, crypto clichés, visual noise, and
    backgrounds that compete with balances or CTAs.
-   Use image assets consistently by category (hero, card thumbnail,
    manager avatar, asset icon); do not mix unrelated visual styles.

## 9. Motion

-   Default transitions: 150--220 ms for controls; 240--400 ms for
    panels and page-level transitions.
-   Use ease-out for entering and ease-in for exiting.
-   Animate state changes only when the transition helps explain what
    changed.
-   Respect `prefers-reduced-motion` on web and reduced-motion settings
    on mobile.
-   No perpetual high-contrast movement behind financial information.

## 10. Accessibility and responsive behavior

-   Meet WCAG AA contrast for essential text and controls.
-   All controls need visible focus and accessible names.
-   Never communicate meaning by color alone.
-   Support keyboard navigation, screen readers, text scaling, and
    reduced motion.
-   At mobile widths, stack content in reading order and keep the
    primary action reachable.
-   Do not hide critical risk, fee, chain, or transaction details behind
    hover-only interactions.

------------------------------------------------------------------------

## 11. Web implementation tokens --- Tailwind CSS

The following is a Tailwind CSS v4-style CSS-first setup. Keep the same
token names in components. If the repository uses Tailwind v3, map the
same values into `tailwind.config.ts` rather than mixing configuration
generations.

``` css
/* app/globals.css — Tailwind CSS v4 */
@import "tailwindcss";

@theme {
  --color-space: #0B1117;
  --color-slate: #1F2937;
  --color-stone: #6B7280;
  --color-sage: #10B981;
  --color-mint: #6EE7B7;
  --color-sand: #EEDCC8;
  --color-ivory: #FAFAF8;

  --font-display: "Manrope", sans-serif;
  --font-sans: "Inter", sans-serif;

  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.25rem;
  --radius-2xl: 1.5rem;
}

:root {
  color-scheme: dark;
  --background: #0B1117;
  --foreground: #FAFAF8;
  --card: #111B24;
  --card-foreground: #FAFAF8;
  --popover: #111B24;
  --popover-foreground: #FAFAF8;
  --primary: #10B981;
  --primary-foreground: #0B1117;
  --secondary: #1F2937;
  --secondary-foreground: #FAFAF8;
  --muted: #1F2937;
  --muted-foreground: #A1AAB5;
  --accent: #6EE7B7;
  --accent-foreground: #0B1117;
  --destructive: #F87171;
  --destructive-foreground: #0B1117;
  --border: #26323D;
  --input: #26323D;
  --ring: #6EE7B7;
  --chart-1: #10B981;
  --chart-2: #6EE7B7;
  --chart-3: #60A5FA;
  --chart-4: #EEDCC8;
  --chart-5: #6B7280;
  --radius: 0.75rem;
}

html {
  font-family: var(--font-sans);
  background: var(--background);
  color: var(--foreground);
  font-variant-numeric: tabular-nums;
}

body {
  min-height: 100vh;
  background: var(--background);
  color: var(--foreground);
}

.font-display { font-family: var(--font-display); }
```

### Tailwind usage examples

``` tsx
<main className="min-h-screen bg-space text-ivory font-sans">
  <section className="rounded-2xl border border-[#26323D] bg-slate p-6">
    <h1 className="font-display text-3xl font-bold">Your portfolio</h1>
    <button className="rounded-xl bg-sage px-4 py-3 font-semibold text-space">
      Explore baskets
    </button>
  </section>
</main>
```

------------------------------------------------------------------------

## 12. shadcn/ui theme CSS

Use this with shadcn/ui when its components are built on Tailwind. This
block is the shadcn semantic token layer; keep it aligned with the
Tailwind tokens above.

``` css
/* app/globals.css — shadcn/ui tokens */
@import "tailwindcss";

:root {
  color-scheme: dark;
  --background: 204 36% 7%;
  --foreground: 60 20% 98%;
  --card: 204 35% 10%;
  --card-foreground: 60 20% 98%;
  --popover: 204 35% 10%;
  --popover-foreground: 60 20% 98%;
  --primary: 158 84% 39%;
  --primary-foreground: 204 36% 7%;
  --secondary: 215 28% 16%;
  --secondary-foreground: 60 20% 98%;
  --muted: 215 28% 16%;
  --muted-foreground: 215 14% 68%;
  --accent: 156 72% 67%;
  --accent-foreground: 204 36% 7%;
  --destructive: 0 91% 71%;
  --destructive-foreground: 204 36% 7%;
  --border: 210 20% 20%;
  --input: 210 20% 20%;
  --ring: 156 72% 67%;
  --chart-1: 158 84% 39%;
  --chart-2: 156 72% 67%;
  --chart-3: 213 94% 68%;
  --chart-4: 32 57% 83%;
  --chart-5: 215 10% 46%;
  --radius: 0.75rem;
}

.dark {
  color-scheme: dark;
  --background: 204 36% 7%;
  --foreground: 60 20% 98%;
  --card: 204 35% 10%;
  --card-foreground: 60 20% 98%;
  --popover: 204 35% 10%;
  --popover-foreground: 60 20% 98%;
  --primary: 158 84% 39%;
  --primary-foreground: 204 36% 7%;
  --secondary: 215 28% 16%;
  --secondary-foreground: 60 20% 98%;
  --muted: 215 28% 16%;
  --muted-foreground: 215 14% 68%;
  --accent: 156 72% 67%;
  --accent-foreground: 204 36% 7%;
  --destructive: 0 91% 71%;
  --destructive-foreground: 204 36% 7%;
  --border: 210 20% 20%;
  --input: 210 20% 20%;
  --ring: 156 72% 67%;
}

@theme inline {
  --color-background: hsl(var(--background));
  --color-foreground: hsl(var(--foreground));
  --color-card: hsl(var(--card));
  --color-card-foreground: hsl(var(--card-foreground));
  --color-popover: hsl(var(--popover));
  --color-popover-foreground: hsl(var(--popover-foreground));
  --color-primary: hsl(var(--primary));
  --color-primary-foreground: hsl(var(--primary-foreground));
  --color-secondary: hsl(var(--secondary));
  --color-secondary-foreground: hsl(var(--secondary-foreground));
  --color-muted: hsl(var(--muted));
  --color-muted-foreground: hsl(var(--muted-foreground));
  --color-accent: hsl(var(--accent));
  --color-accent-foreground: hsl(var(--accent-foreground));
  --color-destructive: hsl(var(--destructive));
  --color-destructive-foreground: hsl(var(--destructive-foreground));
  --color-border: hsl(var(--border));
  --color-input: hsl(var(--input));
  --color-ring: hsl(var(--ring));
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
}
```

**Important:** If your project already has a shadcn `globals.css`, merge
the token values rather than adding a second `@import "tailwindcss"` or
replacing unrelated utilities.

------------------------------------------------------------------------

## 13. NativeWind (React Native) theme

NativeWind uses Tailwind-style utility classes in React Native, but web
CSS variables and DOM styles do not transfer directly. Keep the same
palette and typography through the NativeWind/Tailwind configuration and
use native font assets.

``` css
/* global.css — NativeWind v4 */
@import "tailwindcss";
@import "nativewind/theme";

@theme {
  --color-space: #0B1117;
  --color-slate: #1F2937;
  --color-stone: #6B7280;
  --color-sage: #10B981;
  --color-mint: #6EE7B7;
  --color-sand: #EEDCC8;
  --color-ivory: #FAFAF8;

  --font-display: "Manrope";
  --font-sans: "Inter";

  --radius-sm: 0.5rem;
  --radius-md: 0.75rem;
  --radius-lg: 1rem;
  --radius-xl: 1.25rem;
  --radius-2xl: 1.5rem;
}
```

Example:

``` tsx
import "../global.css";
import { Text, View, Pressable } from "react-native";

export function PortfolioCard() {
  return (
    <View className="rounded-2xl border border-[#26323D] bg-slate p-5">
      <Text className="font-display text-2xl font-bold text-ivory">
        Your portfolio
      </Text>
      <Pressable className="mt-4 min-h-11 items-center justify-center rounded-xl bg-sage px-4">
        <Text className="font-sans font-semibold text-space">Explore baskets</Text>
      </Pressable>
    </View>
  );
}
```

For React Native, bundle Manrope and Inter font files and register them
through the app's font-loading mechanism. Verify the exact font family
names exposed by the platform before using `font-*` utilities.

------------------------------------------------------------------------

## 14. AI component-generation rules

When asking an AI coding agent to build a component:

1.  Read this design system and the relevant product-flow/feature
    document first.
2.  Reuse existing project components, tokens, icons, and patterns
    before creating new ones.
3.  Keep dark mode as the default and preserve the exact colors and
    fonts in this document.
4.  Build responsive, accessible states---not just the happy path.
5.  Use realistic but clearly illustrative placeholder data only when
    real data contracts are unavailable. Never invent live performance
    or transaction facts.
6.  Keep 3D decorative and optional; provide a static fallback. Never
    use 3D for charts or critical controls.
7.  Use a consistent icon family and avoid emoji as interface icons.
8.  Keep business rules and authorization on the backend; UI visibility
    is not authorization.
9.  Preserve investor consent: strategy publication must not silently
    execute a rebalance.
10. Clearly distinguish draft, reviewed, published, proposed, and
    executed states.
11. Include loading, empty, error, stale-data, success, and disabled
    states.
12. Do not add a light theme, new accent color, new font, or alternate
    logo without explicit approval.

### Suggested component inventory

-   App shell, responsive navigation, page header, breadcrumbs,
    command/search, wallet status
-   Buttons, icon buttons, inputs, selects, segmented controls,
    checkboxes, dialogs, drawers, tooltips, toasts
-   Asset icon/identity, chain badge, wallet address display, copy
    control, transaction status
-   Basket card, allocation bar, allocation donut, asset row,
    fee/minimum summary, risk disclosure panel
-   Portfolio summary, holding row, drift indicator, rebalance proposal
    card, activity timeline
-   Manager/organization identity card, verification status, review
    feedback panel
-   Wizard stepper, autosave indicator, validation summary, public
    preview
-   Skeletons, empty states, error boundaries, confirmation sheets

------------------------------------------------------------------------

## 15. Product-specific UX guardrails

-   Wallet connection and wallet-signature authentication are separate
    visible steps.
-   A normal user has one logical active investment wallet with
    chain-specific addresses; do not present each chain address as a
    separate platform user.
-   Email and phone are optional contact information, not the primary
    identity.
-   Manager verification, organization onboarding, and manager
    permissions are separate from normal user authentication.
-   A new basket starts as a private `DRAFT`; it is not publicly
    investable.
-   Only approved versions may be published. Published versions are
    immutable; changes create a new version and a visible diff.
-   Show proposed rebalance changes clearly. Investors choose whether to
    apply or skip; execution requires user authorization.
-   Distinguish target allocations from actual holdings and observed
    drift.
-   The initial settlement currency is USDC on Solana, while the UI
    should not hard-code the product as permanently single-currency.
-   Asset eligibility and RWA restrictions must be represented from
    authoritative product data, not guessed by the UI.

------------------------------------------------------------------------

## 16. Definition of done for generated UI

A generated screen/component is acceptable when: - It follows the
palette, typography, spacing, and surface rules above. - It works at
mobile, tablet, and desktop breakpoints where applicable. - All
interactive controls have real behavior or are clearly marked as a
non-functional reference. - Keyboard/focus, accessible labels, reduced
motion, and contrast are addressed. - Financial figures have units,
timestamps, and appropriate caveats. - Loading, empty, error, and
success states are included. - Any 3D/imagery is optimized, licensed,
non-blocking, and has a fallback. - No unapproved brand changes or
invented product capabilities are introduced.

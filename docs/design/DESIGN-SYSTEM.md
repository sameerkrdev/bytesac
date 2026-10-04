# Bytesac web design system

Spec 17 (web first). Source of values: `packages/design-tokens/src/index.ts` (`themes`, `radius`, `shadow`, `motion`,
`fontFamily`), mirrored by `apps/web/app/globals.css` and checked by `apps/web/test/tokens.test.ts`. The legacy dark
palette (`palette`, `semantic`, `surfaces`, `radii`, `fonts`) stays exported for `apps/mobile` until its redesign.

## Character

Calm, editorial, institutional. Bytesac should feel like researching an investment product, not operating a trading
terminal. Authority comes from scale, whitespace and clear language — not from weight, colour or effects.

- **Atmosphere as bookends only.** Sky (light) or high-altitude dusk (dark) appears on heroes, sign-in and closing
  sections. Everything between is quiet canvas and white surfaces.
- **One focal object per section.** A headline, a device, a glass object or one piece of real UI — never all at once.
- **Real UI is code.** Generated imagery is atmosphere and objects only; phone screens stay blank until the Expo
  screens exist (brief phase 15).
- **Product truth first.** Copy never claims Bytesac cannot touch a transaction (it co-signs Solana legs as fee payer
  and sends EVM gas drops, ADR-013), never shows invented stats, and labels simulated performance every time.

## Colour roles

Components use roles, never hex. Light and dark define the same roles; `data-theme="dark"` may also be set on a
single element to create a dark island (used by the self-custody section).

| Role | Light | Dark | Use |
|---|---|---|---|
| `canvas` | `#F6F8FB` | `#070D18` | Page background |
| `surface` / `surface-muted` / `surface-sunken` | `#FFFFFF` / `#F0F3F8` / `#E9EEF5` | `#0E1726` / `#131E31` / `#0A111E` | Cards, inset tiles, tracks |
| `line` / `line-strong` | `#E2E7EF` / `#CBD3DF` | `#1E2A3F` / `#2C3A52` | Hairlines, field borders |
| `ink` / `ink-muted` / `ink-faint` | `#0F1E3A` / `#56627A` / `#68728A` | `#EAF0F8` / `#9AA7BC` / `#8390A6` | Text hierarchy |
| `primary` / `primary-hover` / `primary-ink` | `#1C2B4A` / `#2E4470` / `#FFF` | `#EAF0F8` / `#FFF` / `#0B1424` | The one primary action (navy in light, ivory in dark) |
| `accent` / `accent-soft` | `#3D63D9` / `#E8EEFC` | `#8AA6FF` / 14% | Sparingly: new-version cues, chart net line, focus |
| `sky1–3` | pale blues | night blues | Atmosphere gradients |
| `glass` / `glass-line` | white 62% / white 78% | navy 58% / white 9% | Floating chips, sticky bars over atmosphere |
| `success`, `warning`, `danger`, `info` (+ `-soft`) | pastel pills | 14% tints | Status only; the label carries the meaning |
| `data1–6` | navy → pale blue | ivory → deep blue | Charts and allocation rings, largest slice first |

## Type

Geist (300/400/500/600) for everything; Geist Mono for small labels and figures in tables. Tabular numbers everywhere.

| Utility | Size | Weight / tracking | Use |
|---|---|---|---|
| `type-hero` | clamp(44px → 96px) | 300 / −0.04em | Landing hero only |
| `type-display` | clamp(36px → 68px) | 300 / −0.035em | Section and page heroes |
| `type-title` | clamp(28px → 42px) | 300 / −0.028em | Page titles |
| `type-heading` | clamp(20px → 24px) | 400 / −0.018em | Section headings |
| `type-lede` | 17–20px | 400 | Introductions |
| `type-eyebrow` | 11px mono uppercase | 500 / +0.12em | Labels above headings and figures |
| `type-figure` | — | 300, tabular | Money and percentages; `Figure` mutes the decimals |

## Shape, depth, spacing

- Radius: shell 28, card 20, tile 14, control 12, pill. Nested radii step down; never cards in cards in cards.
- Depth: hairlines first; `shadow-soft` for resting, `shadow-float` for overlays and floating chips, `shadow-device`
  for devices. Dark theme relies on lines, not shadows.
- Section rhythm: 112–176px between marketing sections; 40–56px between app sections. Content width 1280px.
- Touch targets ≥ 44px (`Button` default and `icon` sizes); `sm` buttons are for dense desktop tables only.

## Components (apps/web/components)

| Area | Components |
|---|---|
| `ui/` | `Button` (default, secondary, outline, glass, ghost, destructive, link), `Card`, `Dialog` (centred panel on desktop, bottom sheet on phones), `Input`/`Select`/`Textarea` (shared `fieldClass`), `Label`, `Switch`, `kit` (`Eyebrow`, `Figure`, `Stat`, `Section`, `Tile`, `Callout`), `StepForm` + `Field` + `ChoiceCard` (any form with more than a handful of inputs is split into steps: progress rail, one step at a time, per-step validation, review step, nothing sent before the last step) |
| `layout/` | `Shell`/`AppShell` (sticky top bar, workspace row, phone tab bar), `PublicShell` + `site-chrome` (floating marketing header, footer with cropped wordmark), `PageLayout`/`PageHeader`/`PageSection`, `ProfileHero`, `states` (loading shimmer, empty, error, stale), `ThemeSwitch` |
| `visual/` | `AllocationRing`/`AllocationLegend`/`AllocationBar`, `WeightDiff`, `ChainBadge`/`AssetMark` (registry logo first, then the vendored CC0 icon pack in `public/crypto`, then a monogram), `Sky` (gradient + drifting transparent clouds), `Phone`/`HandPhone` (screens punched out; real UI sits behind the bezel, sized in `cqw`), `ExampleBasketScreen`, `GlassObject` (stills), `GlassScene` (real-time glass ring / stack, lazy, still fallback) |
| `motion/` | `Reveal`, `Stagger`, `LineReveal`, `Parallax`, `SwapStack`/`SwapPanel` (page swap), `SmoothScroll` (Lenis, marketing only) |
| Domain | `BasketCard` (holdings logos, min amount, simulated 1y return, volatility meter, save toggle), `BasketRow` (list view), `BasketRail` (Featured / Trending / Suggested), `BasketFiles`/`FileList`, `DownloadApp`/`StoreButtons`, `Roles` (permission matrix + custom role editor), `WorkspaceLayout`/`OrgPage`, `OpsFrame`, `PerformanceChart` (hover + data table), `BasketView`, `PortfolioSummary`, `AttentionList`, `PositionRows`, `PositionsList` (three layers: target, allocation, verified), `InvestFlow`, `RebalanceReview`, `WorkspaceHeader`/`useOrgWorkspace` |

## Motion

Tokens and choreography come from `docs/design/MOTION-STUDY.md`: ease `cubic-bezier(0.22, 1, 0.36, 1)`, durations
160 / 320 / 700 / 1100 ms, 120 ms line stagger, 80 ms item stagger. Load order on heroes: atmosphere → words →
object → data chips → actions. Reduced motion renders final states; smooth scrolling is marketing-only and off on
touch devices. Chapters of the landing page swap like pages (see the round 2 study). `three`/`@react-three/fiber` run
two procedural glass scenes (ring, stack), code-split, paused off screen, replaced by the still image under reduced
motion or without WebGL.

## Imagery

Catalogue and generation record: `apps/web/public/visuals/MANIFEST.md`. One family — frosted glass in ice white, pale
sky and navy — plus natively transparent cloud strips, a modern phone and a hand holding it. Generate with a
transparent background rather than cutting out (cut-outs dull edges). Crypto logos: `apps/web/public/crypto` (CC0). Add assets only after checking the
manifest, and record every new one there.

## Theme

`bx_theme` cookie (`light` | `dark` | `system`). The server renders `data-theme` for a forced choice, so there is no
flash; `system` follows `prefers-color-scheme`. The wallet modal (AppKit) follows the resolved theme.

## Manager and ops surfaces

Same tokens, denser. The manager workspace has a sidebar (identity, switcher, grouped sections: Overview, Baskets,
Team, Roles & access, Wallets, Settings, Earnings); the overview is a dashboard (status cards, next steps, areas).
Ops has the same frame with its own groups (Review, Catalog, Money, Access). Hiding controls is UI convenience only — the
server authorizes every call.

## Scrollbar

A slim floating thumb (`::-webkit-scrollbar`; `scrollbar-color` in Firefox) using `--c-scroll-thumb` tokens per theme;
the track stays invisible.

## Visual QA

`apps/web/e2e/mock-api` serves schema-validated fixtures (personas `investor`, `manager`, `ops`, `new`);
`e2e/shoot.mjs` captures routes at 390–1920px in both themes and flags horizontal overflow; `e2e/flow-invest.mjs`
walks the investment flow. Run `pnpm --filter web mock-api` and `pnpm --filter web dev` first.

# Spec 17 — Web redesign (design)

- **Date:** 2026-10-04 · **Branch:** `claude/bytesac-design-frontend-7c411d`
- **Sources:** the user's master design directive (web first; Expo SDK 57 next; real mobile UI into web devices last),
  `ui-ref/` images and videos (outside the repo), `docs/domains/*`, ADR-012/013/015/016/018, D-063/D-064.
- **Decisions this session:** see `docs/superpowers/BRAINSTORM-LOG.md` (Spec 17): all four packages approved
  (motion, @playwright/test, lenis, three + @react-three/fiber); light **and** dark; ops inherits the system; light
  all-sans type (Geist).
- **Constraints kept:** `@repo/app-core`, `@repo/api-client`, `@repo/validator` and the API are unchanged (two
  packaging-only subpath exports were added to app-core). Existing URLs are stable (mobile handoff and notification
  links depend on them).

## Outcome

A light/dark, editorial design system (`docs/design/DESIGN-SYSTEM.md`) applied to every web surface; a marketing
site; a research-grade basket page; a full-page investment flow; a portfolio that keeps strategy target, basket
allocation and verified holdings visibly separate; a rebalance review built around participate/skip; and a denser
manager workspace. Generated imagery is catalogued in `apps/web/public/visuals/MANIFEST.md`.

## Page audit and information architecture

| Route | Before | Now | Audience | Mobile (Expo) need |
|---|---|---|---|---|
| `/` | redirect to `/sign-in` | **New** landing: hero, statement, journey, live baskets, research, self-custody, strategy updates, multi-chain, managers, closing CTA | Public | Splash/welcome story |
| `/how-it-works` | — | **New**: journey and the three layers that are never the same | Public | Onboarding carousel |
| `/self-custody` | — | **New**: what you sign / what Bytesac signs / what it never does (ADR-013) | Public | Help sheet |
| `/for-managers` | — | **New**: organization model, roles, lifecycle, fees, how to join | Public | Web only |
| `/baskets` | filters + list | Research query (AI search → editable filter chips), grouped filter rail, card grid | Public | Discover tab + filter sheet |
| `/baskets/[slug]` | long text page | Research hero, sticky invest rail, simulated performance with hover, allocation ring + per-network table, version timeline with weight diff | Public | Basket detail |
| `/baskets/[slug]/invest` | dialog only | **New** full-page flow: amount → plan review (what you will sign) → per-step authorization → result; dialog kept as fallback | Investor | Invest stack |
| `/assets`, `/assets/[id]` | API only | **New**: registry list; instrument → deployments → routes, RWA notes (session required by the API) | Investor | Asset detail |
| `/managers/[handle]`, `/organizations/[id]` | text pages | Profile hero, details, baskets, team | Public | Manager profile |
| `/fees` | list | Rates table + fee kinds | Public | Help sheet |
| `/managers/apply`, `/managers/status` | bare cards | In site shell, with steps | Public | Web only |
| `/sign-in`, `/onboarding/contact` | bare cards | Split atmospheric frame; Connect → Sign to verify stated explicitly | Investor | Auth stack |
| `/home` | placeholder | Dashboard: value, attention queue, baskets, research picks, contacts prompt, invitations | Investor | Home tab |
| `/portfolio` | sections | Summary + allocation ring, open operations, attention queue, three-layer position cards, history | Investor | Portfolio tab |
| `/portfolio/[positionId]` | — | **New** position detail | Investor | Position screen |
| `/portfolio/activity` | inside portfolio | **New** activity page (history stays summarised on portfolio) | Investor | Activity |
| `/portfolio/[id]/rebalance` | list | Version diff + reason, weights vs target, equal Participate / Skip panels, plan, signing | Investor | Rebalance stack |
| `/portfolio/repair/[asset]` | toggles | Cause first ("What happened"), two method cards | Investor | Repair sheet |
| `/notifications` | list | Icon per kind, unread emphasis, "never means a trade happened" | Investor | Alerts tab |
| `/profile` | stacked sections | Hub with section index and Appearance | Investor | Profile tab |
| `/organization` | single long page | Workspace header, key figures, section index (status, profile, payout, team, baskets) | Manager | Overview (read-mostly) |
| `/organization/baskets`, `/organization/members` | anchors | **New** focused pages | Manager | Lists |
| `/organization/baskets/[bid]`, `/earnings`, `/membership/[mid]` | — | Restyled through the system | Manager | Web only (editing) |
| `/ops/*` | dark-only | Inherits system; tables scroll on phones; LI.FI records as rows, not JSON | Ops | Web only |
| `not-found`, `error`, `loading` | missing | **New** route-level states | All | — |

## Product truths encoded in the UI

- Strategy target, basket allocation and verified holdings are shown as separate layers (position detail, invest
  split labelled "estimate", portfolio rows "your weight against the target").
- A manager update never moves assets: copy says so on the rebalance review, notifications and landing.
- Skip = no trade, stay on the applied version, review later; skipped versions are not replayed.
- Fees are listed before signing and "not refunded if the operation does not complete".
- AI search shows criteria and matches only, with "Queries are processed by Google Gemini".
- Simulated performance carries the D-064 label wherever a return is shown.
- Chains: Solana + Ethereum, Base, BNB Chain, Arbitrum (sign-in); Bitcoin link-only on the web; Polygon registry-only;
  funding is USDC on Solana. Chain and asset marks are typographic — no third-party logos.

## Not done / follow-ups

- Expo redesign (brief phases 12–16) — blueprint in `docs/design/MOBILE-UX-INVENTORY.md`.
- Basket editor (`/organization/baskets/[bid]`) received the token/primitive pass only; a dedicated allocation editor
  with a live ring is a good next step.
- `three` / `@react-three/fiber` installed but unused; remove or use for an interactive allocation scene.
- Official brand vector: the header uses an SVG redrawn from `public/logo.png` (a usage sheet).
- Public copy and disclosures are marked as placeholders pending legal review.

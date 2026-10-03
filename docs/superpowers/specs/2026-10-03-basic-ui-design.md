# Spec 15 — Basic UI for Web and Mobile (Design)

- **Date:** 2026-10-03
- **Status:** Approved in conversation (2026-10-03)
- **Series:** Spec 15 — after Spec 14; roadmap 16–19 follows (Spec 17 redesigns visuals from user references)
- **Sources:** existing web screens (Specs 1–14), `apps/mobile` (Expo 57 shells), `docs/BYTESAC_Design_System.md`, `apps/mobile/AGENTS.md`, Expo v57 docs, Reown AppKit React Native docs, ADR-013..ADR-018, `docs/domains/USER-FEATURES.md`.

## 1. Intent

Make every feature of Specs 1–14 reachable and consistent on the web, and give mobile investor parity with the web. Functional UI on the existing design system; no visual redesign (Spec 17), no API behavior change.

**Success criteria**
1. Every web route is reachable from role-aware navigation; every list/detail page uses the shared loading, empty, error and stale components.
2. Mobile users can discover, invest, manage their portfolio (rebalance, skip, keep custom, repair, sync, sell, leave, close dust), read notifications and manage contacts, preferences, eligibility and linked wallets.
3. Money-flow client logic (leg signing state, fees, actions) exists once, in `@repo/app-core`, used by web and mobile.
4. Full gate green; mobile `expo export` succeeds; mobile tests cover each screen flow with mocks.

## 2. Decisions (this brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | Scope | Web consistency pass + mobile investor parity; manager and ops stay web-only (mobile shows "Manage on web") (A). |
| 2 | Mobile signing | Solana + EVM via Reown AppKit React Native; operations needing a Bitcoin signature and Bitcoin address linking show "Continue on web" with a deep link; confirm AppKit RN Bitcoin support in the docs and include it only if solid (A). |
| 3 | Shared logic | Pure client logic moves to `@repo/app-core`; apps keep UI and a thin wallet adapter (A). |
| — | Ruling: mobile navigation | Expo Router tabs: Discover, Portfolio, Notifications, Profile. |
| — | Ruling: tests | Jest + React Native Testing Library with mocked API client and wallets; no device E2E (manual checklist in OPEN-ITEMS). |
| — | Ruling: API | No API behavior change; additive read fields only if a screen truly needs one (recorded as a ruling with a test). |

## 3. Shared logic (`@repo/app-core`)

- `legSigner` state machine (pure, no wallet or React): states `idle → quoting → awaitingGasDrop → signing → submitting → tracking → done | failed | handoffWeb`; inputs are API results (quote, gas-drop status, submit result, operation view); handles `QUOTE_EXPIRED` (re-quote), `PRICE_MOVED` (show fresh estimate and minimum, require confirmation), `TX_MISMATCH`, `SOL_REQUIRED`, `GAS_BUDGET_EXHAUSTED`, recovery legs ("Complete swap"), and "Stop here". It calls an injected `Signer` interface: `signSolana(serializedBase64): Promise<signedBase64>`, `sendEvm(tx): Promise<hash>` (approval first when required), optional `signPsbt(base64): Promise<base64>`; a Bitcoin leg with no `signPsbt` ends in `handoffWeb`.
- Display helpers: fee lines and route fees with price impact and waived labels; portfolio headline → available actions; sync-split validation (exact sum, ≤ ledger, decimals); eligibility outcome copy; notification text (already in validator); amount/date formatters; error copy.
- Web is switched to these (existing web tests unchanged; new app-core unit tests).

## 4. Web consistency pass

- App shell: header (logo, bell, account menu, org switcher), role-aware navigation — Investor: Discover (`/baskets`), Portfolio, Notifications, Profile; Manager (with an active membership): Organization, Baskets, Earnings; Ops (with a platform role): the `/ops/*` areas grouped (Applications, Organizations, Members, Assets, Baskets, Fees, Routing, Revenue, Roles, Tags, Disclosures, Manager profiles).
- Shared `PageLayout` (title, breadcrumb, actions slot) and state components (`LoadingState`, `EmptyState`, `ErrorState` with retry, `StaleNotice`) used on every list/detail page.
- Every route reachable; dead links fixed; consistent table/card patterns; works at 360 px width (16 px gutters, no horizontal scroll); 44 px targets; lucide icons only.

## 5. Mobile (Expo 57, Expo Router)

- Tabs: **Discover** (list, filters, keyword and AI search, basket detail with allocation, fees, eligibility notices, manager, performance line chart, Invest), **Portfolio** (positions with headline/states/cash and actions, operation detail with legs and explorer links, history; rebalance review, skip, keep custom/revert, repair and sync, sell, leave, close dust, Continue), **Notifications** (inbox, unread badge on the tab, mark read), **Profile** (contacts and verification, notification preferences, eligibility declaration, linked wallets — Solana and EVM; "Link Bitcoin on web").
- Invest and every signing flow use `legSigner` with the mobile AppKit RN `Signer`; Bitcoin legs → "Continue on web" (opens `<web origin>/portfolio#operation-<id>`).
- Managers/ops see a "Manage on web" card on Profile.
- Data: `@repo/api-client` with the mobile session (SecureStore bearer, `X-Client: mobile`), TanStack Query (installed), pull-to-refresh, loading/empty/error/stale states.
- Follows `apps/mobile/AGENTS.md` and Expo v57 docs; NativeWind styling per design tokens; accessibility labels and 44 pt targets.

## 6. Out of scope

Visual redesign (Spec 17); mobile push (future plan); manager/ops mobile screens; Bitcoin signing on mobile unless AppKit RN support is confirmed; API changes beyond additive read fields.

## 7. Testing

App-core unit tests for `legSigner` (every state and error path), helpers; web tests unchanged plus shell/navigation tests; mobile jest + RNTL tests per screen flow (Discover → detail → invest with mocked signer; portfolio actions; repair/sync; notifications; profile forms; Bitcoin handoff); full gate `--concurrency=1 --force`; `pnpm --filter mobile test`; `npx expo export --platform android`. Manual device checklist (AppKit RN with Phantom/MetaMask mobile, deep link to web for Bitcoin) added to OPEN-ITEMS.

## 8. Execution shape

Five tasks: (1) app-core extraction + web switched; (2) web shell, navigation, page layout and state components; (3) mobile foundation: tabs, data/session wiring, AppKit RN signer adapter, Discover and basket detail, Invest wizard; (4) mobile Portfolio and actions, rebalance/repair/sync/sell/leave/close, operation detail, Notifications, Profile; (5) mobile tests completion, docs (mobile/web READMEs, ARCHITECTURE, USER-FEATURES, OPEN-ITEMS manual checklist), full gate. Staffing: implementer #1 Tasks 1–2, implementer #2 Tasks 3–4, implementer #3 Task 5.

# Spec 15 — Basic UI for Web and Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **User preference:** few large tasks, tests per task, one review at the end plus one fix wave.

**Goal:** Shared client money-flow logic in `@repo/app-core`, a consistent role-aware web shell, and mobile investor parity (Discover, Invest, Portfolio and actions, Notifications, Profile) with Solana/EVM signing and Bitcoin handoff to the web.

**Architecture:** `packages/app-core/src/{leg-signer,fees,portfolio-actions,sync-split,eligibility-copy,format}.ts` (pure); web `components/layout/{app-shell,page-layout,states}.tsx`; mobile Expo Router `src/app/(app)/(tabs)/{discover,portfolio,notifications,profile}` with stack screens; mobile `src/lib/signer.ts` (AppKit RN adapter).

**Tech Stack:** Next.js 16, Expo 57 / RN 0.86 / Expo Router / NativeWind, Reown AppKit (web + RN), TanStack Query, Vitest (web/app-core), Jest + RNTL (mobile). No new dependencies unless an Expo/Reown doc requires one (exact pin, release-age rule, recorded as a ruling).

**Spec:** `docs/superpowers/specs/2026-10-03-basic-ui-design.md`

## Global Constraints

- **No API behavior change.** Additive read fields only if a screen truly needs one (ruling + test). Route-table snapshot unchanged unless such a field is added (then explain).
- **Money logic once:** the `legSigner` state machine and helpers live in app-core; web and mobile only render state and call their `Signer`. The machine never decides amounts; it displays server values.
- `legSigner` contract (exact): `type LegSignerState = { kind: "idle" } | { kind: "quoting" } | { kind: "awaitingGasDrop"; txHash: string | null } | { kind: "confirmPrice"; estimatedOut: string; minOut: string } | { kind: "signing" } | { kind: "submitting" } | { kind: "tracking" } | { kind: "done" } | { kind: "failed"; code: string; message: string } | { kind: "handoffWeb"; url: string }`; `interface Signer { signSolana(serializedBase64: string): Promise<string>; sendEvm(tx: { to: string; data: string; value: string; chainId: number; approval?: {...} }): Promise<string>; signPsbt?(psbtBase64: string): Promise<string> }`. Drive it with a reducer + async runner (`runLeg(api, signer, operationId, legId, dispatch)`), so web hooks and mobile hooks wrap the same runner. Keep the web's current behavior exactly (its tests are the oracle).
- **Design system:** `docs/BYTESAC_Design_System.md` tokens via `@repo/design-tokens`; 44 px/pt targets; status text + icon; lucide (web) / the icon set mobile already uses; 360 px web width without horizontal scroll.
- **Mobile rules:** read `apps/mobile/AGENTS.md` and Expo v57 docs first (use the expo skills: expo-router, expo-data-fetching, expo-native-ui); Reown AppKit RN official docs for Solana/EVM signing; confirm whether AppKit RN supports Bitcoin PSBT signing — include it only if officially documented and stable, else handoff.
- **Tests:** existing web tests must pass unchanged; app-core unit tests for every `legSigner` transition and error code; mobile Jest + RNTL tests with mocked `@repo/api-client` and `Signer`. Foreground runs with stdin `< /dev/null`; no timers; never two suites at once; Windows crash 3221226505 → re-run alone.
- Never stage `.claude/settings.json`, `.gitignore`, `AGENTS.md`, `apps/api/.env.example`, the route-table snapshot (LF noise), `firebase-service-account.json`, generated `apps/*/AGENTS.md`/`CLAUDE.md`, or anything under `.superpowers/` — these are user/noise files. Never open the Firebase json.

## Review Focus

1. **Web money flows regress after the extraction** (quote expiry, price moved, TX mismatch, gas-drop wait, approval-then-send, recovery leg, stop): existing web tests unchanged and green; app-core tests cover each path.
2. **Mobile signs something the user didn't see:** the preview (fees, minimum out, price-impact) is always shown from server values before the wallet opens; `confirmPrice` requires an explicit tap.
3. **Bitcoin leg on mobile:** never attempted without `signPsbt`; handoff URL opens the same operation on web.
4. **Session/auth on mobile:** bearer from SecureStore, `X-Client: mobile`, logout clears; no token in logs.
5. **Role gating:** manager/ops nav hidden without the role on web; mobile shows "Manage on web" only; server remains the authority.

---

### Task 1: app-core extraction

- [ ] Move pure logic from `apps/web/components/invest/*` (`use-leg-signer`, fee lines, leg progress helpers), portfolio action mapping, sync-split validation, eligibility copy and formatters into `packages/app-core/src/*`; export them; web components become thin wrappers using a web `Signer` (existing AppKit/wagmi code).
- [ ] App-core tests for every transition/error; web tests unchanged and green; `pnpm --filter @repo/app-core test`, web lint/check-types/build/test. Commit `refactor(app-core): shared leg signer and client money-flow helpers`.

### Task 2: web shell and consistency

- [ ] `components/layout/{app-shell,page-layout,states}.tsx`; role-aware nav per spec §4; apply `PageLayout` + state components to every list/detail page under `app/(app)`, `app/(ops)`, `app/baskets`, `app/managers`, `app/organizations`, `app/fees`, `app/notifications`; fix dead links; 360 px layout.
- [ ] Tests: nav visibility per role, state components, a sample of pages rendering each state; full web test suite green. Commit `feat(web): app shell, role-aware navigation and consistent page states`.

### Task 3: mobile foundation, Discover and Invest

- [ ] Expo Router tabs `(app)/(tabs)/_layout.tsx` with Discover, Portfolio, Notifications, Profile (badge for unread); TanStack Query provider; API client with mobile session; `src/lib/signer.ts` AppKit RN adapter (Solana `signTransaction` base64, EVM send + approval) per Reown RN docs; Discover list (filters, keyword + AI search), basket detail (allocation, fees, eligibility notice, manager, performance line), Invest wizard (amount, preview with fees/route fees/impact, signing via `runLeg`, Bitcoin handoff).
- [ ] Jest + RNTL tests for each; `pnpm --filter mobile check-types`, `test`, `expo lint`, `expo export --platform android` (temp dir outside repo; revert generated tsconfig changes). Commit `feat(mobile): tabs, discover, basket detail and invest`.

### Task 4: mobile Portfolio, actions, Notifications, Profile

- [ ] Portfolio (positions, headline, states, cash, actions from app-core mapping), operation detail (legs, explorer links, Continue, Stop here, Complete swap), rebalance review + skip, keep custom/revert, repair + sync form, sell (percent) + excluded notice, leave, close dust, history; Notifications inbox + mark read; Profile: contacts (add/verify OTP), preferences, eligibility declaration form, linked wallets (Solana/EVM; Bitcoin → web), "Manage on web" card for managers/ops, logout.
- [ ] Tests for each flow; mobile check-types/test/lint/export. Commit `feat(mobile): portfolio, actions, notifications and profile`.

### Task 5: tests completion, docs, gate

- [ ] Fill test gaps found in Tasks 3–4; docs rewritten in place: `apps/mobile/README.md` (screens, signing, handoff, env), `apps/web/README.md` (shell/nav), `docs/architecture/ARCHITECTURE.md` (app-core shared logic, mobile structure), `docs/domains/USER-FEATURES.md` (mobile availability), `docs/OPEN-ITEMS.md` (manual device checklist: AppKit RN with Phantom/MetaMask mobile on iOS/Android, Bitcoin handoff deep link, SecureStore session, notification badge; mobile push still future), HANDOFF current-state row.
- [ ] Full gate `pnpm turbo run lint check-types test build --continue --concurrency=1 --force < /dev/null` (re-run crashed api files alone), `pnpm --filter mobile test`, mobile `expo export`. Commit `docs: spec 15 basic UI`.

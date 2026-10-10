# Brainstorm Log — Questions, Options and the User's Answers

Every brainstorm question asked, the options offered (recommended option first), and the user's exact answer. Final decisions also live in each spec's "Decisions" table, the decision register and the ADRs; deferred options live in `docs/domains/FUTURE-PLANS.md`. Specs 1–8 were brainstormed in earlier sessions whose Q&A was not recorded; see the "Decisions" tables in their specs under `docs/superpowers/specs/`.

---

## Spec 9 — Rebalance, skip/catch-up, drift, repair, notifications (2026-10-02)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Scope | A one spec, drift by polling (rec.) · B two specs · C one spec + Alchemy webhooks | **A** | One spec; webhooks → future plan |
| 2 | Rebalance routing | A direct sell→buy legs (rec.) · B hub through USDC on Solana · C hybrid | **B, and add A to future plan** | Hub; direct pairing → future plan |
| 3 | Trade thresholds | A platform defaults 50 bps / $5 (rec.) · B none · C per-version manager thresholds | **A and C** | Defaults + optional per-version override (10–1000 bps, $1–$100) |
| 4 | Fix semantics | asked "explain" with drift/short examples and smallcase comparison; then A smallcase-style (block rebalance while SHORT, one buy-back per asset, user-editable sync split) (rec.) · B per-basket fixed pro-rata, blocked · C per-basket, rebalance allowed | **A, and add to future plan: one plan for buy and sync across all baskets to save network fees** | Smallcase-style; combined repair plan → future plan |
| 5 | Partial rebalance / version published mid-plan | A version applied only on COMPLETED; newer version cancels PLANNED plans (rec.) · B applied on first settled leg · C block publishing | **A** | As A |
| 6 | Drift detection and notifications | A nightly + portfolio read, version threshold (default 500 bps), weekly email cap, keep custom (rec.) · B in-app only · C hourly job | **A** | As A |
| 7 | Basket cash between sells and buys | A `position_cash_entries` sub-ledger (rec.) · B no basket cash · C USDC row in the ledger | **A** | As A |
| 8 | Network fee placement in a rebalance | A extend D-071 (first / between sells and buys / refuse) (rec.) · B always up front · C always from proceeds | **A** | As A; no platform/manager fees until Spec 10 |
| 9 | Investor basket notifications | A email only (rec.) · B defer · C in-app inbox | **C, use Firebase notifications if needed** | Inbox + email + push |
| 10 | Push | A inbox + FCM web push, mobile later (rec.) · B inbox only · C web + mobile push | **A** | Web push via FCM; mobile push → future plan |
| 11 | Manager adoption view | A aggregate counts, "<5" masking (rec.) · B defer · C per-investor rows | **A** | As A |
| — | Merge-time minor 6: push token on logout | fix before merge (rec.) · defer | **Fix before merge** | Revoke on sign-out |
| — | Merge-time minor 8: adoption masking can be differenced | accept for launch (rec.) · fix | **Accept for launch** | Joint masking open (D-084) |

## Spec 10 — Manager fees, platform fees, earnings (2026-10-02)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Fee recipient | A direct to the organization's payout wallet (rec.) · B platform treasury + payouts · C platform only | **A** | Direct payouts |
| 2 | Platform's own fee | A none (rec.) · B take rate · C separate per-operation fee | **C, editable from the admin panel** | Per-operation platform fee, ops-editable |
| 3 | Platform fee configuration | A per-operation schedule, versioned (rec.) · B one global percent · C A + per-basket/organization overrides | **C** | Schedule + overrides (basket > organization > default) |
| 4 | Manager fee shape | A percent + optional cap, or fixed (rec.) · B keep schema · C percent with required cap | **A** | As A |
| 5 | Management fee | A disclosed, not collected (rec.) · B accrue and collect at next operation · C remove | **A** | Not collected; accrual → future plan |
| 6 | Subscriptions | A prepaid signed periods (rec.) · B SPL delegation auto-renew · C collect at operations | **"add this into the future plan" → clarified: move the whole subscription feature to future plans** | Subscriptions deferred entirely |
| 7 | Fee timing and refunds | A fees first, non-refundable (rec.) · B fees last on settled · C fee credit | **A** | As A |
| 8 | Rebalance fee source | A follow D-079 (proceeds allowed for Solana-only sells) (rec.) · B always up front · C always from proceeds; asked "explain" | **A for now, add B to future plan** | As A; B → future plan |
| 9 | Manager rebalance fee scope | A only when applying a newer version (rec.) · B every rebalance · C drift fix at half rate | **A** | As A |
| 10 | No verified payout wallet | A waive (rec.) · B block basket · C escrow | **A** | Waive + ops warning + email |
| 11 | Earnings reporting | A organization page (Owner/Admin) + ops revenue + reconciliation (rec.) · B all members · C minimal | **A** | As A |
| — | Second fix wave for N1 (rent priced with ETH/BTC price) | yes, small fix (rec.) · merge as-is | **Yes** | Fixed before merge |

## Spec 10.1 — LI.FI hardening (2026-10-03)

User request: read six LI.FI FAQ pages; list changes/improvements → **"apply all improvement and suggested changes and add B1, B4, B8 into future plan"** (B1 integrator fee, B4 route order, B8 skipSimulation → future plans).

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | LI.FI refuses Solana wallets without SOL | A detect, 409 `SOL_REQUIRED` (rec.) · B platform SOL drop · C wait for real-key check | **A** | As A; SOL drop → future plan |
| 2 | Failed destination swap recovery | A recovery leg in the same operation · B separate `recover` operation (rec. after "A vs B" comparison) · C display only | **A, add B to future plan** | In-operation recovery leg; separate operation → future plan |
| 3 | Price impact limit | A constant 5% + display (rec.) · B ops-configurable · C display only | **A, add B to future plan** | As A; configurable limits → future plan |
| 4 | Bridge/exchange policy | A ops deny list, empty default (rec.) · B allow list · C env deny list | **A** | As A |
| — | Server-side price-impact backstop (merge time) | defer to OPEN-ITEMS (rec.) · add before merge | **Defer** | In OPEN-ITEMS |

## Spec 11 — Secondary-market RWAs and eligibility (2026-10-03)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Release-1 RWA routes | A secondary-market via LI.FI only (rec.) · B + one issuer subscription/redemption provider · C engine only | **A** | As A; issuer routes → future plan |
| 2 | Jurisdiction and investor status | A self-declaration + geo-IP signal, `KYC_REQUIRED` blocks (rec.) · B KYC vendor · C geo-IP only | **A** | As A; KYC vendor → future plan |
| 3 | Rule evaluation | A deny by default for RWAs, most specific wins, strictest on tie (rec.) · B allow by default · C rules for everything | **A** | As A |
| 4 | Ineligible users | A block buys, keep holdings, sells follow `sell` rules (rec.) · B rebalance without the blocked asset · C block everything | **A, add detailed info to future plan** | As A; option B detailed in FUTURE-PLANS |
| 5 | RWA pricing | A market price required, NAV display only (rec.) · B NAV fallback · C LI.FI `priceUSD` fallback | **A** (later: "also add question 5 into future plan") | As A; B and C → future plan |
| 6 | Permissioned tokens | A permissionless only (rec.) · B ops-recorded allowlists · C on-chain allowlist checks | **A, add this into the future plan** | As A; B and C → future plan |

## Spec 12 — Launch hardening (2026-10-03)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Scope | A must-fix + money/ops + small functional bugs (rec.) · B must-fix + money/ops · C all of OPEN-ITEMS §7 | **A** | As A; code debt → Spec 13, CI → Spec 16, UI → Spec 15 |
| 2 | Server-side price-impact backstop (asked to "explain again in simpler words") | A own check with route fees removed (rec.) · B own check with fees counted · C keep deferring | **A** | Fee-excluded check, > 5% refused, skipped under $10 |
| 3 | Fully sold positions | A auto-close when everything is 0 (rec.) · B "Close position" button · C leave | **both A and B** | Auto-close + dust (< $1) close button |
| 4 | Stuck recovery blocks the user | A auto-stop after 7 days (rec.) · B allow a second operation · C reminder only | **A, add the issue to future plans for a deeper fix** | Auto-stop; deeper fix in FUTURE-PLANS |
| 5 | Rebalance blocked by a non-investable held asset | A only bought assets must be investable (rec.) · B keep rule · C A + ops alert | **C, add the whole issue to future plans for a deeper fix** | Bought-only rule + ops alert; disposition flow in FUTURE-PLANS |


## Spec 13 — Code cleanup (reference structure) and docs cleanup (2026-10-03)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Which references | repos / files / style notes | **Shridhan-Backend (`src/routes/activityRoutes.ts` …) and nerve (`apps/api-gateway/src/app.ts`, `server.ts`); also clean the docs folder (remove duplicates, update md files)** | References recorded |
| 2 | Request layering | A controllers, function style (rec.) · B class controllers with DI · C keep inline handlers | **Per aspect: layers → Shridhan; controller → Shridhan; file names → nerve; config → nerve; imports → nerve; server.ts → Shridhan; app.ts → nerve; "maybe feature-based instead of service-layered folders"** | Mixed reference style |
| 3 | Folder structure | A feature modules (rec.) · B layered with nerve names · C hybrid | **A** | `src/modules/<feature>/` |
| 4 | Error response shape | A keep ours, nerve logging (rec.) · B nerve array shape · C array + code | **A** | Contract unchanged |
| 5 | Reach | A restructure API, tidy packages/web/mobile (rec.) · B also restructure web · C API only | **A** | As A |
| 6 | Docs cleanup | A one source of truth per topic (rec.) · B light pass · C A + delete old specs/plans | **A** | CONTINUATION merged into HANDOFF; register as index |


## Spec 14 — Integration audit (2026-10-03)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Output | A report + fixes (rec.) · B report only · C report + fixes + upgrade everything | **A** | Audit doc + fixes; majors/design → OPEN-ITEMS |
| 2 | Live calls | A read-only via throwaway script (rec.) · B docs only · C A + sandbox sends | **A** | LI.FI keyless; Alchemy/CMC only with local keys; no writes, signing or broadcasting |

Merge-time decisions (after the whole-branch review):

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 3 | Minimum-output tolerance (layerswap rounds 18-decimal amounts to 1e10 wei, about 2.7 ppm on small ETH legs) | 1 max(1 ppm, 10^(decimals-8)) · 2 flat 10 ppm · 3 keep 1 ppm and record | **1 + future plan** | Implemented; deeper fix in FUTURE-PLANS (Routing provider robustness) |
| 4 | Deny entry whose key LI.FI no longer lists | 1 drop it, warn, mark stale (fail open, visible) · 2 fail closed | **1 + future plan** | Implemented; deeper fix in FUTURE-PLANS (Routing provider robustness) |
| 5 | When does the full verification gate run | before the fix wave · after the fix wave | **After the fix wave** | Controller runs the gate once the fixes are committed |


## Spec 15 — Basic UI for web and mobile (2026-10-03)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Scope | A web consistency pass + mobile investor parity (rec.) · B mobile only · C A + manager screens on mobile | **A** | As A; manager/ops web-only |
| 2 | Mobile signing | A Solana + EVM on mobile, Bitcoin hands off to web (rec.) · B full Bitcoin on mobile · C view-only mobile | **A** | As A; AppKit RN Bitcoin checked in docs |
| 3 | Shared logic | A move pure logic to `@repo/app-core` (rec.) · B duplicate in mobile · C React Native Web | **A** | Shared `legSigner` + helpers |


## Spec 17 — Web redesign (2026-10-04)

Brief: the user's master design directive (web first; Expo SDK 57 later; real mobile UI into web device compositions last). Roadmap item 17 taken ahead of 16 at the user's request.

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Packages to add | motion (rec.) · @playwright/test (rec.) · lenis · three/react-three-fiber | **All four** | Pinned in `apps/web`; `@types/three` added as its type companion. Anything else (drei, postprocessing) asks first |
| 2 | Theme scope | Light only now (rec.) · Light + dark | **Light + dark** | Both themes ship; tokens carry both |
| 3 | Ops console | Inherit new system only (rec.) · full redesign · leave untouched | **Inherit** | Ops gets new tokens, primitives and shell; no IA redesign |
| 4 | Type direction | Editorial serif + sans (rec.) · Light all-sans | **Light all-sans** | Geist 300 display, Geist 400/500 UI, Geist Mono labels |

### Round 2 (2026-10-04, after PR #1 merged)

User feedback list: 15-fps reference study (section "page swap" from the bottom, slowly drifting clouds); realistic iPhone and hand assets; real 3D models with an assembling glass-stack animation; generate transparent assets instead of cut-outs; primary reference first; better secondary pages and multi-step forms; custom scroll thumb; trending / suggested / featured baskets on home; new basket list; full ops and manager redesign with detailed role management; crypto logos; basket files; asset logos; a download-app CTA.

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Basket files and asset logos | Versioned basket files (rec.) · basket-level files · UI only | **Versioned basket files** | Files attach to a basket version (immutable once published, reviewed with it); asset logo is an instrument field set by ops |
| 2 | Role management depth | Manage the existing model (rec.) · custom roles | **Custom roles** | Organizations define roles with per-permission toggles; needs an ADR, migration, API, server enforcement and tests |
| 3 | Crypto logos | Uploaded + `cryptocurrency-icons` pack (rec.) · uploaded only · CoinMarketCap URLs | **Uploaded + icon pack** | Uploaded registry logo wins; bundled CC0 SVGs as fallback |
| 4 | Delivery | Branch + PR then merge (rec.) · merge myself | **Branch + PR** | Branch `feat/spec17-redesign-2`; merge after confirmation |

Brief vs docs (docs win, per the brief itself): sign-in chains are Solana, Ethereum, Base, BNB Chain and Arbitrum; Bitcoin is link-only (web); Polygon is registry-only. No real portfolio performance or manager analytics exist, so none are shown. Bytesac co-signs Solana legs as fee payer and sends EVM gas drops, so custody copy never claims Bytesac never touches a transaction.

### Round 3: mobile (2026-10-05, PR #2 merged)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | How mobile work starts | Merge #2 then branch (rec.) · branch from #2 · same branch | **Merge #2, then branch** | PR #2 was merged; branch `feat/mobile-redesign` from `main` (plus the landing-rail scrollbar fix pushed after the merge) |
| 2 | Scope | Full investor redesign (rec.) · plus manager read-only · restyle only | **Full investor redesign** | Design system (light + dark, Geist, sky/glass) on every screen plus new P0/P1 screens: Home tab, position detail, activity, splash + welcome, appearance, rails, crypto logos; manager stays a web hand-off |
| 3 | New packages | Geist fonts · expo-blur · expo-linear-gradient · expo-haptics | **All four** | Installed with \`npx expo install\` (SDK 57 versions) |
| 4 | Verification | Expo web + jest (rec.) · Android emulator · jest only | **Expo web + jest** | Expo web target against the mock API, Playwright at phone sizes, jest; user checks on a device at the end |

Rulings made while building (no question asked; product truths unchanged):

- Ruling: signed-in users and finished sign-ins land on Home, not Discover — Home is the new first tab — cost if wrong: one route constant in `sign-in.tsx`, `contact.tsx`.
- Ruling: the Profile header badge says "Contacts verified / needed", not "Ready to invest" — eligibility also gates investing — cost: wording.
- Ruling: the invest "target split" shows weights × amount labelled "before fees"; the plan preview stays the source of real amounts — cost: remove the card.
- Ruling: the signing screen puts the current action above the step track — six-leg plans pushed the button off-screen — cost: layout only.
- Ruling: the welcome pager shows on every signed-out start (no stored "seen" flag) — simplest, no new storage — cost: add a flag later.


### Round 4: mobile push (2026-10-05)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Delivery | Expo push service (rec.) · native FCM with react-native-firebase · Android-only FCM | **Expo push service** | ADR-020, D-118; `providers/expo-push.ts` |
| 2 | Packages | expo-notifications + expo-device (rec.) · none | **Install** | `npx expo install` (SDK 57); the unrelated viem lock line was reverted again |
| 3 | Token storage | platform + provider columns (rec.) · separate table | **Columns** | migration `0020_mobile_push.sql` (additive, defaults web / fcm) |
| 4 | Content | inbox title and body (rec.) · generic text | **Inbox text** | same copy as email and web push; `data.link` mapped by the app |

---

## Mobile wallets and chain coverage (2026-10-09)

Brief: Android device run of the mobile app with MetaMask, Trust Wallet and Phantom-class wallets.

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Patch WalletConnect `setDefaultChain` crash | pnpm patch (rec.) · override to 2.26 · leave | Patch, then **remove it** | Dev-only red box accepted; noted in OPEN-ITEMS |
| 2 | MetaMask has no Solana on mobile | Keep Reown + link a second wallet (rec.) · WalletConnect only · add MetaMask Connect | **Keep Reown; no MetaMask-only fix** (it would not help other wallets) | Add chain account guidance shipped (`a3d3f7f`); Reown Multi Wallet (paid) in FUTURE-PLANS |
| 3 | Reduce wallet switching | Auto-switch namespace (rec.) · multichain-wallet hints · one-time setup | **One-time setup + fixes now**; Multi Wallet later | Shipped with #2 |
| 4 | Basket chain not signable by the wallet (Phantom + Arbitrum) | Warn and allow (rec.) · block · plan only | **Plan only**, options explained | Design in FUTURE-PLANS "Mobile wallets" |
| 5 | How do Arbitrum tokens reach a Phantom user? | (clarification) | Explained: an EOA has the same address on every EVM chain; ADR-004 registers all four EVM chains from one signature | Verify Phantom phrase import gives the same EVM address |
| 6 | D-119 policy | Warn and allow (rec.) · block · keep open | **Warn and allow** | D-119 APPROVED; not built. Reown Multi Wallet researched: web-only today, does not solve D-119 |
| 7 | Single-chain (Solana-only) platform? | Trade-offs explained; mint own wrapped tokens rejected (custody, bridge risk, licensing) | Discussion | Use existing reputable Solana assets if Solana-first is chosen later |
| 8 | Multi-wallet provider | Custom on free Reown · Reown paid · Dynamic | **Reown paid now; custom layer in future plan** | FUTURE-PLANS "Custom multi-wallet layer" |
| 9 | One address per family vs per chain | Keep per family (rec.) · per chain · A now, B later | **Per chain** (after explanation) | D-120 APPROVED; spec pending |
| 10 | Mobile multi-wallet | Web paid + mobile custom (rec.) · web only · evaluate Dynamic | **Web paid + mobile custom**, after deep research (Reown RN has no multi-wallet) | D-121; provider switch fallback in FUTURE-PLANS |
| 11 | Split into 3 projects (per-chain backend · web multi-wallet · mobile multi-wallet) | As proposed (rec.) · combine 1+2 · other order | **Combine 1+2**; mobile later | Spec `2026-10-09-per-chain-addresses-multi-wallet-design.md` |
| 12 | Move a linked chain to another wallet | Only when empty (rec.) · never · any time | **Only when empty**, plus a full help guide and FAQs (explained with examples twice) | `reassign_chain` with `CHAIN_NOT_EMPTY` |
| 13 | Assign chains when linking | Tick chains, one approval (rec.) · one approval per chain | **Tick chains**; also at sign-up; Polygon linkable | Challenge carries `chains` |
| 14 | Data model | Row per chain (rec.) · addresses + assignments · family default + overrides | **Row per chain** | `replaced` status; one active row per chain |

## Spec 20 — Waitlist, apex domain, soft-launch gate (2026-10-10)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | Apex vs app hosting | One Next on :3000, host routing (rec.) · separate :3001 waitlist · static apex | **One Next** | nginx → same web container; middleware by Host |
| 2 | Gate scope | Whole app host (rec.) · auth paths only · UI-only middleware | **Whole app host** | Apex public; API enforces gate cookie for app-origin requests |
| 3 | Duplicate waitlist email | Upsert, no resend (rec.) · upsert+resend · 409 reject | **Upsert, no resend** | Idempotent join; welcome email only on first insert |
| 4 | Gate credentials | Env single pair + JWT secret (rec.) · multi hash · DB | **Env single pair** | 7-day HttpOnly cookie on app domain |
| 5 | Waitlist From | sameer@bytesac.com + WAITLIST_EMAIL_FROM (rec.) · mail subdomain · global EMAIL_FROM | **sameer@bytesac.com** | Keep EMAIL_FROM for OTP/ops |
| 6 | app.bytesac.com `/` | Redirect /home or /sign-in (rec.) · keep marketing · redirect apex | **Redirect /home or /sign-in** | Marketing/waitlist on apex only |

## Wallet-rewritten Solana fee tx (`TX_MISMATCH`) (2026-10-11)

| # | Question | Options | User's answer | Result |
|---|---|---|---|---|
| 1 | How to unblock Phantom rewriting the fee transaction | Add CU to our fee tx (rec.) · accept wallet CU-only extras · user pays fee-leg gas · wallet settings only | **Explain 1 and 2**, then **option 1 now** and write the problem plus option 2 (and 3) into FUTURE-PLANS | Fee transfer gets LI.FI-shaped compute budget; byte-identical co-sign unchanged; option 2/3 in FUTURE-PLANS |

## Roadmap decisions

- 2026-10-02: rebalance (Spec 9) before fees (Spec 10); then RWAs (Spec 11).
- 2026-10-03 (final order after Spec 11):
  12. Launch hardening (must-fix debt, parked money/ops leftovers, deploy readiness).
  13. Code cleanup against user-supplied reference code (ask for references at the start) **and docs cleanup** (remove duplication, unwanted and outdated information).
  14. Audit every third-party library and provider integration against its official documentation.
  15. Basic UI for web and mobile.
  16. Deployment: Docker, GitHub Actions CI/CD, step-by-step launch guide.
  17. Redesign the whole web and mobile UI/UX from user-supplied reference images and videos.
  18. Motion-graphics promo/launch video (from a user-supplied reference motion-design video) and a platform presentation in the Bytesac theme.
  19. Future plans, one at a time with approval (last).

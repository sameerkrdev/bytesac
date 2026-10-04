# Mobile UX inventory (Expo SDK 57) — blueprint for brief phase 13

Status column: **exists** = a screen in `apps/mobile/src/app` today (Spec 15 parity, legacy dark styling);
**new** = not built; **web** = stays a hand-off to the web (`EXPO_PUBLIC_WEB_URL`). Every screen adopts the web design
system (`docs/design/DESIGN-SYSTEM.md`): same roles, both themes, Geist, glass for sticky bars and sheets only.
Priorities: P0 launch-critical, P1 important, P2 later. Interaction models favour native patterns: tab bar, stacks,
bottom sheets, sticky bottom actions, swipe between sections, haptics on confirmations.

## Authentication and onboarding

| # | Feature | Purpose | User | Mobile screen / pattern | Interaction | Pri | Depends on | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | Splash | Brand moment while the session restores | All | Full-bleed sky (light/dark plate), mark | Auto-advance; respects reduced motion | P1 | Session restore | new |
| 2 | Welcome | "Invest in strategies, not individual trades" + self-custody promise | New | 3-panel horizontal pager | Swipe, skip | P1 | — | new |
| 3–4 | Wallet connection / selection | Connect Phantom/Solflare or an EVM wallet (AppKit RN) | All | Stepper screen; AppKit modal | Deep link out and back | P0 | AppKit RN | exists (`(auth)/sign-in`) |
| 5 | Wallet verification | "Connected" vs "Sign to verify" as two steps; what is signed | All | Same screen, step 2 | Sign in wallet; retry/restart states | P0 | `verifyReducer` | exists |
| 6 | Contact information | Email + phone OTP (required to invest) | All | Stepper with OTP field | Auto-fill OTP, resend timer | P0 | `ContactVerifier` logic | exists (`(auth)/contact`) |
| 7 | Authentication state | Session expired → sign in again | All | Banner + re-sign sheet | Sheet | P0 | Query client hook | exists (redirect) |
| 8 | Account completion | Checklist: contacts, eligibility, extra chain accounts | Investor | Home card + sheet | Tap rows to fix | P1 | Eligibility | new |

## Discovery and research

| # | Feature | Purpose | User | Mobile screen / pattern | Interaction | Pri | Depends on | Status |
|---|---|---|---|---|---|---|---|---|
| 9 | Home | Value, attention queue, baskets, picks | Investor | Tab 1 | Pull to refresh; cards scroll | P0 | Portfolio API | new (today: Discover is first tab) |
| 10 | Discover baskets | Card list with category, top weights, minimum, fee, 1y simulated | All | Tab 2 | Infinite list; sort chip | P0 | Discovery API | exists |
| 11 | Search | Keyword search | All | Search field in Discover header | Debounced | P1 | — | exists (in filters) |
| 12 | AI basket search | Words → editable filter chips (+ Gemini notice) | All | Full-screen research query | Example chips; chips removable | P1 | AI search API | new |
| 13 | Basket filters | Structured filters | All | Bottom sheet with grouped sections | Apply / clear | P1 | `decodeDiscoveryFilters` | exists (basic) |
| 14 | Basket detail | Research hero, key figures, sticky Invest | All | Stack screen; sticky bottom CTA | Section tabs (Strategy, Allocation, Performance, Fees, Risks, Versions) | P0 | Public basket API | exists |
| 15 | Basket research | Thesis, ring, chart, version timeline + weight diff | All | Sections inside 14; chart full-screen on tap | Scrub chart with finger | P1 | — | partial |
| 16–17 | Manager / organization profile | Who runs it; verified badge; baskets | All | Stack screen | — | P2 | Public manager/org APIs | new |

## Investment

| # | Feature | Purpose | User | Mobile screen / pattern | Interaction | Pri | Depends on | Status |
|---|---|---|---|---|---|---|---|---|
| 18 | Investment amount | Big numeric entry, quick amounts, slippage | Investor | Stack step 1; numeric keypad | Quick-amount chips | P0 | `investAmountProblem` | exists (`invest/[slug]`) |
| 19 | Allocation preview | Target split × amount (estimate) | Investor | Card under amount | — | P0 | Public basket | new |
| 20 | Fees | Network / manager / platform, no-refund note | Investor | Section in review | Expandable | P0 | `feeLines` | exists |
| 21 | Risk / disclosure review | Eligibility declaration, disclosures | Investor | Sheet | Checkbox + save | P0 | Eligibility API | exists (form) |
| 22 | Investment confirmation | "What you will sign" per wallet, steps in order, acknowledgement | Investor | Review screen; sticky "Continue to signing" | Checkbox gate | P0 | Plan API | partial |
| 23 | Wallet authorization | Fresh quote per step → approve in wallet | Investor | Signing screen with step list | Deep link per step; haptic on settle | P0 | `legSigner` | exists |
| 24 | Transaction pending | In-flight / unknown states | Investor | Same screen; live updates | Polling | P0 | Operation API | exists |
| 25–26 | Success / failure | Completed, partial, failed, "Stop here" | Investor | Result screen | Links to portfolio | P0 | — | exists (inline) |

## Portfolio

| # | Feature | Purpose | User | Mobile screen / pattern | Interaction | Pri | Depends on | Status |
|---|---|---|---|---|---|---|---|---|
| 27 | Portfolio | Value, ring, attention, positions | Investor | Tab 3 | Pull to refresh | P0 | Portfolio API | exists (list) |
| 28 | Asset allocation | Ring by asset, networks | Investor | Section of 27 | Tap slice → asset | P1 | — | new |
| 29 | Asset detail | Instrument → deployments → routes; RWA notes | Investor | Stack screen | — | P2 | Assets API | new |
| 30 | Performance | Not available yet — say so; no invented chart | Investor | Note in 27 | — | P2 | Future valuation snapshots | n/a |
| 31 | Activity | Operations with steps and explorer links | Investor | Stack screen | Filter by kind | P1 | Portfolio history | new |
| 32 | Transaction detail | One operation | Investor | Stack screen | Explorer deep links | P1 | Operation API | exists (`operation/[id]`) |
| 33 | Wallet | Linked addresses per family | Investor | Profile section | Copy address | P1 | Me API | exists |
| 34 | Wallet / network management | Add chain account; Bitcoin → web | Investor | Sheet | Hand-off for Bitcoin | P1 | AppKit RN | exists (web hand-off) |
| — | Position detail | Three layers: target / allocation / verified | Investor | Stack screen from a position | Segmented control between layers | P0 | Portfolio API | new |
| — | Sell / leave / close | Exit actions | Investor | Sheet with confirmation | Slider for % sell | P1 | Sell plan API | exists (`sell/[positionId]`) |

## Rebalancing

| # | Feature | Purpose | User | Mobile screen / pattern | Interaction | Pri | Depends on | Status |
|---|---|---|---|---|---|---|---|---|
| 35 | Rebalance notification | Push + inbox item | Investor | Notification → deep link | — | P1 | Push (future, FCM web only today) | partial |
| 36 | New basket version | vN → vM, manager's reason | Investor | Rebalance screen header | — | P0 | Portfolio `latestVersion` | exists |
| 37 | Current vs target allocation | Weight diff + your weights vs target | Investor | Section | Swipe between "Change" and "Your weights" | P0 | — | partial |
| 38–39 | Rebalance impact / estimated execution | Sells, fee source, buys | Investor | Plan section | Expand legs | P0 | Rebalance plan API | exists |
| 40–41 | Review / apply | Sign each step | Investor | Signing screen (shared with 23) | — | P0 | `legSigner` | exists |
| 42 | Skip | No trade; stay on applied version | Investor | Equal-weight button + confirmation sheet | — | P0 | Skip API | exists |
| 43–44 | Rebalance pending / result | — | Investor | Shared with 24–26 | — | P0 | — | exists |
| — | Repair / drift | Cause first; buy back or sync | Investor | Stack screen with two method cards | Split editor with sum check | P1 | `validateSyncSplit` | exists (`repair/[asset]`) |

## Settings

| # | Feature | Purpose | User | Mobile screen / pattern | Interaction | Pri | Depends on | Status |
|---|---|---|---|---|---|---|---|---|
| 45 | Profile | Account hub | Investor | Tab 5 | Grouped list | P0 | Me API | exists |
| 46 | Wallets | See 33–34 | Investor | Section | — | P1 | — | exists |
| 47 | Notifications | Preferences (+ push when available) | Investor | Section with switches | — | P1 | Preferences API | exists |
| 48 | Security | Sessions, sign out everywhere | Investor | Section | Swipe to revoke | P1 | Sessions API | partial |
| 49 | Preferences | Appearance (light/dark/system), eligibility | Investor | Section | Segmented control | P1 | Theme store | new |
| 50 | Help / support | How it works, self-custody, fees | All | Sheets reusing web copy | — | P2 | — | new |

## Manager on mobile

Editing stays on the web; mobile gives awareness and light actions.

| Feature | Mobile pattern | Pri | Status |
|---|---|---|---|
| Manager overview (status, key figures) | Card in Profile → read-only screen | P2 | web hand-off today |
| Basket list and status | Read-only list | P2 | new |
| Basket detail / version / review feedback | Read-only screen; "Open on web" to edit | P2 | new |
| Rebalance proposal (new version draft) | Read-only diff | P2 | new |
| Members | Read-only list; invitations accepted on mobile | P2 | new |
| Notifications (review outcomes) | Inbox kinds | P2 | partial |
| Analytics summary | Adoption table only (`analytics.read` is reserved; no analytics dashboards exist) | P2 | new |

## Phase 15 hook

The web shows a blank phone (`HandPhone`) on the landing hero and closing section. Once these screens exist, render
the real Home (9) and Rebalance (36–37) screens and place them into the measured screen rectangle (see
`apps/web/public/visuals/MANIFEST.md`).

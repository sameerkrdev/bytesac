# Bytesac — Open Items

Consolidated list of everything still open after Spec 14 (2026-10-03). This is the single home for open work: `docs/superpowers/HANDOFF.md` points here and keeps no lists of its own. Sources: the decision register (`OPEN` statuses), the Spec 8–12 reviews and earlier handoff notes. Future product scope lives in `docs/domains/FUTURE-PLANS.md`, not here. Tick items as they are closed and rewrite the affected docs in place.

## 1. Accounts, keys and credentials (user actions)

- [ ] Reown project ID (web + mobile).
- [ ] Resend API key and verified sender domain.
- [ ] Twilio Verify service and allowed countries.
- [ ] Alchemy key; confirm the BNB, Arbitrum, Solana and Bitcoin hosts (EVM, BNB, Polygon, Base and Solana hosts verified with the audited key on 2026-10-03). The Bitcoin REST API needs the UTXO add-on: it answers 401 "UTXO requests are not allowed." today (Spec 14 section below).
- [ ] Supabase project: enable `pg_cron` and `vector`, set runtime/role passwords, pooler URL.
- [ ] LI.FI API key, terms, rate limits and integrator fee settings.
- [ ] CoinMarketCap plan (limits, attribution, terms) and real key.
- [ ] Gemini API key, plan, quotas and data-use terms (`GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`).
- [ ] Firebase project, VAPID key and service account (`FIREBASE_SERVICE_ACCOUNT`, `NEXT_PUBLIC_FIREBASE_*`).
- [ ] Cloudflare R2 bucket and credentials.
- [ ] Bundle id `com.bytesac.app`, production metadata URL and icons.

## 2. Platform wallets and treasury (user actions)

- [ ] Fund the Solana fee payer, the EVM gas wallet per chain and the gas treasury.
- [ ] Revenue treasury address (`REVENUE_TREASURY_SOLANA_ADDRESS`) and its USDC token account.
- [ ] Move platform keys (fee payer, EVM gas wallet) to a KMS.
- [ ] Review gas caps (0.02 SOL per user per day may be too low once token-account rent is counted; per-chain EVM caps assume fixed prices) and add an env or table override.

## 3. Compliance and legal

- [ ] Legal review of the self-custody model, the network fee, manager fees paid directly by users to organizations and the platform fee, per launch jurisdiction.
- [ ] Fee caps (D-058: percent ≤ 100 bps, fixed ≤ 1% of the minimum) and final disclosure wording.
- [ ] Simulated-performance label and fee assumptions (D-064).
- [ ] Notification, email and invitation copy (placeholder today).
- [ ] Document retention periods and 7-year audit retention (D-040).
- [ ] Jurisdiction-specific organization requirement templates; re-apply cooldown after a rejected manager application.
- [ ] Adoption count masking (per-cell "<5" can be differenced; accepted for launch, joint masking open in D-084).
- [ ] Tax and reporting obligations for fees and earnings.
- [ ] Legal classification of baskets; RWA issuer terms.
- [ ] Real eligibility rule values for each RWA (jurisdiction, action, outcome, investor statuses) from provider terms, and the investor-status definitions (retail, accredited, qualified, professional) per jurisdiction (D-025, Spec 11).
- [ ] Final wording of the eligibility attestation (`ELIGIBILITY_ATTESTATION`, placeholder, version `2026-10-03`; changing it needs a new version).
- [ ] Legal review of offering tokenized assets on self-declared country and investor status, and of the 365-day expiry.

## 4. Business decisions

- [ ] Platform fee rates per operation type (default 0) and any organization/basket overrides.
- [ ] Rebalance trade thresholds (50 bps / $5) and the 500 bps drift default.
- [ ] Final instrument sector list (D-066).
- [ ] Review SLA for basket and organization reviews.

## 5. Manual verification before launch (not machine-verifiable)

- [ ] Spec 1 wallet checklists: web (MetaMask, Phantom) and mobile (dev build).
- [ ] AppKit Solana signing and real R2 uploads (Specs 3–4).
- [x] LI.FI keyless live check, 2026-10-03 (`docs/engineering/INTEGRATION-AUDIT.md`): `toAddress` echo (case-insensitive for `0x`); `svmSponsor` on Solana quote legs (v0 base64 transaction, payer at index 0, 2 signatures, ComputeBudget 1.4M / 16001); deny encoding (repeated query parameters on quote, body arrays on routes; unknown keys give 400 code 1011); `maxPriceImpact` honored (`routes: []` with a reason); no-SOL and price-impact shapes; Mayan keys `mayan`, `mayanMCTP`, `mayanFastMCTP`; `advanced/routes` without `fromAddress` for Solana; analytics keyless access, seconds timestamps, cursor pagination (default limit 10, now `limit=100`); token flag is `verificationStatus`.
- [ ] LI.FI still open with a real key: Bitcoin PSBT encoding and output shape (needs a UTXO-holding address), the code 1001 shape, `NOT_PROCESSABLE_REFUND_NEEDED`, a `FAILED` status with a receiving transaction, `svmSponsor` on non-quote leg types, and the `toAmountMin` tolerance (max(1 ppm, 10^(decimals-8))) against real quotes.
- [ ] Alchemy Bitcoin `/address`, `/tx/{txid}` and `POST /sendtx/` response shapes: blocked until the UTXO add-on is on the key (every REST call answered 401 on 2026-10-03; Core JSON-RPC `getrawtransaction` works, no balance without the add-on).
- [ ] Phantom and Solflare: wallets that add instructions get `TX_MISMATCH` by design.
- [ ] Reown Bitcoin `signPSBT` of the BIP-322 virtual transaction (Xverse, Leather, Unisat, OKX).
- [ ] CoinMarketCap `/v2/cryptocurrency/quotes/latest` shape with a real key (not run in Spec 14: no key); real token metadata (decimals, symbol) for one token per chain.
- [x] Alchemy `getTokenSupply` on Solana (USDC decimals 6; non-mint, missing and garbage accounts give -32602), EVM `balanceOf`, `getCode`, null receipt, historical balance and Multicall3 (present on Base, BNB, Polygon): verified live 2026-10-03.
- [ ] Gemini forced tool-calling with a real key.
- [ ] Manual WalletConnect/AppKit smoke test on web and mobile (the wallet stack's zod peer resolved from 3 to 4 in Spec 12's lockfile dedupe).
- [ ] Web push end to end in Chrome, Firefox and Safari.
- [ ] Earnings and revenue CSV downloads in a real browser.
- [ ] Small-amount mainnet run of every flow (checklist in `apps/api/README.md`): invest, partial stop, leave, sell, sell former, rebalance (sell → fees → buys), drift fix, buy back, sync, with manager and platform fees.

### Spec 15 manual checks (basic UI)

- [ ] Mobile device run (iOS and Android) with AppKit RN: connect Phantom and MetaMask mobile; Solana sign (active-account requirement, base58 vs base64 responses), EVM chain switch, approval and send; wallet returns only a `signature` is rejected.
- [ ] Set EXPO_PUBLIC_WEB_URL to the confirmed production web origin before release (there is no default; unset hides the handoff buttons).
- [ ] Bitcoin "Continue on web" opens `<EXPO_PUBLIC_WEB_URL>/portfolio#operation-<id>` and "Link Bitcoin on web" opens `/profile`.
- [ ] SecureStore session survives restart; logout clears it and disconnects the wallet.
- [ ] Notifications tab unread badge updates after mark read.
- [ ] Web at 360 px in a real browser: shell, navigation and every page layout.
- [ ] Leftover unconverted loading and error spots on web pages (convert to the shared states opportunistically).
- [ ] Discover filter parity on mobile (asset and sector ranges, fee ceilings, performance) is not ported.
- [ ] Mobile push notifications remain future work.

### Spec 17 manual checks (web redesign)

- [ ] Review all new public copy (landing, `/how-it-works`, `/self-custody`, `/for-managers`, footer) with legal; placeholders are marked `[Placeholder … pending review]`.
- [ ] Replace the redrawn SVG mark (`components/brand/logo.tsx`) with the official logo vector; `public/logo.png` is a usage sheet, not a single mark.
- [ ] Real wallet sign-in and one small real investment on the redesigned flow (only mock-API runs so far).
- [ ] Lighthouse / LCP on `/` with a production build (the hero sky plate and hand cut-out are priority images).
- [ ] Reown dashboard: enable Multi Wallet (Pro plan). Web multi-wallet needs it; without it web falls back to one connection per namespace.
- [ ] Per-chain addresses: after applying migration 0022 on each environment, run `pnpm --filter api ops:backfill-polygon` once (idempotent; gives Polygon to wallets with an EOA EVM address).
- [ ] Device checks for per-chain addresses (D-120, D-121): web with three wallets (MetaMask, Phantom, Trust) doing invest, sell and rebalance; mobile namespace switching (`switchNetwork` to the leg's family when connected but not active, not verified on a device) and the two-approval move.

## 6. Deployment and operations

- [ ] Deploy the BullMQ worker (`start:worker`) with non-evicting Redis.
- [ ] Load balancer must overwrite `X-Forwarded-For` (API trusts only the Next hop).
- [ ] Set `GEO_COUNTRY_HEADER` (for example `CF-IPCountry`) and make the edge strip any client-supplied value of that header; unset means no geo signal (Spec 11).
- [ ] Enforce CSP after the manual wallet E2E: it is report-only with no report endpoint (violations reach only the browser console), so add collection first. Spec 14 added `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` to the report-only policy.
- [ ] Choose an ivfflat or hnsw index for pgvector at scale (no ANN index today; sequential scan is fine pre-launch).
- [ ] Linux CI (or a newer Node) to escape the Windows vitest worker crash 3221226505. `.github/workflows/ci.yml` added (2026-10-07); tick once it has passed on GitHub.

## 7. Technical debt (fix opportunistically, don't expand scope)

**Must fix before onboarding real assets**
- [x] CoinMarketCap: one `price: null` id marks the whole uncached batch unavailable.
- [ ] `mobile#check-types` fixed with a scoped type assertion in `apps/mobile/src/lib/appkit.tsx` (duplicate `@wagmi/core` 2.22.1 peer variants: typescript 6/7, use-sync-external-store 1.4/1.7, zod 3/4); proper peer dedupe open.

**Spec 10.1**
- [ ] Releasing unspent gas after a stop credits the operation's creation-day sponsor row (a stop after UTC midnight credits the old day); a same-chain recovery has no LI.FI status, so the "no second recovery" guard is only reachable on the cross-chain path.
- [ ] Recovery legs use the fresh quote's minimum (no `PRICE_MOVED`); a duplicate route deny returns 400 `VALIDATION_FAILED`, not 409; the LI.FI transfers lookup is a form on `/ops/routing` (operation and leg ids) because the web has no leg resolve view.
- [ ] Mobile Leg fixtures may need the new leg fields (`mobile#check-types` already fails on `main`); `lifiVerification` `flagged` is never produced.

**Spec 10.1**
- [x] Server-side price-impact backstop (refuse measured impact > 5%; measure includes route fees) — decide after the real-key check of `maxPriceImpact` encoding.
- [x] Gas budget counters: a quote-time top-up racing a stop/expiry is not returned; Stop does not release top-ups on unsent non-recovery legs.
- [ ] A stuck recovery leg holds the user's single active-operation slot until Stop or the 7-day auto-stop (the deeper fix is in `FUTURE-PLANS.md`); review Minors 2, 7, 11.

**Spec 10**
- [ ] `/ops/fees` does not show who last changed a row; override form takes raw ids (no picker); ops lists capped at 500 rows.
- [x] Revenue reconciliation buckets by `settled_at` (false mismatch near midnight possible).
- [ ] Review Minors 2, 3, 5, 6, 7, 9, 10, 11 (cosmetic or low risk).

**Spec 9**
- [ ] Unbounded push tokens per user; Firebase registration tokens deprecated (Installation ID migration: see Spec 14).
- [x] `positions` ↔ `rebalance` import cycle (valuation moved to `portfolio/valuation.service`); D-071 message duplicated in sell and rebalance (one `insufficientFee`) (Spec 13).
- [ ] Millisecond race between leg submit and the in-flight guard (bounded by the one-active-operation index).
- [ ] `organization-payout-wallet` web test times out under a parallel full run (passes alone).

**Spec 8**
- [ ] Optional fee-payer `simulateTransaction` check.
- [x] Fully sold positions not auto-closed; sweeps lack per-record isolation.
- [x] Gas reservations are released on every terminal status (cancel, stop, completion, failure), including the network-fee leg; a retried gas drop re-checks its status; a refused drop returns its reservation.
- [ ] An `IN_PROGRESS` operation the user abandons without Stop, with no recovery leg, keeps its reservation (and the user's slot) until UTC midnight.
- [ ] Native EVM received amount is a whole-block balance change; ops leg resolve is not bound to the leg's own transactions; treasury token-account rent is not estimated.
- [ ] Bitcoin wallet never run against a real wallet; EVM approval and main transaction are two prompts; the web signer needs the linked Solana, EVM and Bitcoin wallets to be the connected ones (it says so otherwise).
- [x] Portfolio shows basket slugs rather than names.

**Spec 11**
- [x] A rebalance is no longer refused when a held RWA is structurally non-investable (permissioned, no supported route): only buying it, or a sale with no route, refuses (D-111).
- [ ] A held asset with no price still blocks a rebalance (valuation needs every price); the refusal names the asset. Disposition flow in `FUTURE-PLANS.md` (Q5).
- [ ] Data: which RWA tokens have real DEX liquidity through LI.FI and CoinMarketCap ids (no RWA is offered until ops add a route, a market price reference and rules).
- [ ] Token-2022 RWAs: confirm the balance and received-amount readers and the token-account rent estimate against a real RPC (tested with mocks only; the rent estimate over-reserves for a Token-2022 destination; transfer-fee and hook extensions are not read).
- [ ] Each RWA leg quote appends an `eligibility_decisions` row (growth); investability reads CoinMarketCap prices for RWA constituents on every request (60 s cache); a recovery leg to an RWA created while the user became ineligible cannot be quoted; mobile has no declaration form or notices.

**Spec 15** (basic UI)
- [ ] `apps/mobile/src/lib/appkit.tsx` WalletConnect metadata hardcodes `https://bytesac.com` — set the confirmed production origin (and `EXPO_PUBLIC_WEB_URL`) before release.
- [ ] Mobile multi-leg tests use already-SETTLED legs; add a test with an intermediate SUBMITTED leg.
- [ ] Review Minors left: raw SDK text shown for INTERNAL errors (needs copy), two cosmetic items (mobile has no warning tone).

**Spec 14** (integration audit, deferred findings; details in `docs/engineering/INTEGRATION-AUDIT.md`)
- [ ] Alchemy Bitcoin: buy the UTXO add-on on the key, then verify `/address`, `/tx` and `/sendtx/` shapes (without it, Core JSON-RPC `getrawtransaction`/`sendrawtransaction` could serve tx lookup and broadcast; balance still needs the add-on).
- [ ] `broadcastBitcoin` maps every 4xx to `BROADCAST_REJECTED` (the claim is released as "nothing sent"), false for an already-known transaction; classify `/sendtx/` errors (already known, rejected, auth, rate limit) once the body is known.
- [ ] Token-account rent constant 2,039,280 lamports is stale (live `getMinimumBalanceForRentExemption(165)` = 1,488,440, safe direction); read it from RPC or refresh with the gas-cap review.
- [ ] Gemini default `GEMINI_MODEL` `gemini-3.1-flash-lite` shuts down 2027-05-07 (replacement `gemini-3.5-flash-lite`); switch after a forced-tool-call check with a real key.
- [ ] Firebase Installation IDs: web `getToken` ("will be removed") and admin `tokens` (deprecated in firebase-admin 14.5) migrate together (web `register`/`onRegistered`, token storage, sender); `messaging/invalid-registration-token` never occurs in `sendEach` so malformed tokens are never revoked; cap tokens per user below 500 (a multicast over 500 rejects).
- [ ] iOS Keychain keeps the Bytesac session token across uninstall and reinstall (SecureStore docs); decide on a first-launch clear.
- [ ] Leather signs only the first PSBT input (reown connector `signAtIndex`): test multi-input BTC exits with Leather (the server rejects incomplete PSBTs).
- [ ] Approval with a non-zero leftover allowance (mainnet-USDT style) reverts and fails with a clearer message (wagmi already threw on a reverted approval; the status guard is defense in depth); consider a server-side allowance read and reset.
- [ ] LI.FI plan-time estimate (`/advanced/routes`) cannot pass `svmSponsor`, and with it only relaydepository, across, gasZipBridge, unit, near, mayanFastMCTP, layerswap and lifiIntents are eligible, so an estimate can pick a tool the sponsored quote excludes (the quote re-checks).
- [ ] Transitive advisories (47 in `pnpm audit --prod`, none critical): axios and valibot (reown bitcoin adapter), bigint-buffer and node-forge (no patch), uuid and stream-json (majors), grpc-js (firebase), Expo toolchain globs; re-audit on each Reown, Expo or firebase bump.
- [ ] Housekeeping: `pnpm-workspace.yaml` `minimumReleaseAgeExclude` for turbo@2.11.5 and its platform binaries is probably obsolete; remove after confirming a clean install.
- [ ] Config checks: role-level `statement_timeout` in Postgres; `NEXT_PUBLIC_APP_URL` must be the production domain (AppKit metadata); set `EXPO_PUBLIC_API_URL` in the EAS profiles (default is the Android emulator address).
- [ ] Patch releases left behind under the upgrade ruling: bullmq 6.3.11, vitest 5.0.3, turbo 2.11.7, viem 2.57.2, resend 6.32.0, twilio 6.1.2, `@google/genai` 2.27.0, aws-sdk 3.1146.0.

**Spec 13**
- [ ] Inline guard arrows (`router.use(requireSession, async ...)` rate-limit and guard logic) remain in four route files because naming them would change the frozen route-table snapshot.
- [ ] Unused `*Schema` and type exports in `@repo/validator` and unused db enums were left as contract surface; prune opportunistically (the Spec 14 audit did not cover them).
- [ ] Composition routers (`me`, `organizations`, `public`, `ops`) mount sub-routers that carry no session middleware; keep that rule documented in code if more are added.


**Spec 7**
- [ ] Discovery "Load more" replaces the page; organization filter is an id field; tag filter takes typed keys; asset rows with only an `instrumentId` show an empty symbol in the filter panel; instrument/organization name edits refresh only nightly.
- [ ] Assignment ends that keep the lead are not re-indexed until the next refresh; profile hide/unhide email untested; IP-day AI cap counter untested; a skipped first price day can miss a subscription period start.

**Spec 6**
- [x] `VERSION_CONFLICT` compares millisecond timestamps; publish has no slug-collision retry.
- [ ] A current lead may hand over the lead on an unpublished basket without ops approval (published: ops approval); the wizard cannot preview would-be platform notices before submit; version diff omits lead changes; some manager emails not wired; preview/diff routes missing from the role test table; no org-suspended publish test; drafts do not preview would-be disclosures; `listOrgBaskets` unpaginated.

**Spec 5**
- [ ] Polygon on-chain verification and a Bitcoin data provider for the registry; a DRAFT route on a later-retired deployment can be cascade-approved; a live RWA issuer can be swapped; cascaded item events lack `from_status`; Redis read failures not logged.

**Specs 1–4**
- [x] A concurrent invite during sign-in can abort that sign-in with a 500 (savepoint); a rejected invite consumes the 20/h invite budget.
- [ ] `/me.organizations` `displayName` uses the latest version name.
- [x] Spec 2 ops form offers "Not approved" for a proven approved application; Spec 3 orphan final R2 copy on DB failure after copy.
- [x] Re-adding a contact with a pending verification returns it (no 404); the web form guards double submit.
- [ ] Two truly concurrent contact-add requests can still return the resend-cooldown error to the second.
- [ ] Resend countdown resets on remount; logout awaits wallet disconnect; iOS keyboard double-adjust check; ops/app Switch hit area on device; `@wagmi/connectors` pinned 6.2.0 until Reown RN supports wagmi 3.

- [x] Spec 17: `three`/`@react-three/fiber` now drive the glass ring and stack scenes (round 2).
- [ ] Spec 17: the basket editor (`/organization/baskets/[bid]`) only got the token pass plus files. Mobile jest's `testMatch` finds no tests when the repo path contains `.claude` (worktrees) — run `pnpm exec jest --testMatch "**/test/**/*.test.ts?(x)"`; the cold-start timeouts are fixed (15 s `testTimeout`).
- [ ] Spec 17 round 2: saved baskets live in one browser (localStorage) — a synced watchlist needs an API. App store links are unset (`NEXT_PUBLIC_IOS_APP_URL` / `NEXT_PUBLIC_ANDROID_APP_URL`), so the download CTA says "Coming soon". The Tripo-generated wallet GLB (scratchpad only, 6.4 MB textured) is unused; the procedural scenes replaced it. Trending needs real investor data to show anything (≥ 5 new investors in 30 days). Custom roles are not shown on the public team page (ADR-019 open question). The public pages for organizations and managers had a light pass only. `apps/mobile` type-check needs the Expo-generated `expo-env.d.ts` in a fresh worktree. Uploaded logos and basket files are not virus-scanned (`scan_status` only exists on organization documents).

- [ ] Spec 17 round 3 (mobile, branch `feat/mobile-redesign`): checked on Expo web and jest only — run on an iOS and an Android device (glass fallback on Android, haptics, keyboard on the amount field, AppKit deep links back into the welcome/sign-in flow, safe areas under the transparent basket header). The rest of the inventory followed on `feat/mobile-redesign-2` (checklist, asset, manager and organization pages, filters sheet, chart scrubbing, ring selection, position layer switch, swipe-to-revoke, help sheets); mobile push followed (ADR-020); still open: on-device checks of the swipe gesture and chart scrubbing inside a scroll view. The welcome pager shows on every signed-out start (no "seen" flag). The legacy `palette`/`semantic` exports in `packages/design-tokens` are now unused by both apps.

- [ ] Mobile push (ADR-020): run `eas init` and upload the FCM v1 and APNs keys to EAS before a build can receive push; push receipts are not polled (only `DeviceNotRegistered` at send time revokes a token); no app-icon badge; Expo is a new processor of notification titles and bodies (list it in the privacy notice); verify on device: permission prompt, each kind, tap from a cold start.

- [ ] Logo (2026-10-06): the wordmark outlines have no kerning applied (Geist kerning pairs are not read); review the tight pairs (By, ty) at large sizes. Register the mark with the app stores and update any third-party profiles (WalletConnect metadata now points to the square `logo.png`).

- [ ] Mobile multi-wallet UX (2026-10-09 device run): MetaMask Mobile approves only `eip155` over WalletConnect (metamask-mobile PRs #31616/#35836 closed unmerged), so MetaMask users link a second wallet for Solana through Add chain account; a two-wallet user switches wallets between invest (Solana) and EVM sells. Follow-ups in FUTURE-PLANS "Mobile wallets". The Reown dashboard feature toggles are ignored by the React Native SDK: features are set in `createAppKit`.
- [ ] Mobile dev setup (2026-10-09): Android dev client via EAS (`development` profile, APK) + platform-tools only; `adb reverse` for 8081 (Metro) and 4000 (API), `EXPO_PUBLIC_API_URL=http://localhost:4000` on a USB device (`10.0.2.2` is emulator-only). WalletConnect's `setDefaultChain` unhandled rejection after a MetaMask connect (universal-provider 2.21.10, fixed upstream in 2.26.0, pinned by Reown 2.0.6) is a dev-only red box; remove when Reown moves to 2.26+.
- [ ] Security: the per-address challenge rate limit (10 per 60 s, keyed on the public address before any proof) lets anyone who knows an address keep its sign-in rate-limited (pre-existing). Fix: key on IP plus address, or count verification failures.
- [ ] Security: `add_chain_account` on a chain with no address needs only the session and the new wallet, so a stolen session could link an attacker address there. Consider the same step-up as reassign (a signature from an existing linked address). Needs a product decision.
- [ ] Design limit: an attacker who can deploy a contract at a victim's counterfactual address on another chain can link that (chain, address) first.
- [ ] Web eslint config ignores several new files (wallet, linking and help components), so they have no lint coverage; remove the ignores and fix what appears.

## 8. Open decisions in the register

- [ ] D-025 eligibility rule values and D-026 issuer routes: the engine and secondary-market tokens are decided (ADR-018); legal policy values and issuer subscription/redemption remain open.
- [ ] D-058 fee caps confirmation; D-059 disclosure copy; D-066 sector list; D-084 joint adoption masking.

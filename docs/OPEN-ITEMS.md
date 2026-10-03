# Bytesac — Open Items

Consolidated list of everything still open after Spec 10 (2026-10-02). Sources: `docs/superpowers/HANDOFF.md` §5/§7, `docs/superpowers/CONTINUATION.md` §7, the decision register (`OPEN` rows) and the Spec 8–10 reviews. Future product scope lives in `docs/domains/FUTURE-PLANS.md`, not here. Tick items as they are closed and rewrite the affected docs in place.

## 1. Accounts, keys and credentials (user actions)

- [ ] Reown project ID (web + mobile).
- [ ] Resend API key and verified sender domain.
- [ ] Twilio Verify service and allowed countries.
- [ ] Alchemy key; confirm the BNB, Arbitrum, Solana and Bitcoin hosts.
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
- [ ] LI.FI with a real key: `toAddress` echo, `svmSponsor` on every Solana leg type, base64 versioned transactions, Bitcoin PSBT encoding and output shape, rounding tolerance.
- [ ] LI.FI hardening (Spec 10.1, ADR-017) with a real key: the no-SOL refusal shape (matched on "SOL" plus balance/rent/fee/gas wording) and whether `svmSponsor` avoids it; the price-impact no-route shape; that code 1001 is what an unfunded wallet gets; the `NOT_PROCESSABLE_REFUND_NEEDED` status mapping; Mayan tool key names (prefix `mayan`); deny-list parameter encoding (repeated parameters); a token flag field in `/v1/tokens`; whether a `FAILED` status with a receiving transaction and token can occur (only `DONE`/`PARTIAL` is recovered); `advanced/routes` without `fromAddress` for Solana sources; analytics `/v2/analytics/transfers` access, timestamp unit (seconds assumed) and pagination. Details in `apps/api/README.md`.
- [ ] Alchemy Bitcoin `/tx/{txid}` and `POST /sendtx/` response shapes.
- [ ] Phantom and Solflare: wallets that add instructions get `TX_MISMATCH` by design.
- [ ] Reown Bitcoin `signPSBT` of the BIP-322 virtual transaction (Xverse, Leather, Unisat, OKX).
- [ ] CoinMarketCap `/v2/cryptocurrency/quotes/latest` shape with a real key; Alchemy `getTokenSupply`; one real token per chain.
- [ ] Gemini forced tool-calling with a real key.
- [ ] Web push end to end in Chrome, Firefox and Safari.
- [ ] Earnings and revenue CSV downloads in a real browser.
- [ ] Small-amount mainnet run of every flow (checklist in `apps/api/README.md`): invest, partial stop, leave, sell, sell former, rebalance (sell → fees → buys), drift fix, buy back, sync, with manager and platform fees.

## 6. Deployment and operations

- [ ] Deploy the BullMQ worker (`start:worker`) with non-evicting Redis.
- [ ] Load balancer must overwrite `X-Forwarded-For` (API trusts only the Next hop).
- [ ] Set `GEO_COUNTRY_HEADER` (for example `CF-IPCountry`) and make the edge strip any client-supplied value of that header; unset means no geo signal (Spec 11).
- [ ] Enforce CSP after the manual wallet E2E; add a CSP report-uri.
- [ ] Choose an ivfflat or hnsw index for pgvector at scale.
- [ ] Linux CI (or a newer Node) to escape the Windows vitest worker crash 3221226505.

## 7. Technical debt (fix opportunistically, don't expand scope)

**Must fix before onboarding real assets**
- [x] CoinMarketCap: one `price: null` id marks the whole uncached batch unavailable.
- [x] `mobile#check-types` fails on `main` (duplicate `@wagmi/core` peer variants in `apps/mobile/src/lib/appkit.tsx`; pnpm dedupe/override).

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
- [ ] Unbounded push tokens per user; Firebase registration tokens deprecated (Installation ID migration is a future plan).
- [ ] `positions.ts` ↔ `rebalance.ts` function-level import cycle; D-071 message duplicated in sell and rebalance.
- [ ] Millisecond race between leg submit and the in-flight guard (bounded by the one-active-operation index).
- [ ] `organization-payout-wallet` web test times out under a parallel full run (passes alone).

**Spec 8**
- [ ] Optional fee-payer `simulateTransaction` check.
- [x] Fully sold positions not auto-closed; sweeps lack per-record isolation.
- [x] Abandoned `IN_PROGRESS` operations keep gas reservations until UTC midnight; a retried gas drop skips its status re-check; a refused drop keeps its reservation.
- [ ] Native EVM received amount is a whole-block balance change; ops leg resolve is not bound to the leg's own transactions; treasury token-account rent is not estimated.
- [ ] Bitcoin wallet never run against a real wallet; EVM approval and main transaction are two prompts.
- [x] Portfolio shows basket slugs rather than names.

**Spec 11**
- [x] A rebalance is refused when a held RWA is structurally non-investable (permissioned, no supported route, no price) because Spec 9 requires the target version investable (scheduled in Spec 12).
- [ ] Data: which RWA tokens have real DEX liquidity through LI.FI and CoinMarketCap ids (no RWA is offered until ops add a route, a market price reference and rules).
- [ ] Token-2022 RWAs: confirm the balance and received-amount readers and the token-account rent estimate against a real RPC (tested with mocks only; the rent estimate over-reserves for a Token-2022 destination; transfer-fee and hook extensions are not read).
- [ ] Each RWA leg quote appends an `eligibility_decisions` row (growth); investability reads CoinMarketCap prices for RWA constituents on every request (60 s cache); a recovery leg to an RWA created while the user became ineligible cannot be quoted; mobile has no declaration form or notices.

**Spec 7**
- [ ] Discovery "Load more" replaces the page; organization filter is an id field; tag filter takes typed keys; instrument/organization name edits refresh only nightly.
- [ ] Assignment ends that keep the lead are not re-indexed until the next refresh; profile hide/unhide email untested; IP-day AI cap counter untested; a skipped first price day can miss a subscription period start.

**Spec 6**
- [x] `VERSION_CONFLICT` compares millisecond timestamps; publish has no slug-collision retry.
- [ ] Version diff omits lead changes; some manager emails not wired; preview/diff routes missing from the role test table; no org-suspended publish test; drafts do not preview would-be disclosures; `listOrgBaskets` unpaginated.

**Spec 5**
- [ ] Polygon on-chain verification and a Bitcoin data provider for the registry; a DRAFT route on a later-retired deployment can be cascade-approved; a live RWA issuer can be swapped; cascaded item events lack `from_status`; Redis read failures not logged.

**Specs 1–4**
- [x] A concurrent invite during sign-in can abort that sign-in with a 500 (savepoint); a rejected invite consumes the 20/h invite budget.
- [ ] `/me.organizations` `displayName` uses the latest version name.
- [x] Spec 2 ops form offers "Not approved" for a proven approved application; Spec 3 orphan final R2 copy on DB failure after copy.
- [x] Double-click contact add can show 404.
- [ ] Resend countdown resets on remount; logout awaits wallet disconnect; iOS keyboard double-adjust check; ops/app Switch hit area on device; `@wagmi/connectors` pinned 6.2.0 until Reown RN supports wagmi 3.

## 8. Open decisions in the register

- [ ] D-025 eligibility rule values and D-026 issuer routes: the engine and secondary-market tokens are decided (ADR-018); legal policy values and issuer subscription/redemption remain open.
- [ ] D-058 fee caps confirmation; D-059 disclosure copy; D-066 sector list; D-084 joint adoption masking.

# Spec 11 — Secondary-Market RWAs and the Eligibility Engine (Design)

- **Date:** 2026-10-03
- **Status:** Approved in conversation (2026-10-03); written spec pending user review
- **Series:** Spec 11 — after Specs 1–10.1 (ADR-013..ADR-017)
- **Builds on:** Spec 5 (registry: instruments, deployments, routes, eligibility rules, prices), Spec 6 (baskets, disclosure templates), Spec 7 (discovery), Spec 8 (investability D-069, plans, legs), Spec 9 (rebalance, repair, sell), Spec 10/10.1 (fees, LI.FI hardening, recovery legs).
- **Sources:** `docs/source/Assets-Registry.txt` (RWA onboarding, §6 RWA execution routes, §7 eligibility and compliance); `docs/source/First-Investment,-Rebalancing,-Drift-&-Fix.txt` §5.6, §9.5, Case 3/4, Scenarios D and J, §33; `docs/source/User-Detailed-Features.txt` §9; D-025, D-026, D-069; ADR-002, ADR-010.

## 1. Intent

Let baskets hold **permissionless tokenized RWAs** (treasuries, money-market funds, tokenized equities/ETFs and the other `TOKENIZED_*` types) that trade on chain, bought and sold through LI.FI exactly like crypto, and gate every RWA acquisition and sale with a **context eligibility engine** (user + instrument + route + jurisdiction + investor status + action) whose decisions are recorded for audit. No legal policy value is invented: ops enter rules from provider terms.

**Success criteria**
1. An RWA is offered to a user only when the engine returns `ALLOWED` for that user, instrument, route and action; every RWA leg stores its decision.
2. With no matching rule an RWA is `RESTRICTED`; crypto and stablecoins behave exactly as before.
3. Existing holders are never forced to sell; exits follow the `sell` rules and never block the other assets.
4. No issuer, subscription, redemption or asynchronous settlement route is ever offered in this release.

## 2. Decisions (this brainstorm)

| # | Topic | Decision |
|---|---|---|
| 1 | Routes | Secondary-market RWA tokens through LI.FI/DEX only (route method `swap` or `secondary_market`, synchronous). Issuer subscription/redemption and async settlement are future plans. |
| 2 | User data | Self-declared country of residence and investor status (attested, versioned, audited, expires after 365 days) plus a geo-IP signal; a mismatch → `REVIEW_REQUIRED`; `KYC_REQUIRED` blocks (no KYC vendor). |
| 3 | Rule evaluation | Deny by default for RWAs; most specific rule wins (route over instrument, exact country over `*`); strictest outcome on a tie (`RESTRICTED` > `KYC_REQUIRED` > `REVIEW_REQUIRED` > `ALLOWED`); rules gain `investorStatuses`; crypto/stablecoins without a rule stay `ALLOWED`; decisions recorded per leg. |
| 4 | Ineligible users | Buys blocked (invest, rebalance, repair refused with the reason), holdings kept, sells follow `sell` rules (a restricted asset is left out of the sell, the rest sells), re-check at each leg quote. Rebalancing without the blocked asset is a future plan (detailed in FUTURE-PLANS). |
| 5 | Pricing | An RWA is investable only with an `ACTIVE` CoinMarketCap market price (5-minute freshness); NAV is display only. NAV and LI.FI-price fallbacks are future plans. |
| 6 | Permissioned tokens | Release 1 offers only permissionless tokens; a deployment flagged `permissioned` is never investable. Ops-recorded and on-chain allowlist support are future plans. |

## 3. Out of scope (recorded in `docs/domains/FUTURE-PLANS.md`, "RWAs and eligibility (deferred from Spec 11)")

Issuer subscription/redemption and async settlement states; a KYC vendor; rebalance without the blocked asset (Q4 option B, detailed); NAV and LI.FI `priceUSD` price fallbacks (Q5 B/C); permissioned tokens via ops-recorded or on-chain allowlists (Q6 B/C); platform inventory route; conventional broker-held ETFs/stocks (custody ADR).

## 4. Investability (D-069 rewritten)

A constituent is investable when its instrument is `ACTIVE` and either (crypto/stablecoin, unchanged) or (an RWA type — `RWA_ASSET_TYPES`, i.e. every `TOKENIZED_*`) with: an `ACTIVE` deployment whose `permissioned` flag is false; an `ACTIVE` route with method `swap` or `secondary_market` whose provider is LI.FI; a LI.FI connection from USDC on Solana (cached 1 h, as today); an `ACTIVE` CoinMarketCap market price reference. Solana deployments with token standard `spl_token_2022` are investable only if the balance and received-amount readers handle Token-2022 accounts (verified in implementation; otherwise reason `TOKEN_2022_UNSUPPORTED`). New investability reasons: `RWA_PERMISSIONED`, `RWA_ROUTE_UNSUPPORTED`, `RWA_PRICE_REQUIRED`, `TOKEN_2022_UNSUPPORTED`. Per signed-in user, each RWA constituent is evaluated with action `acquire`; any outcome other than `ALLOWED` makes the basket not investable for that user with reason `NOT_ELIGIBLE_ASSET` per asset (message from the engine).

## 5. User eligibility profile

- `eligibility_declarations` (append-only): `id, user_id, country (ISO 3166-1 alpha-2), investor_status (retail | accredited | qualified | professional), attestation_version, ip_country?, created_at`; the latest row is current; it expires 365 days after `created_at`.
- `POST /v1/me/eligibility` (session; rate-limited 10/day) records a declaration with the request's IP country; `GET /v1/me/eligibility` returns the current one (or null, with `expired` flag). Audited `eligibility.declared`.
- IP country: the request header named by env `GEO_COUNTRY_HEADER` (for example `CF-IPCountry`), trusted only when set (the deployment must strip it from clients at the edge); unset → no signal. Values `XX`/`T1` or missing are ignored.
- Attestation text: `ELIGIBILITY_ATTESTATION = { version: "2026-10-03", text: "…" }` in `@repo/validator` (placeholder wording; compliance to confirm).
- Required only when a basket contains an RWA: the invest wizard, rebalance review and repair panel show an inline declaration form when the API returns `DECLARATION_REQUIRED`.

## 6. Engine (`@repo/validator`, pure)

`evaluateEligibility(i: { assetType; instrumentId; routeId; action: "acquire" | "sell"; rules: Rule[]; declaration: { country; investorStatus; createdAt } | null; ipCountry: string | null; now: Date }): { outcome: "ALLOWED" | "RESTRICTED" | "KYC_REQUIRED" | "REVIEW_REQUIRED" | "DECLARATION_REQUIRED"; ruleIds: string[]; reason: string }`.

1. Crypto/stablecoin: matching rules apply as below; none → `ALLOWED` (no declaration needed).
2. RWA: no declaration or expired → `DECLARATION_REQUIRED`. `ipCountry` set and ≠ declared country → `REVIEW_REQUIRED` (reason `IP_COUNTRY_MISMATCH`).
3. Candidate rules: `ACTIVE`, same instrument, `routeId` null or equal, `jurisdiction` equal to the declared country or `*`, `action` equal, `investorStatuses` empty or containing the user's status.
4. Most specific tier wins: (route + country) > (route + `*`) > (instrument + country) > (instrument + `*`); within the tier the strictest outcome wins.
5. No candidate: RWA → `RESTRICTED` (reason `NO_RULE`).

`DECLARATION_REQUIRED` is returned to the client but never stored as a leg decision (no plan is created).

## 7. Enforcement points

| Point | Action evaluated | Behavior when not `ALLOWED` |
|---|---|---|
| Investability / basket page | `acquire`, each RWA constituent | basket not investable for the user, reason per asset |
| Invest plan | `acquire`, each RWA leg | 409 `NOT_ELIGIBLE` with reasons (or `DECLARATION_REQUIRED`) |
| Rebalance (apply, drift fix) | `acquire`, each RWA buy | plan refused with the reason; Skip / Keep custom / Leave remain |
| Repair buy-back | `acquire` | refused; Sync remains |
| Sell to USDC / Sell former | `sell`, each RWA asset | `RESTRICTED`/`KYC_REQUIRED`/`REVIEW_REQUIRED` assets are left out with a notice ("You can't sell X through Bytesac in your region; it stays in your wallet"); the rest sells; if nothing is left → 409 `NOT_ELIGIBLE` |
| Leg quote (every RWA leg, recovery legs to an RWA target) | the leg's action | 409 `NOT_ELIGIBLE`; earlier settled legs stand |

`eligibility_decisions` (append-only): `id, operation_id, leg_id?, user_id, instrument_id, route_id?, action, outcome, rule_ids uuid[], declaration_id?, ip_country?, evaluated_at`; written at plan time for each RWA leg and at each RWA leg quote. Sell exclusions are recorded with `leg_id` null.

## 8. Registry and manager side

- `instrument_deployments.permissioned boolean not null default false`, editable by `ops_admin` (audited); `eligibility_rules.investor_statuses text[] not null default '{}'` in the ops rule editor (values from the four statuses).
- Ops review shows a warning for an RWA instrument without any `ACTIVE` eligibility rule ("Restricted everywhere until rules exist").
- Basket validation (wizard and review) adds warnings for RWA constituents that are not investable for structural reasons (`RWA_PERMISSIONED`, `RWA_ROUTE_UNSUPPORTED`, `RWA_PRICE_REQUIRED`, `TOKEN_2022_UNSUPPORTED`); disclosure templates by asset type keep being pinned (Spec 6).
- Basket detail and discovery cards show, for a signed-in user with a declaration, "Not available in your region / for your investor status" when any RWA constituent is not `ALLOWED`; signed-out users see "Some assets have eligibility requirements". Discovery never hides such baskets.

## 9. Data model (migration `0015_rwa_eligibility.sql`)

`eligibility_declarations`, `eligibility_decisions`, `instrument_deployments.permissioned`, `eligibility_rules.investor_statuses`, enum `investor_status`. Grants SELECT/INSERT/UPDATE, RLS as earlier migrations; no DELETE.

## 10. API and errors

New error code `DECLARATION_REQUIRED` (409). `NOT_ELIGIBLE` (existing) carries `details.reasons: { instrumentId, outcome, reason }[]`. Investability gains the new reasons and a per-asset `eligibility` block. Endpoints in §5; ops: deployment `permissioned` edit, rule `investorStatuses`.

## 11. Web (no mobile)

Profile "Eligibility" section (country select, investor status with plain explanations, attestation checkbox, expiry date); inline declaration form in invest, rebalance and repair flows on `DECLARATION_REQUIRED`; basket page per-asset eligibility notices; discovery badge; sell dialog notice for excluded assets; ops: `permissioned` toggle, `investorStatuses` multi-select, review warnings.

## 12. Security & safety

Eligibility is evaluated server-side at plan and quote time; the client only displays. Declarations are append-only and audited; the geo header is trusted only when configured. Deny-by-default for RWAs. No forced sales; self-custody keeps restricted assets in the user's wallet. Tests mock LI.FI, RPC, CoinMarketCap and wallets.

## 13. Testing

Engine: tier precedence, strictest-in-tier, investor status filter, `*` vs country, deny by default for RWA, crypto unchanged, declaration missing/expired, IP mismatch. Investability: each RWA requirement and reason; per-user `NOT_ELIGIBLE_ASSET`. Enforcement: invest refused/allowed, rebalance buy refused, repair refused (sync works), sell excludes a restricted asset and sells the rest, all-restricted sell refused, rule change between plan and quote → 409, recovery leg to an RWA re-checked, decisions recorded. Declarations: append-only, rate limit, audit, geo header handling. Ops: permissioned and investorStatuses edits audited; review warning. Web: declaration form and prompts, badges, sell notice.

## 14. Execution shape

Five tasks: (1) data + validator (engine, declarations, decisions, schemas, attestation); (2) investability and enforcement wiring (invest, rebalance, repair, sell, leg quote, recovery) + Token-2022 reader check; (3) user and ops APIs (declarations, permissioned, investorStatuses, review warnings, basket/discovery eligibility fields); (4) web; (5) web tests and docs (ADR-018; D-025, D-026, D-069 rewritten; D-100+; ASSET-REGISTRY, USER-FEATURES, INVESTMENT docs; OPEN-ITEMS compliance items).

## 15. Open items

Real eligibility rule values and investor-status definitions per jurisdiction (compliance/legal); attestation wording; edge configuration for `GEO_COUNTRY_HEADER` (strip client-supplied values); which RWA tokens have real DEX liquidity and CoinMarketCap ids; Token-2022 RWA support confirmation; legal review of offering RWAs on self-declaration.

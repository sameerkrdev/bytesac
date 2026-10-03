# Spec 11 — Secondary-Market RWAs and the Eligibility Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** few large tasks (five here), tests per task, **one review at the end** (plus one fix wave). Full code only where logic is subtle (the engine); otherwise paths, interfaces, exact names/values and concrete test cases pointing at existing patterns.

**Goal:** Permissionless tokenized RWAs become investable through LI.FI like crypto, gated by a context eligibility engine (declared country + investor status + geo-IP signal, deny by default for RWAs) at every acquire/sell point, with every RWA leg decision recorded.

**Architecture:** migration `0015_rwa_eligibility.sql`; `@repo/validator` `eligibility.ts` (engine, statuses, attestation, schemas); API `services/eligibility.ts` (declarations, `evaluateFor` loading rules/declaration and writing decisions), `services/investability.ts` (RWA requirements, per-user acquire check), enforcement in `services/{operations,rebalance}.ts` (invest, sell, rebalance, repair, leg quote, recovery); request meta gains `ipCountry` from `GEO_COUNTRY_HEADER`; web profile eligibility, inline declaration form, basket/discovery notices, sell notice, ops fields.

**Tech Stack:** Express 5, Drizzle + Postgres 17, Next.js 16, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-rwa-eligibility-design.md`

## Global Constraints

- Follow existing patterns: `services/investability.ts` (`getInvestability`, reasons with `instrumentId`), `services/operations.ts` (`createInvestPlan`, `createSellPlan`, `quoteLeg`, `planQuote`), `services/rebalance.ts` (`createRebalancePlan`, `createRepairPlan`, recovery creation in `services/positions.ts`), `services/assets.ts` (eligibility rule CRUD, deployment edits, review warnings), `middleware/{auth,rate-limit}.ts`, request meta (`RequestMeta`), `services/audit.ts`; tests `apps/api/test/execution/*`, `apps/api/test/assets/*`; web `components/{invest,portfolio,profile,baskets,discovery,ops}/*`.
- **No extra functions:** no one-caller helpers or wrappers; `evaluateEligibility` (pure, validator) and `evaluateFor` (API, loads data + records) are each used by several callers. Invoke `ponytail`.
- Values exactly: investor statuses `retail, accredited, qualified, professional`; declaration expiry 365 days; `ELIGIBILITY_ATTESTATION.version = "2026-10-03"`; declaration rate limit 10 per user per day; outcomes `ALLOWED, RESTRICTED, KYC_REQUIRED, REVIEW_REQUIRED` (stored) plus `DECLARATION_REQUIRED` (client only); reasons `NO_RULE, IP_COUNTRY_MISMATCH, RULE` (matched rule), investability reasons `RWA_PERMISSIONED, RWA_ROUTE_UNSUPPORTED, RWA_PRICE_REQUIRED, TOKEN_2022_UNSUPPORTED, NOT_ELIGIBLE_ASSET`; error codes `DECLARATION_REQUIRED` (409, new) and `NOT_ELIGIBLE` (409, existing, `details.reasons: { instrumentId, outcome, reason }[]`); env `GEO_COUNTRY_HEADER` (optional, header name); ignored IP values `XX`, `T1`, empty; RWA route methods allowed: `swap`, `secondary_market` with provider LI.FI; sell notice text "You can't sell {symbol} through Bytesac in your region; it stays in your wallet."; signed-out basket notice "Some assets have eligibility requirements".
- Crypto and stablecoins: unchanged behavior when no rule matches (no declaration needed).
- **Safety:** eligibility is evaluated server-side at plan and at every RWA leg quote; never forced sales; deny by default for RWAs; declarations append-only and audited; the geo header is trusted only when the env names it. **Tests mock LI.FI, RPC, CoinMarketCap and wallets.**
- Runtime DB role: SELECT/INSERT/UPDATE (no DELETE). Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`, or anything under `.superpowers/`. No mobile changes.
- Known issues: Windows vitest crash 3221226505 → re-run the crashed file alone; vitest in the foreground with stdin `< /dev/null`; no timers/monitors; `mobile#check-types` fails on `main`; never run two suites concurrently; full gate with `--concurrency=2` (memory).

## Review Focus

1. **Rule changes between plan and signature:** ops set an RWA to `RESTRICTED` after the user planned an invest; quoting that leg returns 409 `NOT_ELIGIBLE`, records the decision, and earlier settled legs stand; test in Task 2.
2. **Sell with a mix of restricted and allowed RWAs:** restricted ones are excluded with the notice and a decision row (`leg_id` null), the rest sells; all restricted → 409 `NOT_ELIGIBLE`; test in Task 2.
3. **Spoofed geo header when `GEO_COUNTRY_HEADER` is unset:** the header is ignored (no `REVIEW_REQUIRED`); with it set, a mismatch blocks; test in Task 1/3.
4. **Crypto-only basket with no declaration:** invest works exactly as before (no `DECLARATION_REQUIRED`); test in Task 2.
5. **Expired declaration (366 days):** RWA flows return `DECLARATION_REQUIRED`; a new declaration unblocks; test in Task 2.

---

## File Structure

```
packages/validator/src/eligibility.ts (+ eligibility.test.ts)  engine, statuses, attestation, schemas
packages/validator/src/{errors,assets,execution,index}.ts       DECLARATION_REQUIRED; rule investorStatuses; investability reasons; deployment permissioned
packages/db/src/schema/{eligibility,assets,index}.ts           eligibility_declarations, eligibility_decisions; permissioned; investor_statuses
packages/db/migrations/0015_rwa_eligibility.sql
apps/api/src/services/eligibility.ts                            declarations, evaluateFor, recordDecisions
apps/api/src/services/{investability,operations,rebalance,positions,assets}.ts
apps/api/src/middleware/* (request meta ipCountry), apps/api/src/env.ts (GEO_COUNTRY_HEADER)
apps/api/src/routes/{me,ops,assets,public,baskets}.ts
apps/api/test/eligibility/{engine-wiring,declarations,enforcement}.test.ts
packages/api-client/src/client.ts
apps/web/components/profile/eligibility-section.tsx, apps/web/components/eligibility/declaration-form.tsx, basket/discovery notices, sell dialog notice, ops fields
apps/web/test/{eligibility,rwa-notices}.test.tsx
docs/…                                                          ADR-018, D-025/D-026/D-069 rewritten, D-100+, domain docs, OPEN-ITEMS
```

---

### Task 1: Data, validator and engine

**Files:** create `packages/validator/src/eligibility.ts` + test, `packages/db/src/schema/eligibility.ts`, migration `0015_rwa_eligibility.sql`; modify `packages/validator/src/{errors,assets,execution,index}.ts`, `packages/db/src/schema/{assets,index}.ts`, `apps/api/src/env.ts`.

**Produces:** `INVESTOR_STATUSES`, `ELIGIBILITY_ATTESTATION`, `DECLARATION_TTL_DAYS = 365`, `evaluateEligibility(i): EligibilityResult`, schemas `eligibilityDeclarationInputSchema { country: /^[A-Z]{2}$/, investorStatus, attestationVersion (must equal current) }`, `eligibilityDeclarationViewSchema`, rule input `investorStatuses` (array of statuses, default `[]`), deployment `permissioned`; tables `eligibilityDeclarations`, `eligibilityDecisions`, `instrumentDeployments.permissioned`, `eligibilityRules.investorStatuses`.

- [ ] **Step 1: Failing tests** (`eligibility.test.ts`): crypto without rules → `ALLOWED` without a declaration; RWA without declaration → `DECLARATION_REQUIRED`; expired (366 days) → `DECLARATION_REQUIRED`; IP mismatch → `REVIEW_REQUIRED`/`IP_COUNTRY_MISMATCH`; IP `XX`/null → ignored; no rule → `RESTRICTED`/`NO_RULE`; route+country beats instrument+country even if the latter is stricter; within a tier `RESTRICTED` beats `ALLOWED`; `*` used only when no exact-country rule in the same route/instrument level; investorStatuses filter (accredited-only rule ignored for retail → falls to the next tier or `NO_RULE`); `RETIRED` rules ignored; action mismatch ignored.
- [ ] **Step 2: Run** `pnpm --filter @repo/validator test` → FAIL.
- [ ] **Step 3: Implement the engine** (exact):

```ts
export const INVESTOR_STATUSES = ["retail", "accredited", "qualified", "professional"] as const;
export type InvestorStatus = (typeof INVESTOR_STATUSES)[number];
export const DECLARATION_TTL_DAYS = 365;
const SEVERITY = { RESTRICTED: 3, KYC_REQUIRED: 2, REVIEW_REQUIRED: 1, ALLOWED: 0 } as const;
type StoredOutcome = keyof typeof SEVERITY;
export interface EligibilityRuleInput { id: string; instrumentId: string; routeId: string | null; jurisdiction: string; action: "acquire" | "sell" | "redeem" | "transfer"; outcome: StoredOutcome; investorStatuses: InvestorStatus[]; status: "DRAFT" | "ACTIVE" | "RETIRED" }
export interface EligibilityResult { outcome: StoredOutcome | "DECLARATION_REQUIRED"; ruleIds: string[]; reason: "RULE" | "NO_RULE" | "IP_COUNTRY_MISMATCH" | "DECLARATION_REQUIRED" | "NO_RULE_CRYPTO" }

export function evaluateEligibility(i: {
  rwa: boolean; instrumentId: string; routeId: string | null; action: "acquire" | "sell"; rules: EligibilityRuleInput[];
  declaration: { country: string; investorStatus: InvestorStatus; createdAt: Date } | null; ipCountry: string | null; now: Date;
}): EligibilityResult {
  const fresh = i.declaration && i.now.getTime() - i.declaration.createdAt.getTime() <= DECLARATION_TTL_DAYS * 86_400_000 ? i.declaration : null;
  if (i.rwa && !fresh) return { outcome: "DECLARATION_REQUIRED", ruleIds: [], reason: "DECLARATION_REQUIRED" };
  const ip = i.ipCountry && !["XX", "T1"].includes(i.ipCountry) ? i.ipCountry : null;
  if (i.rwa && ip && ip !== fresh!.country) return { outcome: "REVIEW_REQUIRED", ruleIds: [], reason: "IP_COUNTRY_MISMATCH" };
  const candidates = i.rules.filter((r) => r.status === "ACTIVE" && r.instrumentId === i.instrumentId && r.action === i.action
    && (r.routeId === null || r.routeId === i.routeId)
    && (r.jurisdiction === "*" || (fresh !== null && r.jurisdiction === fresh.country))
    && (r.investorStatuses.length === 0 || (fresh !== null && r.investorStatuses.includes(fresh.investorStatus))));
  // Tiers, most specific first: route+country, route+*, instrument+country, instrument+*.
  const tiers = [
    candidates.filter((r) => r.routeId !== null && r.jurisdiction !== "*"), candidates.filter((r) => r.routeId !== null && r.jurisdiction === "*"),
    candidates.filter((r) => r.routeId === null && r.jurisdiction !== "*"), candidates.filter((r) => r.routeId === null && r.jurisdiction === "*"),
  ];
  const tier = tiers.find((t) => t.length > 0);
  if (!tier) return i.rwa ? { outcome: "RESTRICTED", ruleIds: [], reason: "NO_RULE" } : { outcome: "ALLOWED", ruleIds: [], reason: "NO_RULE_CRYPTO" };
  const worst = tier.reduce((w, r) => (SEVERITY[r.outcome] > SEVERITY[w.outcome] ? r : w));
  return { outcome: worst.outcome, ruleIds: tier.filter((r) => r.outcome === worst.outcome).map((r) => r.id), reason: "RULE" };
}
```

  Note: for crypto without a declaration, a country-specific rule cannot match (no country); only `*` rules apply — intended.
- [ ] **Step 4: Schema + migration.** `investor_status` enum; `eligibility_declarations` (`id, userId → users, country char(2), investorStatus, attestationVersion text, ipCountry char(2)?, createdAt`; index `(user_id, created_at desc)`); `eligibility_decisions` (`id, operationId?, legId?, userId, instrumentId, routeId?, action eligibility_action, outcome eligibility_outcome, ruleIds uuid[] not null default '{}', declarationId?, ipCountry?, evaluatedAt`; index `(operation_id)`, `(user_id, evaluated_at)`); `instrument_deployments.permissioned boolean not null default false`; `eligibility_rules.investor_statuses investor_status[] not null default '{}'`. Generate (`--name=rwa_eligibility`), grants/RLS like `0014`, regenerate → "No schema changes", migrate. Env `GEO_COUNTRY_HEADER: str({ default: "" })`. Validator: `DECLARATION_REQUIRED` error code; rule schema `investorStatuses`; deployment `permissioned`; investability reasons.
- [ ] **Step 5: Run** validator tests; `pnpm turbo run lint check-types --filter=@repo/validator --filter=@repo/db --filter=api --filter=web` → PASS. **Commit** `feat(db,validator): eligibility engine, declarations and decisions`.

---

### Task 2: Investability and enforcement

**Files:** create `apps/api/src/services/eligibility.ts`, `apps/api/test/eligibility/enforcement.test.ts`; modify `apps/api/src/services/{investability,operations,rebalance,positions}.ts`, request-meta middleware (`ipCountry`).

**Produces:** `evaluateFor(conn, i: { userId; ipCountry: string | null; items: { instrumentId; assetType; routeId: string | null; action: "acquire" | "sell" }[] }): Promise<Map<instrumentId, EligibilityResult & { declarationId: string | null }>>` (loads `ACTIVE` rules for the instruments and the latest declaration once); `recordDecisions(tx, rows)`; `RequestMeta.ipCountry`.

- [ ] **Step 1: Failing tests** (`enforcement.test.ts`, seed an RWA instrument `TOKENIZED_TREASURY` with a permissionless ACTIVE deployment, ACTIVE LI.FI `secondary_market` route, CoinMarketCap price, and rules): investability reasons for permissioned (`RWA_PERMISSIONED`), `subscription` route only (`RWA_ROUTE_UNSUPPORTED`), no market price (`RWA_PRICE_REQUIRED`); per user `NOT_ELIGIBLE_ASSET` when restricted; **crypto-only basket without declaration invests as before**; RWA basket without declaration → invest 409 `DECLARATION_REQUIRED`; with an allowing declaration → plan created and an `eligibility_decisions` row per RWA leg; **expired declaration** → `DECLARATION_REQUIRED`, new declaration unblocks; rebalance buying a restricted RWA → 409 `NOT_ELIGIBLE` with reasons; repair buy-back restricted → 409, sync still works; **sell with one restricted and one allowed RWA** → plan sells the allowed one, `excluded: [{ instrumentId, symbol, notice }]` in the response, decision row with `leg_id` null; all restricted → 409 `NOT_ELIGIBLE`; **rule changed to RESTRICTED after planning** → quoting that leg 409 `NOT_ELIGIBLE`, decision recorded, an earlier settled leg stays settled; recovery leg to an RWA target is re-checked at quote; geo: `GEO_COUNTRY_HEADER` unset → header ignored; set and mismatching → `REVIEW_REQUIRED`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Request meta: when `env.GEO_COUNTRY_HEADER` is set, `ipCountry = req.get(header)?.toUpperCase()` if it matches `/^[A-Z]{2}$/`, else null; never read the header otherwise. `getInvestability`: replace the `RWA_NOT_SUPPORTED` refusal with the RWA requirements (permissioned, route method in `swap|secondary_market` with provider LI.FI, ACTIVE market price reference, Token-2022 check: confirm `solanaBalance`/`solanaReceived` read Token-2022 accounts (they must query by mint across both token programs); if they do not, add `TOKEN_2022_UNSUPPORTED` for `spl_token_2022` deployments and note it in the report), carry `routeId` and `assetType` on each `Constituent`; with a user, `evaluateFor` (action `acquire`) and add `NOT_ELIGIBLE_ASSET` reasons. Invest/rebalance/repair: map `DECLARATION_REQUIRED` → 409 `DECLARATION_REQUIRED`, other non-ALLOWED → 409 `NOT_ELIGIBLE` with `details.reasons`; record decisions for RWA legs in the plan transaction. Sell: evaluate `sell` per RWA holding before quoting; exclude non-ALLOWED (response `excluded[]`), record decisions; nothing left → 409 `NOT_ELIGIBLE`. `quoteLeg`: for a leg whose acquired (buy) or sold (sell) deployment is an RWA, re-evaluate and record; non-ALLOWED → 409. Recovery creation/quote: same for an RWA target.
- [ ] **Step 4: Run** the file, then `test/execution/{investability,invest,sell,rebalance,repair,recovery,lifi-hardening}.test.ts` and `test/fees/plan-fees.test.ts` one at a time → PASS; lint + check-types. **Commit** `feat(api): RWA investability and eligibility enforcement`.

---

### Task 3: User and ops APIs

**Files:** create `apps/api/test/eligibility/declarations.test.ts`; modify `apps/api/src/services/{eligibility,assets,public-baskets,discovery}.ts`, `apps/api/src/routes/{me,ops,assets,public}.ts`, `apps/api/src/middleware/rate-limit.ts`, `packages/api-client/src/client.ts`, `apps/api/README.md`.

- [ ] **Step 1: Failing tests:** `POST /v1/me/eligibility` validates country, status and current attestation version (old version → `VALIDATION_FAILED`), appends a row with `ipCountry` from meta, audit `eligibility.declared`, 11th in a day → 429; `GET /v1/me/eligibility` returns the latest with `expiresAt` and `expired`; ops rule editor accepts `investorStatuses` (audited); `ops_admin` sets `permissioned` (audited; reviewer 403); review view shows the warning for an RWA without ACTIVE rules; public basket detail returns `eligibility: { requirements: boolean }` signed out and per-asset outcomes signed in (session optional); discovery card gains `hasEligibilityRequirements`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** per spec §5, §8, §10. **Step 4: Run** the file + `test/assets/*`, `test/discovery/*`, `test/baskets/public.test.ts` one at a time → PASS; lint + check-types; README: `GEO_COUNTRY_HEADER` (edge must strip client-supplied values). **Commit** `feat(api): eligibility declarations, ops rule and deployment fields, basket eligibility info`.

---

### Task 4: Web

**Files:** create `apps/web/components/profile/eligibility-section.tsx`, `apps/web/components/eligibility/declaration-form.tsx`; modify profile page, invest wizard, rebalance review, repair panel, exit dialogs (excluded notice), basket page and discovery card (notices), ops rule editor (`investorStatuses` multi-select), ops deployment editor (`permissioned` toggle), ops review (warning), app-core error copy (`DECLARATION_REQUIRED`).

- [ ] **Step 1:** `declaration-form.tsx`: country select (ISO list from `Intl.DisplayNames`), investor status radio with one-line plain explanations, attestation text and checkbox, submit → `api.declareEligibility`; used by the profile section and inline on `DECLARATION_REQUIRED` in invest, rebalance and repair (after saving, retry the plan request).
- [ ] **Step 2:** Basket page: per RWA asset outcome notice ("Not available in your region / for your investor status", "Identity verification required — not available yet", "Needs review — contact support"); signed out: "Some assets have eligibility requirements". Discovery card badge. Sell dialog: list `excluded[]` with the exact notice text.
- [ ] **Step 3:** Ops: `investorStatuses` multi-select in the rule editor, `permissioned` toggle (`ops_admin`), review warning text.
- [ ] **Step 4: Run** `pnpm --filter web lint check-types build` and `pnpm --filter web test < /dev/null` → PASS. **Commit** `feat(web): eligibility declaration, RWA notices and ops fields`.

---

### Task 5: Web tests and docs

- [ ] **Step 1: Web tests** (`eligibility`, `rwa-notices`): declaration form validation and submit; inline prompt then retry; profile shows expiry; basket notices per outcome and signed-out text; discovery badge; sell excluded notice; ops multi-select and permissioned toggle (admin only). Run `pnpm --filter web test < /dev/null` → PASS. Commit `test(web): eligibility and RWA notices`.
- [ ] **Step 2: Docs (rewrite in place):** new `docs/decisions/ADR-018-RWA-ELIGIBILITY.md` (secondary-market only, engine semantics, declarations, geo signal, enforcement table, pricing, permissioned, deferred options); `DECISION-REGISTER.md` D-025 (engine decided), D-026 (secondary-market only in release 1; subscription/redemption future), D-069 (RWA investability), new D-100..; `docs/domains/{ASSET-REGISTRY,USER-FEATURES,INVESTMENT-REBALANCING-DRIFT-FIX,BASKET-CREATION}.md`, `ARCHITECTURE.md`; `docs/OPEN-ITEMS.md` (compliance: real rule values and investor-status definitions per jurisdiction, attestation wording, legal review of self-declaration; ops: `GEO_COUNTRY_HEADER` edge config; data: RWA tokens with DEX liquidity and CoinMarketCap ids; Token-2022 result). FUTURE-PLANS already holds the deferred options (committed with the spec) — verify, do not duplicate. Commit `docs: spec 11 RWAs and eligibility`.
- [ ] **Step 3: Full gate** `pnpm turbo run lint check-types test build --continue --concurrency=2 < /dev/null` (re-run crashed api files alone; known `mobile#check-types`) → report.

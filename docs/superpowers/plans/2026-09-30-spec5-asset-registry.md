# Spec 5 — Asset Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** four large tasks, tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle; everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Ops draft, verify, review and run the lifecycle of instruments with deployments, routes, eligibility rules and price references; signed-in users read `ACTIVE` assets with CoinMarketCap/NAV prices. Nothing executes or moves assets.

**Architecture:** New `@repo/db` schema `assets.ts` + migration `0007_assets.sql`; enums, transition maps, requirement keys and schemas in `@repo/validator` (`assets.ts`); API services `services/assets.ts` (CRUD + verification), `services/asset-review.ts` (submit/decision/lifecycle), `services/pricing.ts`; providers `evm-rpc.ts` (extended), `solana-rpc.ts`, `coinmarketcap.ts`; ops routes in `routes/ops.ts`, session read routes in new `routes/assets.ts`; web ops pages under `/ops/assets`.

**Tech Stack:** Express 5, Drizzle 0.45 + Postgres, zod (via `@repo/validator`), http-errors, viem (installed), ioredis (installed, `redis` export in `middleware/rate-limit.ts`), rate-limiter-flexible, envalid, Next.js 16, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-30-asset-registry-design.md`

## Global Constraints

- Follow Spec 2–4 patterns exactly: `services/organization-review.ts` (`OpsCtx` from `services/applications.ts`, `cursorSchema` pagination, self-review 403 under the row lock, decision + event + audit in one tx), `services/audit.ts` `writeAudit`, `middleware/auth.ts` `requireSession`/`requireRole("ops_reviewer" | "ops_admin")`, `middleware/validate.ts`, `middleware/rate-limit.ts` (`limits`, `consume`, `redis`), `providers/evm-rpc.ts` (Alchemy hosts, `VERIFIER_UNAVAILABLE` classification), `services/wallets.ts` `canonicalizeAddress`, tests in `apps/api/test/organizations/*`, `apps/api/test/members/*`, `apps/api/test/helpers/*`; web ops pages `apps/web/app/(ops)/ops/organizations/*`, `components/ops/organizations-table.tsx`, `organization-review.tsx`, `transition-form.tsx`, `ops-error.tsx`.
- **No extra functions**: no one-caller helpers, no wrappers around library calls. Invoke the `ponytail` skill.
- Official docs first: CoinMarketCap `GET /v2/cryptocurrency/quotes/latest` (header `X-CMC_PRO_API_KEY`, response shape `data[id].quote.USD.{price,last_updated}`), Alchemy Solana endpoint + `getTokenSupply`, viem `multicall`/`readContract` + `erc20Abi`, Drizzle partial unique indexes, Next 16 App Router.
- Asset chains exactly: `solana`, `ethereum`, `base`, `bnb`, `arbitrum`, `polygon`, `bitcoin`. The auth `chainSchema` stays unchanged. On-chain verification only for `ethereum`, `base`, `bnb`, `arbitrum` (EVM ERC-20) and `solana` (SPL); everything else manual with `source_url`.
- Enum values exactly as spec §4 (asset types, token standards, instrument/item/rule statuses, execution methods, processing models, eligibility actions/outcomes, price kinds/providers, provider kinds, event kinds).
- Only `ops_admin` decides and runs lifecycle actions; `decided_by_user_id` must differ from `submitted_by_user_id` → 403 `FORBIDDEN` "You can't review a submission you made.".
- New error code exactly: `DEPLOYMENT_EXISTS` (409, "This token is already registered."). Reuse `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `REQUIREMENTS_INCOMPLETE`, `VERIFIER_UNAVAILABLE`.
- Locked-field message exactly: "Retire this item and add a new one to change it." (409 `INVALID_TRANSITION`).
- Pricing: Redis key `price:cmc:<cmcId>`, TTL 60 s, `stale` when older than 5 minutes; CMC timeout 5 s; missing `COINMARKETCAP_API_KEY` or provider failure ⇒ `status: "unavailable"`, never an error to the caller.
- Rate limits: ops mutations `limits.opsUser` (existing); deployment verify 30/h per ops user (new `limits.assetVerifyUser`).
- Session read API returns public fields only (spec §8 allow-list); never rules, review messages, internal notes, observed metadata, actor ids, non-`ACTIVE` items.
- Runtime DB role: SELECT/INSERT/UPDATE only, RLS `api_all`; no DELETE; history never deleted. Numeric amounts as `numeric` columns and decimal strings in JSON — never JS `number` for `minimum_amount`, NAV `value` or prices.
- No signing, broadcasting or state-changing RPC. RPC and CMC responses are untrusted → zod.
- Web: dark design system, 44 px targets, status text + icon, lucide only; no mobile changes. Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`.
- Known flake: Windows vitest worker crash (exit 3221226505) on random api files — re-run crashed files alone; not a code failure. `ECONNREFUSED :54329` ⇒ `pnpm db:up`.

## Review Focus

1. **Admin submits then approves their own instrument** (or a second admin approves while the first edits) → 403 for self-review; edits refused while `UNDER_REVIEW`; test in Task 2.
2. **Same token registered twice** (same chain + address, different case/checksum, or under another instrument) → 409 `DEPLOYMENT_EXISTS`; allowed again after the old deployment is retired; test in Task 1.
3. **RPC down / CMC down / CMC key missing** → verify returns 503 `VERIFIER_UNAVAILABLE` and stores nothing; prices return `unavailable` and the asset pages still render; tests in Tasks 1, 2, 3.
4. **Paused or deprecated items leaking to users** → session API hides paused instruments (and all their items), paused items, deprecated instruments, draft items; test in Task 2.
5. **Changing an approved deployment's decimals/address** through PATCH → 409 with the locked-field message; nothing changes; test in Task 1.

---

## File Structure

```
packages/validator/src/assets.ts               NEW enums, ASSET_CHAINS, transitions, requirement keys, request/response schemas
packages/validator/src/assets.test.ts          NEW
packages/validator/src/{errors,index}.ts       DEPLOYMENT_EXISTS; export assets
packages/db/src/schema/assets.ts               NEW tables + enums
packages/db/src/schema/index.ts                export assets
packages/db/migrations/0007_assets.sql         generated + grants/RLS appended
apps/api/src/env.ts                            COINMARKETCAP_API_KEY (optional, default "")
apps/api/src/services/wallets.ts               canonicalizeAddress accepts AssetChain
apps/api/src/providers/evm-rpc.ts              + readTokenMetadata
apps/api/src/providers/solana-rpc.ts           NEW getMintDecimals
apps/api/src/providers/coinmarketcap.ts        NEW fetchQuotes
apps/api/src/services/assets.ts                NEW CRUD, verification, detail, missingRequirements, session read
apps/api/src/services/asset-review.ts          NEW submit, decision, instrument + item lifecycle
apps/api/src/services/pricing.ts               NEW getPrices
apps/api/src/routes/ops.ts                     + asset routes
apps/api/src/routes/assets.ts                  NEW session read routes; mounted in app.ts
apps/api/src/middleware/rate-limit.ts          + assetVerifyUser
apps/api/test/assets/*.test.ts                 NEW
packages/api-client/src/client.ts              + ops asset + session asset methods
packages/app-core/src/asset-status.ts          NEW labels/tones; export in index
apps/web/app/(ops)/ops/assets/{page,new/page,[id]/page}.tsx
apps/web/components/ops/assets/{assets-table,asset-form,asset-deployments,asset-routes,asset-rules,asset-pricing,asset-review-panel}.tsx
apps/web/app/(ops)/ops/layout.tsx              nav "Assets"
apps/web/test/ops-asset-*.test.tsx             NEW
docs/…                                         ADR-010 + in-place updates
```

---

### Task 1: Data, validator, ops CRUD and deployment verification (API)

**Files:** create `packages/validator/src/assets.ts`, `packages/validator/src/assets.test.ts`, `packages/db/src/schema/assets.ts`, `apps/api/src/providers/solana-rpc.ts`, `apps/api/src/services/assets.ts`, `apps/api/test/assets/{crud,verification}.test.ts`; modify `packages/validator/src/{errors,index}.ts`, `packages/db/src/schema/index.ts`, `apps/api/src/{env,app}.ts`, `apps/api/src/services/wallets.ts`, `apps/api/src/providers/evm-rpc.ts`, `apps/api/src/routes/ops.ts`, `apps/api/src/middleware/rate-limit.ts`, `apps/api/test/setup.ts` (mock the new providers the way existing providers are mocked), `packages/api-client/src/client.ts`; migration `0007_assets.sql`.

**Interfaces — Produces:**
- `@repo/validator`: `ASSET_CHAINS` (below), `assetChainSchema`, `AssetChain`, `assetTypeSchema`, `RWA_ASSET_TYPES`, `tokenStandardSchema`, `INSTRUMENT_STATUSES`/`instrumentStatusSchema`, `ASSET_ITEM_STATUSES`/`assetItemStatusSchema`, `ruleStatusSchema`, `executionMethodSchema`, `processingModelSchema`, `eligibilityActionSchema`, `eligibilityOutcomeSchema`, `priceKindSchema`, `assetProviderKindSchema`, `INSTRUMENT_TRANSITIONS`, `ASSET_ITEM_TRANSITIONS`, `ASSET_REQUIREMENT_KEYS`, request schemas `createInstrumentRequestSchema`, `updateInstrumentRequestSchema`, `createDeploymentRequestSchema`, `updateDeploymentRequestSchema`, `createRouteRequestSchema`, `updateRouteRequestSchema`, `createRuleRequestSchema`, `updateRuleRequestSchema`, `putPriceReferenceRequestSchema`, `navEntryRequestSchema`, `issuerRequestSchema`, `assetProviderRequestSchema`, `assetDecisionRequestSchema`, `opsAssetListQuerySchema`, `assetListQuerySchema`; response schemas `opsAssetSummarySchema`, `opsAssetDetailSchema`, `publicAssetSummarySchema`, `publicAssetDetailSchema`, `priceViewSchema`.
- `services/assets.ts`: `listAssetsForOps(q)`, `createInstrument(ctx, body)`, `getAssetForOps(id)` (includes `missing: string[]`), `updateInstrument(ctx, id, body)`, `createDeployment(ctx, id, body)`, `updateDeployment(ctx, id, did, body)`, `verifyDeployment(ctx, id, did)`, `createRoute`, `updateRoute`, `createRule`, `updateRule`, `putPriceReference(ctx, id, kind, body)`, `recordNav(ctx, id, body)`, `listIssuers`/`createIssuer`/`updateIssuer`, `listAssetProviders`/`createAssetProvider`/`updateAssetProvider`, `missingRequirements(conn, instrumentId): Promise<string[]>` (used by Task 2).
- Providers: `readTokenMetadata({ chain, address }): Promise<{ decimals: number; symbol: string | null; name: string | null } | null>` (null = not a token; throws 503 `VERIFIER_UNAVAILABLE` on transport failure); `getMintDecimals(mint: string): Promise<number | null>` (same contract).

- [ ] **Step 1: Validator.** Chains and transitions (exact):

```ts
export const assetChainSchema = z.enum(["solana", "ethereum", "base", "bnb", "arbitrum", "polygon", "bitcoin"]);
export type AssetChain = z.infer<typeof assetChainSchema>;
export const ASSET_CHAINS: Readonly<Record<AssetChain, { label: string; family: "evm" | "solana" | "bitcoin"; verification: "onchain" | "manual" }>> = {
  solana: { label: "Solana", family: "solana", verification: "onchain" },
  ethereum: { label: "Ethereum", family: "evm", verification: "onchain" },
  base: { label: "Base", family: "evm", verification: "onchain" },
  bnb: { label: "BNB Chain", family: "evm", verification: "onchain" },
  arbitrum: { label: "Arbitrum", family: "evm", verification: "onchain" },
  polygon: { label: "Polygon", family: "evm", verification: "manual" },
  bitcoin: { label: "Bitcoin", family: "bitcoin", verification: "manual" },
};

export const INSTRUMENT_TRANSITIONS: Readonly<Record<InstrumentStatus, readonly InstrumentStatus[]>> = {
  DRAFT: ["UNDER_REVIEW", "RETIRED"],
  UNDER_REVIEW: ["APPROVED", "CHANGES_REQUIRED"],
  CHANGES_REQUIRED: ["UNDER_REVIEW", "RETIRED"],
  APPROVED: ["ACTIVE", "RETIRED"],
  ACTIVE: ["PAUSED", "DEPRECATED"],
  PAUSED: ["ACTIVE", "DEPRECATED"],
  DEPRECATED: ["RETIRED"],
  RETIRED: [],
};
export const ASSET_ITEM_TRANSITIONS: Readonly<Record<AssetItemStatus, readonly AssetItemStatus[]>> = {
  DRAFT: ["APPROVED", "RETIRED"],
  APPROVED: ["ACTIVE", "RETIRED"],
  ACTIVE: ["PAUSED", "RETIRED"],
  PAUSED: ["ACTIVE", "RETIRED"],
  RETIRED: [],
};
export const ASSET_REQUIREMENT_KEYS = ["deployment", "deployment_verification", "deployment_source_url", "market_price_reference", "issuer", "route", "eligibility_rule"] as const;
```

  Request schemas per spec §4 field limits (`symbol` uppercased via `.transform`, `links` ≤10 https URLs, `minimumAmount` and NAV `value` as decimal strings `/^\d{1,20}(\.\d{1,18})?$/`, `jurisdiction` `/^[A-Z]{2}$/` or `*` for rules, `external_id` `/^\d+$/`, `decimals` int 0–36). `createDeploymentRequestSchema` refine: `tokenStandard === "native"` ⇔ no `address`; `chain === "bitcoin"` ⇒ native. `assetDecisionRequestSchema` refine: `changes_required` requires `message` (1–2000). Tests: transition maps (every status has an entry; `RETIRED` terminal; `UNDER_REVIEW` cannot go to `ACTIVE`); `ASSET_CHAINS` keys equal `assetChainSchema.options` and auth `chainSchema.options` ⊂ asset chains with equal families; decision refine; deployment refine; symbol uppercased. Add `DEPLOYMENT_EXISTS` to `errors.ts` (409).
- [ ] **Step 2: Schema + migration.** Tables, enums, partial uniques and checks exactly per spec §4 in `schema/assets.ts` (follow `schema/organizations.ts` style). `pnpm --filter @repo/db db:generate --name=assets`; append to `0007_assets.sql`: `GRANT SELECT, INSERT, UPDATE` on every new table to `bytesac_api`, `ENABLE ROW LEVEL SECURITY` + policy `api_all` for `bytesac_api` (copy the exact block from `0005_organizations.sql`). Run `drizzle-kit generate` again → "No schema changes". `pnpm --filter @repo/db db:migrate` on the dev DB.
- [ ] **Step 3: Canonicalization.** `canonicalizeAddress(chain: AssetChain, raw)` in `services/wallets.ts`: branch on `ASSET_CHAINS[chain].family` (`evm` / `solana` as today; `bitcoin` → 400 `VALIDATION_FAILED` "Bitcoin deployments are native only."). Auth callers keep compiling because `Chain` ⊂ `AssetChain`.
- [ ] **Step 4: Providers.** `evm-rpc.ts` `readTokenMetadata`: viem client on the existing Alchemy host for `chain` (reuse the host map; widen its key type to `AssetChain`), `multicall` with `allowFailure: true` over `erc20Abi` `decimals`/`symbol`/`name`; `decimals` failure with a definitive revert ⇒ `null`; transport failure ⇒ 503 `VERIFIER_UNAVAILABLE` (reuse the file's `isDefinitiveRevert` classification and message style). `solana-rpc.ts` `getMintDecimals`: `fetch` POST `https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}` body `{ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }`, `AbortSignal.timeout(5000)`, zod-parse `{ result: { value: { decimals: number } } } | { error: { code, message } }`; RPC error `-32602` (invalid param / not a mint) ⇒ `null`; network/5xx/other ⇒ 503 `VERIFIER_UNAVAILABLE`. Confirm the error code for "not a token mint" in current Solana RPC docs and record it in the report.
- [ ] **Step 5: CRUD services.** All ops mutations: `OpsCtx`, one tx, instrument row `FOR UPDATE`, `asset_events` row (`entity_type`, `kind` `created|updated|verified|nav_recorded`) + `writeAudit` (`action: "asset.<entity>.<kind>"`). Rules:
  - Instrument `UNDER_REVIEW` or `RETIRED` ⇒ any edit/add under it → 409 `INVALID_TRANSITION` ("This asset is under review." / "This asset is retired.").
  - Locked fields (spec §5) → 409 locked-field message; instrument `assetType`/`symbol` locked at `APPROVED`+.
  - Deployment create: canonicalize; `verification = ASSET_CHAINS[chain].verification === "onchain" && tokenStandard !== "native" ? "onchain" : "manual"`; for `onchain` call the provider **before** opening the tx and store `observed_*` + `observed_at` (null observed = "not a token"); unique violation on the registry-wide `(chain, address)` index → 409 `DEPLOYMENT_EXISTS`. `verifyDeployment` only while the deployment is `DRAFT` (else 409), consumes `limits.assetVerifyUser` (30/h, key ops user id).
  - Route: `deploymentId` must belong to the instrument (404); `settlementInstrumentId` must exist (404).
  - `putPriceReference`: retire the active one of that kind, insert new (`market` ⇒ provider `coinmarketcap` + `externalId` required; `nav` ⇒ provider `issuer`).
  - `recordNav`: requires an active `nav` reference (409 otherwise).
  - `missingRequirements(conn, instrumentId)` returns `ASSET_REQUIREMENT_KEYS` entries per spec §5 submit rules (non-retired deployments/routes; `ACTIVE` rules/price refs; RWA = `RWA_ASSET_TYPES`).
  - `listAssetsForOps`: filters `status`, `type`, `chain` (instrument has a non-retired deployment on it), `q` (ILIKE on name/symbol, parameterized), cursor by `updated_at`,`id` as `organization-review.ts`.
- [ ] **Step 6: Routes + client.** Add every ops route from spec §8 **except** submit/decision/lifecycle/prices (Task 2) to `routes/ops.ts` with `requireRole("ops_reviewer")`, `validate`, `limits.opsUser` as existing ops mutations do. API client methods for them.
- [ ] **Step 7: Tests.** `crud.test.ts`: create instrument (reviewer OK, anonymous 401, non-ops 403); edit descriptive fields in `ACTIVE` state (seed status via DB) allowed + event row; locked fields → 409 exact message and row unchanged (Review Focus 5); `UNDER_REVIEW` edit → 409; duplicate deployment same chain + address in different case, and under another instrument → 409 `DEPLOYMENT_EXISTS`; after retiring (status via DB) the same address is accepted (Review Focus 2); bitcoin non-native → 400; route with a deployment of another instrument → 404; `putPriceReference` twice → one `ACTIVE`, one retired; NAV without nav reference → 409, with → row; `missingRequirements` for CRYPTO (no price ref, unverified deployment, manual without source) and RWA (no issuer/route/rule) returns exact keys; list filters + cursor; grants: `has_table_privilege('bytesac_api', t, 'DELETE')` false for each new table. `verification.test.ts` (providers mocked): EVM match stores observed values; mismatch stored; revert ⇒ observed null; transport ⇒ 503 and no deployment row created (Review Focus 3); Solana decimals stored; invalid mint ⇒ observed null; Polygon/native ⇒ `manual`, no provider call; verify on non-DRAFT → 409; 31st verify in an hour → 429.
- [ ] **Step 8: Gate + commit.** `pnpm db:up`; `pnpm turbo run lint check-types test --filter=api... --filter=@repo/validator --filter=@repo/db --filter=@repo/api-client`; commit `feat(api): add asset registry data, ops editing and deployment verification`.

---

### Task 2: Review, lifecycle, pricing, session read API (API)

**Files:** create `apps/api/src/services/asset-review.ts`, `apps/api/src/services/pricing.ts`, `apps/api/src/providers/coinmarketcap.ts`, `apps/api/src/routes/assets.ts`, `apps/api/test/assets/{review,lifecycle,pricing,public}.test.ts`; modify `apps/api/src/services/assets.ts` (session read + prices in ops detail), `apps/api/src/routes/ops.ts`, `apps/api/src/app.ts`, `apps/api/src/env.ts`, `packages/validator/src/assets.ts`, `packages/api-client/src/client.ts`, `apps/api/.env.example` (if present).

**Interfaces — Consumes:** Task 1 tables, `missingRequirements`, transition maps, schemas. **Produces:** `submitInstrument(ctx, id)`, `decideInstrument(ctx, id, body)`, `transitionInstrument(ctx, id, action: "activate" | "pause" | "resume" | "deprecate" | "retire")`, `transitionAssetItem(ctx, id, kind: "deployments" | "routes", itemId, action: "approve" | "activate" | "pause" | "resume" | "retire")`, `getPrices(instrumentIds: string[]): Promise<PriceView[]>`, `fetchQuotes(cmcIds: string[]): Promise<Map<string, { value: string; observedAt: string }>>`, `listPublicAssets(q)`, `getPublicAsset(id)`.

- [ ] **Step 1: Submit + decision (subtle — exact core):**

```ts
export async function decideInstrument(ctx: OpsCtx, id: string, body: AssetDecisionRequest): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(instruments).where(eq(instruments.id, id)).for("update");
    if (!row) throw createHttpError(404, "Asset not found", { code: "NOT_FOUND" });
    if (row.status !== "UNDER_REVIEW") throw createHttpError(409, "This asset is not waiting for review.", { code: "INVALID_TRANSITION" });
    if (row.submittedByUserId === ctx.userId) throw createHttpError(403, "You can't review a submission you made.", { code: "FORBIDDEN" });
    if (body.decision === "approved") {
      const missing = await missingRequirements(tx, id);
      if (missing.length) throw createHttpError(422, "This asset is missing required information.", { code: "REQUIREMENTS_INCOMPLETE", details: { missing } });
    }
    const to = body.decision === "approved" ? "APPROVED" : "CHANGES_REQUIRED";
    await tx.update(instruments).set({ status: to, decidedByUserId: ctx.userId, updatedAt: sql`now()` }).where(eq(instruments.id, id));
    if (to === "APPROVED") {
      for (const table of [instrumentDeployments, executionRoutes]) {
        await tx.update(table).set({ status: "APPROVED", approvedByUserId: ctx.userId, updatedAt: sql`now()` }).where(and(eq(table.instrumentId, id), eq(table.status, "DRAFT")));
      }
    }
    await tx.insert(assetEvents).values({ instrumentId: id, entityType: "instrument", entityId: id, kind: "decided", fromStatus: row.status, toStatus: to, actorUserId: ctx.userId, message: body.message ?? null, internalNote: body.internalNote ?? null, requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "asset.instrument.decided", entityType: "instrument", entityId: id, requestId: ctx.meta.requestId, metadata: { decision: body.decision } });
  });
}
```

  Match `writeAudit`/`ctx.meta` field names to the existing code (read `services/organization-review.ts` first; adjust names, not logic). `submitInstrument`: lock, status ∈ `DRAFT|CHANGES_REQUIRED` (else 409), `missingRequirements` → 422 with `details.missing`, set `UNDER_REVIEW` + `submittedByUserId = ctx.userId`, event `submitted` + audit.
- [ ] **Step 2: Lifecycle.** `transitionInstrument`: lock; target from action (`activate`→`ACTIVE` from `APPROVED`, `pause`→`PAUSED`, `resume`→`ACTIVE` from `PAUSED`, `deprecate`→`DEPRECATED`, `retire`→`RETIRED`); reject when target ∉ `INSTRUMENT_TRANSITIONS[from]` or when `resume`/`activate` don't match their source (409); on `activate` also set the instrument's `APPROVED` deployments/routes to `ACTIVE`; event + audit per changed row. `transitionAssetItem`: lock the instrument then the item; `approve` requires instrument ∈ `APPROVED|ACTIVE|PAUSED` and, for deployments, the item passes the verification/source-url check (422 `REQUIREMENTS_INCOMPLETE` with the failing key), for routes its deployment is non-retired; `activate` requires instrument ∈ `ACTIVE|PAUSED|APPROVED`; transitions per `ASSET_ITEM_TRANSITIONS`; `approved_by_user_id` on approve. No self-review rule for item approve beyond admin role (spec: separation applies to instrument submission) — record in the report if you add one.
- [ ] **Step 3: Pricing (subtle — exact core):**

```ts
const STALE_MS = 5 * 60_000;
export async function getPrices(instrumentIds: string[]): Promise<PriceView[]> {
  if (!instrumentIds.length) return [];
  const refs = await db.select().from(priceReferences).where(and(inArray(priceReferences.instrumentId, instrumentIds), eq(priceReferences.status, "ACTIVE")));
  const market = refs.filter((r) => r.kind === "market");
  const cached = market.length ? await redis.mget(market.map((r) => `price:cmc:${r.externalId}`)) : [];
  const quotes = new Map<string, { value: string; observedAt: string }>();
  market.forEach((r, i) => { const hit = cached[i]; if (hit) quotes.set(r.externalId!, JSON.parse(hit)); });
  const missing = market.map((r) => r.externalId!).filter((cmcId) => !quotes.has(cmcId));
  if (missing.length && env.COINMARKETCAP_API_KEY) {
    try {
      const fresh = await fetchQuotes(missing);
      const pipe = redis.pipeline();
      for (const [cmcId, q] of fresh) { quotes.set(cmcId, q); pipe.set(`price:cmc:${cmcId}`, JSON.stringify(q), "EX", 60); }
      await pipe.exec();
    } catch (err) {
      logger.warn("coinmarketcap quotes unavailable", { err });
    }
  }
  const navRefs = refs.filter((r) => r.kind === "nav");
  const navRows = navRefs.length
    ? await db.selectDistinctOn([navObservations.priceReferenceId]).from(navObservations).where(inArray(navObservations.priceReferenceId, navRefs.map((r) => r.id))).orderBy(navObservations.priceReferenceId, desc(navObservations.asOf), desc(navObservations.createdAt))
    : [];
  return refs.map((r): PriceView => {
    if (r.kind === "market") {
      const q = quotes.get(r.externalId!);
      return q
        ? { instrumentId: r.instrumentId, kind: "market", status: "ok", value: q.value, currency: "USD", source: "coinmarketcap", observedAt: q.observedAt, stale: Date.now() - Date.parse(q.observedAt) > STALE_MS }
        : { instrumentId: r.instrumentId, kind: "market", status: "unavailable", value: null, currency: "USD", source: "coinmarketcap", observedAt: null, stale: false };
    }
    const n = navRows.find((row) => row.priceReferenceId === r.id);
    return { instrumentId: r.instrumentId, kind: "nav", status: n ? "ok" : "unavailable", value: n?.value ?? null, currency: "USD", source: "issuer", observedAt: n ? String(n.asOf) : null, stale: false };
  });
}
```

  `fetchQuotes` (`providers/coinmarketcap.ts`): `fetch("https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=" + ids.join(",") + "&convert=USD", { headers: { "X-CMC_PRO_API_KEY": env.COINMARKETCAP_API_KEY, Accept: "application/json" }, signal: AbortSignal.timeout(5000) })`; non-2xx throws; zod-parse `data` as a record of id → object (v2 may return an array per id — handle both per the official docs) with `quote.USD.price` (number) and `quote.USD.last_updated` (ISO); convert price to a decimal string with `String(price)` (display only; documented in code with a `ponytail:` note that authoritative valuation needs a decimal source). `env.ts`: `COINMARKETCAP_API_KEY: str({ default: "" })`. Adjust the names of `logger`/`db` imports to the existing ones.
- [ ] **Step 4: Session read API.** `routes/assets.ts` (`requireSession`): `GET /v1/assets` (`assetListQuerySchema`: `q`, `type`, `chain`, `cursor`) → instruments `ACTIVE` with ≥1 `ACTIVE` deployment; `GET /v1/assets/:id` → `publicAssetDetailSchema` built from an explicit select list (spec §8 allow-list) — `ACTIVE` deployments and `ACTIVE` routes of an `ACTIVE` instrument only; prices via `getPrices`; otherwise 404 `NOT_FOUND`. Mount in `app.ts`. Ops detail (`getAssetForOps`) gains `prices` via `getPrices([id])`; add `GET /v1/ops/assets/:id/prices`.
- [ ] **Step 5: Routes + client.** Submit (`ops_reviewer`), decision / instrument lifecycle / item lifecycle (`requireRole("ops_admin")`), prices; API client methods for all Task 2 routes including session reads.
- [ ] **Step 6: Tests.** `review.test.ts`: full cycle draft → submit (incomplete → 422 exact `missing`) → changes_required without message → 400 → with message → `CHANGES_REQUIRED` → edit → resubmit → approve → `APPROVED` with `DRAFT` items now `APPROVED`; admin who submitted → 403 and status unchanged (Review Focus 1); reviewer on decision → 403; edit while `UNDER_REVIEW` → 409; events + audit rows per step. `lifecycle.test.ts`: activate cascades to `APPROVED` items only; pause/resume; `resume` from `ACTIVE` → 409; deprecate then retire; `ACTIVE` → `RETIRED` directly → 409; item added to an `ACTIVE` instrument stays `DRAFT` until approve + activate while the instrument stays readable; item approve with decimals mismatch → 422 `deployment_verification`; reviewer on lifecycle → 403. `public.test.ts`: only `ACTIVE` instrument with `ACTIVE` items listed; pause one deployment → hidden from detail, instrument still listed if another deployment is active; pause instrument → list and detail 404 (Review Focus 4); deprecated → 404; response keys equal the allow-list exactly (`Object.keys` recursive assertion; no `internalNote`, `message`, `observedDecimals`, `submittedByUserId`, rules); anonymous → 401. `pricing.test.ts` (`fetchQuotes` mocked, Redis flushed per test): cache miss → one batched call for two ids; second call → no provider call; key empty → `unavailable`, no call (Review Focus 3); provider throws → `unavailable`, no throw; `observedAt` older than 5 min → `stale: true`; NAV latest by `as_of` returned as separate `kind: "nav"` entry alongside market.
- [ ] **Step 7: Gate + commit.** Same filtered gate as Task 1, then repo-wide `pnpm turbo run lint check-types test`; commit `feat(api): add asset review, lifecycle, pricing and read API`.

---

### Task 3: Web ops assets (list, create, editor)

**Files:** create `apps/web/app/(ops)/ops/assets/page.tsx`, `apps/web/app/(ops)/ops/assets/new/page.tsx`, `apps/web/app/(ops)/ops/assets/[id]/page.tsx`, `apps/web/components/ops/assets/{assets-table,asset-form,asset-deployments,asset-routes,asset-rules,asset-pricing,asset-review-panel}.tsx`, `packages/app-core/src/asset-status.ts`; modify `apps/web/app/(ops)/ops/layout.tsx`, `packages/app-core/src/{index,error-copy}.ts`.

**Interfaces — Consumes:** api-client methods from Tasks 1–2; `me.platformRoles` (existing) for admin-only controls; `ASSET_CHAINS`, schemas from `@repo/validator`.

- [ ] **Step 1: app-core.** `INSTRUMENT_STATUS_LABEL`, `ASSET_ITEM_STATUS_LABEL` (label + tone, same shape as existing status label maps), `ASSET_TYPE_LABEL`, `ASSET_REQUIREMENT_LABEL` (one sentence per `ASSET_REQUIREMENT_KEYS` key), copy for `DEPLOYMENT_EXISTS`.
- [ ] **Step 2: List + create.** `/ops/assets` like `organizations-table.tsx`: columns name, symbol, type, chains, status (text + icon), updated; status/type/chain filters and search bound to URL search params; "New asset" button. `/ops/assets/new`: name, symbol, type, issuer select with inline "New issuer" (name required), description; submit → redirect to `/ops/assets/[id]`.
- [ ] **Step 3: Editor.** `/ops/assets/[id]` sections: Details (editable; locked fields rendered read-only with a lock icon and tooltip text "Locked after approval"); Deployments (add form: chain select from `ASSET_CHAINS`, standard, address (hidden for native), decimals, source URL (required hint when `ASSET_CHAINS[chain].verification === "manual"` or native); list shows entered vs observed decimals/symbol/name, verification status text + icon: "Matches chain", "Decimals differ from chain", "Not a token", "Manual — check source"; "Re-verify" on `DRAFT`; admin item buttons approve/activate/pause/resume/retire with confirm); Routes (provider select + inline create, deployment select, method, venue, settlement asset select from instruments, minimum amount, processing model, notes; admin item buttons); Eligibility rules (table; add form; retire); Pricing (market CMC id form; live price with "Stale" badge or "Price unavailable"; NAV reference + NAV entry form + history table); Review panel (missing-requirements checklist from `missing`, Submit/Resubmit; admin decision form approve / changes required (message required, internal note optional); lifecycle buttons per `INSTRUMENT_TRANSITIONS[status]` with confirm dialogs; "You submitted this asset — another admin must review it." when `submittedByUserId === me.id`); Events timeline (internal notes labelled "Internal"). Errors via `ops-error.tsx`; 403 → access-lost state. Reuse `transition-form.tsx` patterns for the decision form.
- [ ] **Step 4: Nav.** Ops layout nav gains "Assets".
- [ ] **Step 5: Gate + commit.** `pnpm --filter web lint check-types build`, `pnpm --filter @repo/app-core test`; commit `feat(web): add ops asset registry pages`.

---

### Task 4: Web tests + docs

**Files:** create `apps/web/test/ops-asset-{list,editor,review}.test.tsx`, `docs/decisions/ADR-010-ASSET-REGISTRY.md`; modify `docs/decisions/ADR-002-PRICING-PROVIDER.md`, `docs/decisions/DECISION-REGISTER.md`, `docs/domains/ASSET-REGISTRY.md`, `docs/architecture/ARCHITECTURE.md`, `apps/api/README.md`, `docs/superpowers/HANDOFF.md`.

- [ ] **Step 1: Web tests** (follow `apps/web/test/ops-member-*.test.tsx` mocking style): list renders rows + filters update the query; create form validation (symbol required, uppercased) and redirect; deployment verification display for match / mismatch / not-a-token / manual; `DEPLOYMENT_EXISTS` shown inline; `VERIFIER_UNAVAILABLE` shows retry copy (Review Focus 3); submit checklist lists missing requirement labels; decision form blocks changes-required without message; admin-only buttons hidden for `ops_reviewer`; self-submitted notice for the submitting admin; lifecycle confirm dialog calls the right endpoint; price unavailable and stale badge render; 403 access-lost state.
- [ ] **Step 2: Docs (in place).** ADR-010: registry model (instrument/deployment/route/rule/price reference), `ASSET_CHAINS` separate from auth chains, verification method per chain, lifecycle + per-item review, locked fields, ops separation of duties, read API allow-list, consequences, open items (spec §13). ADR-002 rewritten in place with the implemented pricing (on-demand, Redis 60 s, stale 5 min, NAV separate, optional key, no history). `DECISION-REGISTER.md`: rewrite D-009 (asset chains), D-010, D-011 (ops-only onboarding, submitter ≠ approver), D-015 (implemented), D-027 (partial: market/NAV distinct, freshness 5 min; hierarchy still OPEN); add rows `D-053` asset chains list, `D-054` deployment verification, `D-055` asset lifecycle + per-item review, `D-056` session asset read API. `ASSET-REGISTRY.md` "implemented" behavior; `ARCHITECTURE.md` data-model list + pricing section; `apps/api/README.md` `COINMARKETCAP_API_KEY` (optional) and Alchemy Solana use of `ALCHEMY_API_KEY`; HANDOFF §2 Spec 5 row + §5.
- [ ] **Step 3: Gate + commit.** `pnpm db:up`; `pnpm turbo run lint check-types test build`; commits `test(web): cover ops asset registry pages` and `docs: record asset registry decisions`.

---

## Self-Review Notes

- Spec coverage: §2 → constraints; §4 → T1 S1–S2; §5 → T1 S5 (locks/edits), T2 S1–S2; §6 → T1 S4–S5; §7 → T2 S3; §8 → T1 S6, T2 S4–S5; §9 → T3, T4 S1; §10 → constraints + T2 public tests; §11 → per-task tests; §12 → task split; §13 → ADR-010 open items.
- Names consistent: `ASSET_CHAINS`, `INSTRUMENT_TRANSITIONS`, `ASSET_ITEM_TRANSITIONS`, `ASSET_REQUIREMENT_KEYS`, `missingRequirements`, `readTokenMetadata`, `getMintDecimals`, `fetchQuotes`, `getPrices`, `decideInstrument`, `transitionInstrument`, `transitionAssetItem`, `DEPLOYMENT_EXISTS`.
- Ruling carried into the plan: item approval has no submitter≠approver rule (spec applies separation to instrument submission only; admin role required).

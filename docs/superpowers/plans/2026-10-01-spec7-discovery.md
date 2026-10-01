# Spec 7 — Discovery, Model Performance and AI Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **User preference:** four large tasks, tests per task, **one review at the end** (plus one fix wave). Full code is given only where logic is subtle; everything else is specified by paths, interfaces and test cases — follow the existing code patterns named below.

**Goal:** Public filterable/sortable basket discovery, research pages with simulated net/gross model performance, opt-in manager profiles, and Gemini tool-calling search with semantic/keyword fallbacks — powered by a BullMQ worker that snapshots prices, computes performance, maintains a search index and embeddings.

**Architecture:** `@repo/db` migration `0009_discovery.sql` (pgvector, instrument sector/tags, manager profiles, price snapshots, performance days, `basket_search_index`); `@repo/validator` `discovery.ts` (`DiscoveryFilters`, sector/tag/profile schemas, `effectiveFeeBps`) and `performance.ts` (pure engine with BigInt fixed-point); API `worker.ts` (BullMQ), `services/performance.ts`, `services/search-index.ts`, `services/discovery.ts`, `services/manager-profiles.ts`, `providers/gemini.ts`; web `/baskets` filters + AI box, research chart, `/managers/[handle]`, profile editor, ops tags/profiles.

**Tech Stack:** Express 5, Drizzle 0.45 + Postgres 17 + pgvector, BullMQ (new, pinned) on existing ioredis, `@google/genai` (new, pinned; official Gemini SDK), zod, Next.js 16, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-discovery-design.md`

## Global Constraints

- Follow existing patterns: `services/pricing.ts` + `providers/coinmarketcap.ts` (CMC batching, zod), `services/public-baskets.ts` (public allow-lists), `services/basket-review.ts` (after-commit side effects), `services/assets.ts` (ops PATCH, audit), `middleware/rate-limit.ts` (`limits`, `consume`, `redis`), `routes/public.ts`, `env.ts` (envalid), `@repo/logger`; tests in `apps/api/test/{baskets,assets}/*` + `helpers/*`; web `app/baskets/*`, `components/baskets/basket-view.tsx`, `components/ops/assets/*`, tests `apps/web/test/*`.
- **No extra functions**: no one-caller helpers, no wrappers around library calls. Invoke the `ponytail` skill.
- **Official docs first** (record what you confirmed in the report): BullMQ (Queue, Worker, `upsertJobScheduler`/repeatable jobs, job ids, backoff, connection options), `@google/genai` (generateContent with function declarations, function calling config mode `ANY`, embeddings `embedContent` with `outputDimensionality: 768`, current model names), pgvector (`vector(768)`, `<=>` cosine distance, Drizzle `vector` column + `cosineDistance`), Postgres `websearch_to_tsquery`/`ts_rank`.
- **Supply chain:** pin exact versions of `bullmq` and `@google/genai` — newest versions allowed by pnpm's minimum release age; never add `minimumReleaseAgeExclude` entries.
- Sector values exactly: `store_of_value`, `smart_contract_platform`, `layer2`, `defi`, `stablecoin`, `oracle_infra`, `gaming_metaverse`, `ai_data`, `meme`, `rwa_treasury`, `rwa_credit`, `rwa_commodity`, `rwa_equity`, `other` (default `other`).
- Performance methodology exactly as spec §4 (buy-and-hold, reset on publish, fee rules, gap > 3 days → unavailable, 30 data days for volatility/drawdown, index 100 at first publish). Index values in **BigInt fixed-point with 18 decimals** (scale `10n ** 18n`), stored as `numeric`; never JS `number` for index/fee factors; volatility may be a float.
- Performance label exactly: "Simulated model performance — not actual investor results. Net figures assume an investment equal to the basket minimum and include the basket's fees; network and swap costs are excluded."
- Jobs exactly: `price-snapshot` (daily 00:05 UTC), `basket-performance`, `search-index-refresh`, `embed-basket` + sweep every 15 min (max 5 attempts). Default job attempts 3 with exponential backoff.
- AI search exactly: forced function calling, one tool `search_baskets`, timeout 10 s, ≤ 2 tool rounds, Gemini text discarded, modes `tool` / `semantic` / `keyword`; queries never stored or logged (log mode, latency, count only). Gemini notice text: "Queries are processed by Google Gemini."
- Rate limits exactly: discovery 60/min/IP (`limits.discoveryIp`); AI 10/min/IP (`limits.aiSearchIp`), 100/day/IP (`limits.aiSearchIpDay`), 5000/day global (`limits.aiSearchGlobalDay`, single key).
- New error code exactly: `HANDLE_TAKEN` (409). Reuse `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `INVALID_TRANSITION`, `RATE_LIMITED`.
- Env: `GEMINI_API_KEY` optional (default ""), `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL` with defaults from current docs. Tests never call real Gemini/CMC (mock providers).
- Public responses: no user ids, membership ids, emails, hidden/draft profiles.
- Runtime DB role SELECT/INSERT/UPDATE only (no DELETE); `basket_search_index` updated in place; delisting = status update.
- Web: dark design system, 44 px, status text + icon, lucide only, plain-text rendering; inline SVG chart (no new chart library) with a data-table fallback. No mobile changes. Docs rewritten in place; never edit `docs/source/*`. Never stage `.claude/settings.json`, root `AGENTS.md`, generated `apps/*/AGENTS.md`/`CLAUDE.md`.
- Known issues: Windows vitest worker crash (3221226505) — re-run crashed files alone; `mobile#check-types` fails on `main` already (pre-existing wagmi/viem node_modules issue) — ignore that one task. Never run two suites concurrently.

## Review Focus

1. **A constituent has no price for 5 days** → basket metrics `available: false`, research page shows "Performance unavailable", search performance filters exclude it, nothing crashes; tests in Task 1 (engine) and Task 3 (UI).
2. **Gemini returns tool arguments with unknown keys, wrong types or an injected SQL-looking string** → arguments are validated/stripped by `DiscoveryFilters`, SQL stays parameterized, results are still public-only; test in Task 2.
3. **Two worker instances start at once** → repeatable jobs registered once (fixed ids), `price-snapshot` inserts idempotent, performance days not duplicated (PK); test in Task 1.
4. **Basket retired or paused after being indexed** → search index updated (delisted or status badge) after commit; AI/semantic results never include unlisted baskets; test in Task 2.
5. **Manager hides a profile via ops, then tries to republish** → 409; public page 404; basket pages fall back to the opt-in name; test in Task 2.

---

## File Structure

```
docker/postgres/Dockerfile                      + postgresql-17-pgvector
packages/validator/src/discovery.ts             NEW DiscoveryFilters, sectors, tags, profile schemas, effectiveFeeBps, public response schemas
packages/validator/src/performance.ts           NEW computePerformanceDays, performanceMetrics (pure)
packages/validator/src/{discovery,performance}.test.ts
packages/validator/src/{errors,index,assets,baskets}.ts   HANDLE_TAKEN; exports; sector/tags on ops asset + public basket schemas
packages/db/src/schema/discovery.ts             NEW tables; instruments.sector in schema/assets.ts
packages/db/migrations/0009_discovery.sql       generated + extension + grants/RLS
apps/api/src/worker.ts                          NEW BullMQ worker entry
apps/api/src/queues.ts                          NEW queue instances + enqueue used by services (shared by api and worker)
apps/api/src/services/performance.ts            NEW snapshot + performance job bodies
apps/api/src/services/search-index.ts           NEW refreshSearchIndex, embedBasket
apps/api/src/services/discovery.ts              NEW structuredSearch, aiSearch
apps/api/src/services/manager-profiles.ts       NEW own/public/ops profile services
apps/api/src/providers/gemini.ts                NEW generate + embed via @google/genai
apps/api/src/services/{basket-review,assets,public-baskets}.ts   enqueue refresh/embed; sector/tags; performance + sectors in public detail
apps/api/src/routes/{public,me,ops}.ts          + endpoints
apps/api/src/{env,app}.ts, apps/api/tsup.config.ts, apps/api/package.json   env; worker entry build + scripts
apps/api/test/discovery/*.test.ts               NEW
packages/api-client/src/client.ts               + endpoints
apps/web/app/baskets/page.tsx, apps/web/components/discovery/*, apps/web/app/managers/[handle]/page.tsx
apps/web/components/baskets/{performance-chart,basket-view}.tsx
apps/web/components/profile/manager-profile-editor.tsx, apps/web/app/(app)/profile/page.tsx
apps/web/app/(ops)/ops/{tags,manager-profiles}/page.tsx, apps/web/components/ops/{asset-tags,manager-profiles}.tsx, components/ops/assets/* (sector/tags)
apps/web/test/discovery-*.test.tsx, manager-*.test.tsx, ops-tags*.test.tsx
docs/…                                          ADR-012, ADR-006 rewrite + in-place updates
```

---

### Task 1: Data, validator (filters + performance engine), BullMQ worker, price snapshots and performance

**Files:** create `packages/validator/src/{discovery,performance}.ts` + tests, `packages/db/src/schema/discovery.ts`, `apps/api/src/{worker,queues}.ts`, `apps/api/src/services/performance.ts`, `apps/api/test/discovery/{performance,jobs}.test.ts`; modify `docker/postgres/Dockerfile`, `packages/db/src/schema/{assets,index}.ts`, `packages/validator/src/{errors,index}.ts`, `apps/api/src/env.ts`, `apps/api/tsup.config.ts`, `apps/api/package.json`, `apps/api/test/setup.ts`; migration `0009_discovery.sql`.

**Interfaces — Produces:**
- `@repo/validator`: `INSTRUMENT_SECTORS`, `instrumentSectorSchema`, `DiscoveryFilters` (`discoveryFiltersSchema`, `.strip()`), `discoverySortSchema`, `effectiveFeeBps(fee: Fee | { amountUsdc } , minimumUsdc: string): number`, `managerProfileRequestSchema`, `PERFORMANCE_LABEL`; `computePerformanceDays(input): PerformanceDay[]`, `performanceMetrics(days, today): PerformanceMetrics`.
- API: `queues` (`priceSnapshotQueue`, `basketPerformanceQueue`, `searchIndexQueue`, `embedQueue`) and `enqueue(name, data, opts?)`; `runPriceSnapshot()`, `runBasketPerformance(basketId?)`.

- [ ] **Step 1: Postgres image + migration.** Dockerfile installs `postgresql-17-pgvector` beside pg_cron; rebuild (`docker compose build postgres && docker compose up -d --wait`). Schema per spec §5 (`instruments.sector` in `schema/assets.ts`; others in `schema/discovery.ts`; Drizzle `vector("embedding", { dimensions: 768 })`, `tsvector` via `customType`). `pnpm --filter @repo/db db:generate --name=discovery`; prepend `CREATE EXTENSION IF NOT EXISTS vector;`; append grants + RLS (copy from `0008_baskets.sql`); regenerate → "No schema changes"; migrate dev DB. Test DB global setup must run the new migration (it already runs all migrations — verify).
- [ ] **Step 2: Validator — filters + fees.** `DiscoveryFilters` per spec §7 (limits: ≤10 assets/tags; bps 0–10000; decimal strings via `decimalStringSchema` for money, `/^-?\d{1,3}(\.\d{1,6})?$/` for performance fractions). `effectiveFeeBps`: percent → `bps`; fixed → `amount × 10000 / minimum` rounded half-up using BigInt micro-USDC (reuse the Spec 6 micro conversion — import, don't copy). URL encoding: filters travel as one `f` query param holding base64url JSON (simplest exact round-trip) — `GET /v1/public/discovery/baskets?f=<b64url>&cursor=`.
- [ ] **Step 3: Performance engine (subtle — exact core).** Pure function in `performance.ts`:

```ts
const S = 10n ** 18n;
const dec = (s: string): bigint => { const [i, f = ""] = s.split("."); const neg = i.startsWith("-"); const v = BigInt(i.replace("-", "")) * S + BigInt((f + "0".repeat(18)).slice(0, 18)); return neg ? -v : v; };
const str = (v: bigint): string => { const neg = v < 0n; const a = neg ? -v : v; return `${neg ? "-" : ""}${a / S}.${(a % S).toString().padStart(18, "0")}`; };
const mul = (a: bigint, b: bigint) => (a * b) / S;
const div = (a: bigint, b: bigint) => (a * S) / b;

export interface PerformanceInput {
  versions: { versionId: string; publishedDay: string; minimumUsdc: string; weights: { instrumentId: string; bps: number }[]; fees: BasketFees }[]; // ascending by publishedDay
  prices: Record<string, Record<string, string>>; // instrumentId → day → price_usd
  from: { day: string; indexGross: string; indexNet: string; holdingsGross: Record<string, string>; holdingsNet: Record<string, string>; lastPrices: Record<string, string>; gapRun: Record<string, number> } | null; // last computed day or null
  days: string[]; // UTC days to compute, ascending
}
export interface PerformanceDay { day: string; versionId: string; indexGross: string; indexNet: string; gap: boolean; holdingsGross: Record<string, string>; holdingsNet: Record<string, string>; lastPrices: Record<string, string>; gapRun: Record<string, number> }

export function computePerformanceDays(i: PerformanceInput): PerformanceDay[] {
  const out: PerformanceDay[] = [];
  let prev = i.from;
  for (const day of i.days) {
    const version = [...i.versions].reverse().find((v) => v.publishedDay <= day);
    if (!version) continue;
    const lastPrices = { ...(prev?.lastPrices ?? {}) };
    const gapRun = { ...(prev?.gapRun ?? {}) };
    let gap = false;
    for (const w of version.weights) {
      const p = i.prices[w.instrumentId]?.[day];
      if (p) { lastPrices[w.instrumentId] = p; gapRun[w.instrumentId] = 0; }
      else { gap = true; gapRun[w.instrumentId] = (gapRun[w.instrumentId] ?? 0) + 1; }
    }
    const M = dec(version.minimumUsdc);
    const fixedFactor = (amount: string, perDay = 1n) => S - div(dec(amount), M * perDay);
    const pctFactor = (bps: number, perDay = 1n) => S - (BigInt(bps) * S) / (10_000n * perDay);
    const feeFactor = (fee: Fee, perDay = 1n) => (fee.type === "percent" ? pctFactor(fee.bps, perDay) : fixedFactor(fee.amountUsdc, perDay));
    const isPublishDay = version.publishedDay === day;
    const isFirstDay = isPublishDay && i.versions[0].versionId === version.versionId;
    let gross: bigint, net: bigint, hg: Record<string, bigint>, hn: Record<string, bigint>;
    if (isPublishDay || !prev) {
      gross = isFirstDay || !prev ? 100n * S : dec(prev.indexGross);
      net = isFirstDay || !prev ? 100n * S : dec(prev.indexNet);
      if (isFirstDay) net = mul(net, feeFactor(version.fees.entry));
      else if (isPublishDay) net = mul(net, feeFactor(version.fees.rebalance));
      hg = Object.fromEntries(version.weights.map((w) => [w.instrumentId, (gross * BigInt(w.bps)) / 10_000n]));
      hn = Object.fromEntries(version.weights.map((w) => [w.instrumentId, (net * BigInt(w.bps)) / 10_000n]));
    } else {
      const step = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([id, v]) => [id, div(mul(dec(v), dec(lastPrices[id])), dec(prev!.lastPrices[id]))]));
      hg = step(prev.holdingsGross);
      hn = step(prev.holdingsNet);
      gross = Object.values(hg).reduce((a, b) => a + b, 0n);
      net = Object.values(hn).reduce((a, b) => a + b, 0n);
      let f = feeFactor(version.fees.management, 365n);
      if (version.fees.subscription && isPeriodStart(version, day)) f = mul(f, fixedFactor(version.fees.subscription.amountUsdc));
      hn = Object.fromEntries(Object.entries(hn).map(([id, v]) => [id, mul(v, f)]));
      net = mul(net, f);
    }
    const row: PerformanceDay = { day, versionId: version.versionId, indexGross: str(gross), indexNet: str(net), gap, holdingsGross: map(hg, str), holdingsNet: map(hn, str), lastPrices, gapRun };
    out.push(row);
    prev = { day, indexGross: row.indexGross, indexNet: row.indexNet, holdingsGross: row.holdingsGross, holdingsNet: row.holdingsNet, lastPrices, gapRun };
  }
  return out;
}
```

  Implement `isPeriodStart` (first version's publish day as anchor: monthly = same day-of-month, clamped to month end; yearly = anniversary; never on the anchor day itself) and `map` inline (they are only used here — inline them or keep them as local consts inside the function). A constituent with no price on its reset day uses the last known price; if it has never had a price, the day is skipped (no row) — record in report. `performanceMetrics(days, today)` returns `{ available, dataDays, net: { sinceLaunch, d30, d90, y1 }, gross: {…}, volatility, maxDrawdown }` as decimal strings/null: `available = false` when any `gapRun` in the last day > 3; windows only when `dataDays` ≥ window; volatility (stdev of daily net returns × √365, float → string with 6 decimals) and max drawdown only when `dataDays ≥ 30`.
  Tests (golden values computed by hand in the test with small numbers): two assets 50/50, prices double for one → gross 150; entry 1% percent → net 99 at day 1; fixed entry 10 on minimum 1000 → ×0.99; management 100 bps/year over 365 days ≈ ×0.99 within 1e-12; version change resets holdings to new weights and applies rebalance fee; subscription monthly deducted on month boundary only; gap carry-forward; gapRun 4 → unavailable (Review Focus 1); 29 vs 30 days threshold.
- [ ] **Step 4: Queues + worker.** `queues.ts`: `new Queue(name, { connection: { url: env.REDIS_URL } , defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 } })` for the four queues; `enqueue` = `queue.add(name, data, { jobId })` with deterministic ids (`search:<basketId>:<ts-rounded-to-10s>` to coalesce bursts; embed `embed:<basketId>:<versionId>`). `worker.ts`: `Worker` per queue calling the service functions; on start `upsertJobScheduler` (or the repeat API per current docs) for `price-snapshot` (`pattern: "5 0 * * *"`, `tz: "UTC"`) and the embed sweep (`every: 900_000`); graceful shutdown on SIGTERM. `package.json` scripts `dev:worker` (`tsx watch --env-file-if-exists=.env src/worker.ts`) and `start:worker` (`node dist/worker.js`); tsup `entry: ["src/server.ts", "src/worker.ts"]`. `env.ts`: `GEMINI_API_KEY` (`str({ default: "" })`), `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL` (defaults from docs).
- [ ] **Step 5: Job bodies.** `runPriceSnapshot()`: instruments with `ACTIVE` `market` price reference and `ACTIVE` status; `fetchQuotes` (Spec 5) batched; insert `instrument_price_snapshots` for `day = current UTC date` `ON CONFLICT DO NOTHING`; then enqueue `basket-performance`. `runBasketPerformance()`: for each basket with a published version (listed or retired), load versions (published/superseded, their `published_at::date`, weights at current revision, fees, minimum), last `basket_performance_days` row, prices for needed instruments/days; call `computePerformanceDays` for days `(last day, latest snapshot day]` (stop at retirement day for retired baskets); insert rows (PK makes reruns idempotent — `ON CONFLICT DO NOTHING`); enqueue `search-index-refresh`. `holdings` column stores `{ gross, net, lastPrices, gapRun }` json.
- [ ] **Step 6: Tests.** `performance.test.ts` (API integration): seed instruments, a published basket, snapshots for 3 days → rows computed; rerun → no duplicates; version 2 published on day 3 → reset; retired basket stops. `jobs.test.ts`: worker start with a mocked `Queue`/scheduler registers each repeatable job once even when started twice (Review Focus 3); `runPriceSnapshot` idempotent for the same day; mocked `fetchQuotes` failure → no rows, error thrown for BullMQ retry.
- [ ] **Step 7: Gate + commit.** `pnpm db:up`; `pnpm turbo run lint check-types test --filter=api... --filter=@repo/validator --filter=@repo/db`; commit `feat(api): add discovery data, performance engine and background worker`.

---

### Task 2: Search index, structured + AI search, profiles, ops and public APIs

**Files:** create `apps/api/src/services/{search-index,discovery,manager-profiles}.ts`, `apps/api/src/providers/gemini.ts`, `apps/api/test/discovery/{index,search,ai-search,profiles}.test.ts`; modify `apps/api/src/services/{basket-review,assets,public-baskets}.ts`, `apps/api/src/routes/{public,me,ops}.ts`, `apps/api/src/middleware/rate-limit.ts`, `packages/validator/src/{discovery,assets,baskets}.ts`, `packages/api-client/src/client.ts`.

**Interfaces — Consumes:** Task 1 tables, `enqueue`, `DiscoveryFilters`, `effectiveFeeBps`, `performanceMetrics`. **Produces:** `refreshSearchIndex(basketId)`, `embedBasket(basketId)`, `sweepEmbeddings()`, `structuredSearch(filters)`, `aiSearch(query)`, `geminiSearchCall(query, runTool)`, `embedText(text)`, `getOwnProfile`, `saveOwnProfile`, `publishOwnProfile`, `unpublishOwnProfile`, `getPublicManager(handle)`, `listProfilesForOps`, `hideProfile`, `unhideProfile`, `listAssetTags`, `createAssetTag`, `retireAssetTag`.

- [ ] **Step 1: Search index.** `refreshSearchIndex(basketId)`: load basket + current published version + current-revision assets joined with instruments (symbol, asset type, sector) + active tags + assignments' managers with published profiles; compute exposures (sum bps per instrument/type/sector), `max_weight_bps`, effective fee bps (`effectiveFeeBps` per fee; subscription from its amount), `metrics` from `performanceMetrics` over stored days, `search_text` via `setweight(to_tsvector('english', name), 'A') || …` (name A, short description/category B, thesis/methodology/asset names C); upsert; listed statuses per Spec 6 rule, otherwise update `status` so queries exclude it; set `embedding_status = 'pending'` when `current_version_id` changed. Wire after-commit `enqueue("search-index-refresh", { basketId })` in Spec 6 publish/pause/resume/retire/retirement decision/lead decision/manager-leaves paths, and `enqueue("embed-basket", …)` after publish. Asset sector/tag changes and profile publish/hide enqueue refresh for affected baskets.
- [ ] **Step 2: Embeddings.** `providers/gemini.ts`: one `GoogleGenAI` client (`apiKey: env.GEMINI_API_KEY`); `embedText(text)` → `ai.models.embedContent({ model: env.GEMINI_EMBEDDING_MODEL, contents: text, config: { outputDimensionality: 768 } })` → `number[]` (zod-validate length 768); `geminiSearchCall` (Step 4). `embedBasket(basketId)`: build text per spec §6, call `embedText`, store vector + `ready`; failure → `failed`, `embedding_attempts + 1`, rethrow. `sweepEmbeddings()`: rows `pending|failed` with attempts < 5 → enqueue `embed-basket`. No key → return without calling (stays `pending`).
- [ ] **Step 3: Structured search.** `structuredSearch(filters)`: build Drizzle `and(...)` from filters — exposures via `sql` jsonb predicates, e.g. asset min: `exists (select 1 from jsonb_array_elements(${idx.exposures}->'instruments') e where (e->>'id' = ${id} or e->>'symbol' = ${sym}) and (e->>'bps')::int >= ${min})`; asset max: `coalesce((select (e->>'bps')::int … ), 0) <= ${max}` (absent asset counts as 0); same for assetTypes/sectors; tags `&&`; numeric comparisons; `performance` on `(metrics->'net'->>'y1')::numeric` etc. only where `(metrics->>'available')::boolean`; `minManagerExperienceYears` on `manager_max_experience_years`; `q` → `search_text @@ websearch_to_tsquery('english', ${q})`; sort per `sort` (relevance = `ts_rank` desc when `q`, else newest); cursor `(sortValue, basket_id)` base64url; 20 per page; response shape per spec §7. Every value parameterized.
- [ ] **Step 4: AI search (subtle — exact core):**

```ts
export async function aiSearch(query: string): Promise<AiSearchResponse> {
  const started = Date.now();
  let filters: DiscoveryFilters | null = null;
  let results: DiscoverySearchItem[] = [];
  let mode: "tool" | "semantic" | "keyword" = "tool";
  if (env.GEMINI_API_KEY) {
    try {
      filters = await geminiSearchCall(query, async (raw) => {
        const parsed = discoveryFiltersSchema.omit({ cursor: true }).safeParse(raw);
        if (!parsed.success) return { error: "invalid arguments" };
        results = (await structuredSearch(parsed.data)).items;
        return { count: results.length, items: results.map((r) => ({ name: r.name, category: r.category, topAssets: r.topAssets })) };
      });
    } catch (err) {
      logger.warn("ai search: gemini unavailable", { err: (err as Error).name });
    }
  }
  if (!results.length) {
    mode = "semantic";
    try {
      if (!env.GEMINI_API_KEY) throw new Error("no key");
      const v = await embedText(query);
      results = await semanticSearch(v); // inline query: listed + embedding_status = 'ready' order by embedding <=> v limit 20
    } catch {
      mode = "keyword";
      results = (await structuredSearch({ q: query, sort: "relevance" })).items;
    }
  }
  logger.info("ai search", { mode, ms: Date.now() - started, count: results.length }); // never log the query
  return { mode, filters: mode === "tool" ? filters : null, results };
}
```

  `semanticSearch` is written inline (one caller). `geminiSearchCall(query, runTool)`: `ai.models.generateContent({ model: env.GEMINI_MODEL, contents: [{ role: "user", parts: [{ text: query }] }], config: { systemInstruction: "You translate basket search requests into a call to search_baskets. Never answer in prose.", tools: [{ functionDeclarations: [{ name: "search_baskets", description: "Search published investment baskets by structured filters.", parametersJsonSchema: z.toJSONSchema(discoveryFiltersSchema.omit({ cursor: true })) }] }], toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["search_baskets"] } }, abortSignal: AbortSignal.timeout(10_000) } })`; take the first function call, run the tool, send one `functionResponse` round back (max 2 rounds total), return the last valid parsed filters; ignore every text part. Adjust property names to the installed SDK's types (read them first). Rate limits: consume `aiSearchIp`, `aiSearchIpDay`, `aiSearchGlobalDay` (key `"global"`) before calling.
- [ ] **Step 5: Profiles.** `manager-profiles.ts`: own profile CRUD (`PUT` upserts; handle unique violation → 409 `HANDLE_TAKEN`; `hidden` → publish 409); public `getPublicManager(handle)` (published only): fields, `selfReported`, `verified` (EXISTS approved `member_verifications` for the user's memberships, OR `ACTIVE` OWNER membership of a `VERIFIED` org), baskets from assignments (listed or retired baskets; role, from/to), organizations (current/former with Spec 4 public names only when the membership has `public_display_name`); ops list/hide/unhide with reason, audit, email to owner after commit (reuse `notifyMember`-style Resend call with a new `sendProfileEmail` kind pair — add to `providers/resend.ts`). Public basket detail manager entries gain `handle` when a published profile exists; hidden profiles fall back to the opt-in name (Review Focus 5).
- [ ] **Step 6: Ops + assets.** `PATCH /v1/ops/assets/:id` accepts `sector` and `tagIds` (tag rows added/`removed_at` set; audited; enqueue refresh for baskets holding the instrument). Asset tags CRUD (`ops_admin`). Profiles moderation routes (`ops_reviewer`). Public basket detail gains `performance` (series from `basket_performance_days`, downsampled to ≤ 400 points by taking every nth day plus the last), `metrics`, `sectors`, `tags`, `label: PERFORMANCE_LABEL`.
- [ ] **Step 7: Routes + client.** `routes/public.ts`: `GET /v1/public/discovery/baskets` (`limits.discoveryIp`), `POST /v1/public/discovery/ai-search` (AI limits), `GET /v1/public/managers/:handle` (`limits.discoveryIp`); `routes/me.ts`: manager-profile routes; `routes/ops.ts`: tags + profiles. API client methods for all.
- [ ] **Step 8: Tests.** `index.test.ts`: publish → refresh builds exposures/fee bps/tags; pause → status updated; retire → excluded from search (Review Focus 4); sector change → refresh enqueued. `search.test.ts`: each filter type (asset min/max incl. absent asset, asset type, sector, tags, max weight, min investment, fee ceilings incl. fixed fee converted, review frequency, age, performance only when available, manager experience, q), each sort, cursor pages, unlisted never returned. `ai-search.test.ts` (Gemini provider mocked): tool call → `mode: "tool"` with filters; tool args with unknown keys stripped and SQL-like string treated as a plain value (Review Focus 2); tool empty → semantic; generate throws → semantic; embed throws → keyword; no key → keyword with no provider calls; per-IP and global limits → 429; logs contain no query text (spy on logger). `profiles.test.ts`: create/update, `HANDLE_TAKEN`, publish/unpublish, draft → public 404, ops hide → 404 and republish 409 (Review Focus 5), verified badge (approved member verification; OWNER of VERIFIED org; neither), baskets/orgs lists, public responses without ids/emails.
- [ ] **Step 9: Gate + commit.** Filtered gate, then repo-wide `pnpm turbo run lint check-types test` (ignore pre-existing `mobile#check-types`); commit `feat(api): add basket search index, AI search and manager profiles`.

---

### Task 3: Web discovery, research chart, manager pages, profile editor

**Files:** create `apps/web/components/discovery/{filters-panel,results-list,ai-search-box,filter-chips}.tsx`, `apps/web/components/baskets/performance-chart.tsx`, `apps/web/app/managers/[handle]/page.tsx`, `apps/web/components/profile/manager-profile-editor.tsx`; modify `apps/web/app/baskets/page.tsx`, `apps/web/components/baskets/basket-view.tsx`, `apps/web/app/(app)/profile/page.tsx`, `packages/app-core/src/*` (sector labels, discovery copy, `HANDLE_TAKEN` copy).

- [ ] **Step 1: Discovery page.** `/baskets` reads `f` (base64url JSON) + `cursor` from search params, validates with `discoveryFiltersSchema` (invalid → ignore), renders `filters-panel` (sections: organization, categories, assets with min/max %, asset types, sectors, tags, max single weight, max minimum, fee ceilings, review frequency, basket age, performance floors, manager experience; collapsible at phone width), sort select, `results-list` cards (1 y net or "New", minimum, management fee, top 3 assets, status badge), load more. Filter changes push a new `f`.
- [ ] **Step 2: AI box.** `ai-search-box`: textarea ≤500, submit → `POST ai-search`; show mode label ("Matched by filters" / "Closest in meaning" / "Keyword match"), Gemini notice "Queries are processed by Google Gemini.", `filter-chips` for returned filters (each removable/editable; editing switches to structured search with those filters via `f`); 429 → "Too many searches. Try again later."
- [ ] **Step 3: Research chart.** `performance-chart`: inline SVG, two lines (net solid, gross dashed), range tabs 30 d / 90 d / 1 y / all, y-axis labels, `role="img"` with `aria-label` summary + a visually available `<details>` data table; metric tiles (since launch, 30 d, 90 d, 1 y, volatility, max drawdown; net headline, gross secondary) with placeholders "Available after 30 days of data" / "Performance unavailable"; the exact `PERFORMANCE_LABEL`. Sector allocation list with bars; tags; manager entries link to `/managers/[handle]` when present.
- [ ] **Step 4: Manager page + editor.** `/managers/[handle]`: profile, "Self-reported" labels on experience/qualifications, "Verified by Bytesac" badge, baskets (current/previous) and organizations; 404 → not-found. `/profile` gains a Manager profile section: form (handle, display name, headline, bio, experience years, background, qualifications list, links list) with schema validation, `HANDLE_TAKEN` inline, Publish/Unpublish, hidden state with the ops reason.
- [ ] **Step 5: Gate + commit.** `pnpm --filter web lint check-types build`, `pnpm --filter @repo/app-core test`; commit `feat(web): add basket discovery, AI search, performance chart and manager profiles`.

---

### Task 4: Web ops additions, web tests, docs

**Files:** create `apps/web/app/(ops)/ops/{tags,manager-profiles}/page.tsx`, `apps/web/components/ops/{asset-tags,manager-profiles}.tsx`, tests `apps/web/test/{discovery-filters,discovery-ai,performance-chart,manager-page,manager-profile-editor,ops-tags,ops-manager-profiles,ops-asset-sector}.test.tsx`, `docs/decisions/ADR-012-DISCOVERY-PERFORMANCE-AI.md`; modify `apps/web/app/(ops)/ops/layout.tsx` (nav Tags, Manager profiles), `apps/web/components/ops/assets/*` (sector select + tag picker), docs below.

- [ ] **Step 1: Ops UI.** Asset editor: sector select + tag multi-picker (active tags). `/ops/tags` (admin): list, create, retire. `/ops/manager-profiles`: list by status, hide (reason required, confirm) / unhide.
- [ ] **Step 2: Web tests:** filters ↔ `f` param round-trip and invalid `f` ignored; results cards; AI search shows mode label, notice, chips; editing a chip re-runs structured search; 429 message; chart renders both lines, range tabs, data table, placeholders and unavailable state (Review Focus 1); manager page labels and badge; profile editor validation, `HANDLE_TAKEN`, publish/unpublish, hidden state; ops tag create/retire; ops hide requires reason; asset sector/tag save.
- [ ] **Step 3: Docs (in place).** ADR-012 (search index, structured filters, Gemini tool calling + fallbacks, privacy, performance methodology + label + fee assumptions, profiles, sector/tags, consequences, open items spec §14). ADR-006 rewritten: BullMQ worker introduced by Spec 7 (jobs, scheduling, single execution), pg_cron keeps retention. `DECISION-REGISTER.md`: rewrite D-018 (BullMQ worker + pg_cron), D-027 (performance freshness/price source for simulation), D-015 (daily snapshots); add `D-062` discovery filters + search index, `D-063` AI search (Gemini tool calling, fallbacks, privacy), `D-064` model performance methodology, `D-065` manager profiles, `D-066` instrument sector + tags. `docs/domains/USER-FEATURES.md` discovery/research implemented; `ASSET-REGISTRY.md` sector/tags; `ARCHITECTURE.md` worker + data model + AI flow; `apps/api/README.md` worker scripts, `GEMINI_*` env, pgvector (local image, Supabase enablement), BullMQ deployment note; HANDOFF §2 Spec 7 row + §5.
- [ ] **Step 4: Gate + commit.** `pnpm db:up`; `pnpm turbo run lint check-types test build` (pre-existing `mobile#check-types` excepted); commits `feat(web): add ops tags and manager profile moderation`, `test(web): cover discovery and profiles`, `docs: record discovery, performance and AI search decisions`.

---

## Self-Review Notes

- Spec coverage: §2 → constraints; §4 → T1 S3/S5; §5 → T1 S1; §6 → T1 S4–S5, T2 S1–S2; §7 → T1 S2, T2 S3–S4, S7; §8 → T2 S5–S6, T3 S3–S4; §9 → T2 S6, T4 S1; §10 → T3, T4; §11 → constraints + tests; §12 → per-task tests; §13 → task split; §14 → ADR-012.
- Plan decisions beyond the spec: filters travel as one base64url JSON `f` param (exact round-trip); BigInt fixed-point instead of a decimal library (no new dependency); a basket day is skipped when a constituent has never had a price.
- Names consistent: `discoveryFiltersSchema`, `effectiveFeeBps`, `computePerformanceDays`, `performanceMetrics`, `enqueue`, `refreshSearchIndex`, `embedBasket`, `structuredSearch`, `aiSearch`, `geminiSearchCall`, `embedText`, `HANDLE_TAKEN`, `PERFORMANCE_LABEL`.

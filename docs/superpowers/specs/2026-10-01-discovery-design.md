# Spec 7 — Discovery, Research, Model Performance and AI Search (Design)

- **Date:** 2026-10-01
- **Status:** Approved in conversation (2026-10-01); written spec pending user review
- **Series:** Spec 7 — after Specs 1–6 (auth, manager application, organizations, members, asset registry, baskets)
- **Builds on:** Spec 3/4 (public organization profile, public team names, member verification), Spec 5 (instruments, CoinMarketCap provider, `getPrices`), Spec 6 (published baskets, public basket pages, assignments, fees schema).
- **Sources:** `docs/source/User-Detailed-Features.txt` §2–§5; `docs/domains/USER-FEATURES.md`; ADR-002, ADR-006, ADR-010, ADR-011; D-015, D-018, D-027.

## 1. Intent

Anyone can find, filter and research published baskets and their managers without signing in. Baskets show **simulated model performance** (net of the basket's fees, gross beside it). A Gemini assistant turns plain-language requests into structured database searches, with semantic and keyword fallbacks. Background jobs (BullMQ) capture daily prices, compute performance and keep a search index. Nothing is invested; no generated advice is shown.

**Success criteria**
1. Every listed basket is searchable by structured filters and sortable; filters live in the URL.
2. AI search returns only what the read-only `search_baskets` tool (or a fallback) returns, with the filters it used shown as editable chips; Gemini prose is never shown.
3. Performance follows the defined methodology, is labelled simulated, uses decimal math for index values, and shows "unavailable" rather than guessing.
4. Manager profiles are opt-in, self-reported claims are labelled, and the verification badge comes only from real platform verifications.
5. Jobs run once per schedule even with several instances, retry with backoff, and never touch money or user data.

## 2. Decisions (this brainstorm)

| Topic | Decision |
|---|---|
| Scope | Structured filters/sorting, research pages, public manager profiles, model performance, AI search. Investor counts excluded (no investors yet). |
| AI | Gemini function calling with one read-only tool `search_baskets` (parameters = `DiscoveryFilters`); zero results or failure → pgvector semantic ranking; failure → keyword search. Only tool/fallback results shown; Gemini text discarded. |
| Jobs | BullMQ on the existing Redis in a separate worker process `apps/api/src/worker.ts`. ADR-006 / D-018 rewritten. |
| Performance | Buy-and-hold each version's target weights, reset to target on each version publish; index = 100 at first publish; net of fees headline (hypothetical investor of `minimumInvestmentUsdc`, §4) + gross; volatility/drawdown after 30 data days; gap > 3 days → unavailable; no backfill. |
| Profiles | One opt-in self-declared profile per user at `/managers/[handle]`; "Verified by Bytesac" only from an approved member verification or OWNER of a VERIFIED organization; ops can hide. |
| Sector / tags | One ops-set `sector` per instrument (weights sum to 100%) plus multiple ops-managed `tags` (filter only). |

## 3. Out of scope

Investor counts and real returns, generated answers/recommendations, price backfill, a jobs ops dashboard, personalized recommendations, saved searches, mobile screens, any investment or execution.

## 4. Model performance methodology

- **Prices:** one USD price per instrument per UTC day from the `price-snapshot` job (CoinMarketCap via the Spec 5 provider). No backfill; history starts at the first snapshot.
- **Index:** per basket, starting on the first publish day at 100 for both `gross` and `net`. On each publish day, holdings reset to that version's target weights; between publishes, each asset's holding moves with its price (buy-and-hold drift). `index_t = Σ holding_i,t`, `holding_i,t = holding_i,t-1 × price_i,t / price_i,t-1`.
- **Fees (net only; hypothetical investment `M = minimumInvestmentUsdc` of the version in effect):**
  - Entry: once on the first publish day — percent: `× (1 − bps/10000)`; fixed: `× (1 − amount/M)`.
  - Management (annual): daily — percent: `× (1 − bps/10000/365)`; fixed: `× (1 − amount/M/365)`.
  - Rebalance: on each later version publish day — percent: `× (1 − bps/10000)`; fixed: `× (1 − amount/M)`.
  - Subscription: at each period start after launch (monthly = same day-of-month, yearly = anniversary) — `× (1 − amount/M)`.
  - Network, swap and slippage costs are not modelled (stated on the page).
- **Gaps:** a missing price repeats the last known price and marks the day `gap = true`; if any constituent has a gap run > 3 consecutive days in the trailing window, metrics are `available = false` ("Performance unavailable").
- **Metrics:** net and gross return since launch, 30 d, 90 d, 1 y (each only when the window is fully covered); annualized volatility of daily net returns (`stdev × √365`) and max drawdown of the net index, only after ≥ 30 data days.
- **Precision:** index values and fee factors use decimal arithmetic with 18 fractional digits (a pinned decimal library, e.g. `decimal.js`, or Postgres `numeric`) stored as `numeric`; volatility is a display statistic computed as a float from the stored decimals.
- **Label:** "Simulated model performance — not actual investor results. Net figures assume an investment equal to the basket minimum and include the basket's fees; network and swap costs are excluded."

## 5. Data model (`@repo/db`, migration `0009_discovery.sql`)

- `CREATE EXTENSION IF NOT EXISTS vector;` (local Docker Postgres image adds pgvector; Supabase provides it).
- `instruments.sector` enum `instrument_sector`: `store_of_value`, `smart_contract_platform`, `layer2`, `defi`, `stablecoin`, `oracle_infra`, `gaming_metaverse`, `ai_data`, `meme`, `rwa_treasury`, `rwa_credit`, `rwa_commodity`, `rwa_equity`, `other` (default `other`).
- `asset_tags`: `id`, `key` (unique `^[a-z0-9-]{2,32}$`), `label` (≤40), `status` (`active`, `retired`), `created_by_user_id`, `created_at`, `retired_at`.
- `instrument_tags`: `id`, `instrument_id`, `tag_id`, `added_by_user_id`, `added_at`, `removed_at`; partial unique one un-removed row per `(instrument_id, tag_id)`.
- `manager_profiles`: `id`, `user_id` (unique), `handle` (unique `^[a-z0-9-]{3,30}$`), `display_name` (2–80), `headline` (≤120), `bio` (≤2000), `experience_years` (0–60, nullable), `background` (≤2000), `qualifications` text[] (≤10, each ≤120), `links` jsonb (≤5 `{ label ≤40, url https }`), `status` (`draft`, `published`, `hidden`), `hidden_reason` (≤500), `hidden_by_user_id`, `published_at`, `created_at`, `updated_at`.
- `instrument_price_snapshots`: `instrument_id`, `day` (date), `price_usd` numeric, `source` (`coinmarketcap`), `captured_at`; PK `(instrument_id, day)`.
- `basket_performance_days`: `basket_id`, `day`, `version_id`, `index_gross` numeric, `index_net` numeric, `gap` bool, `holdings` jsonb (per-instrument decimal holdings for the next day's step); PK `(basket_id, day)`.
- `basket_search_index` (derived; updated in place): `basket_id` (PK), `organization_id`, `organization_name`, `slug`, `status`, `category`, `name`, `short_description`, `exposures` jsonb (`{ instruments: {id, symbol, bps}[], assetTypes: {type, bps}[], sectors: {sector, bps}[] }`), `tags` text[], `max_weight_bps`, `minimum_investment_usdc` numeric, `fee_entry_bps`, `fee_management_bps`, `fee_rebalance_bps`, `fee_subscription_bps` (effective bps at the minimum: percent → bps; fixed → `amount / minimum × 10000`, rounded half-up to an integer), `review_frequency`, `published_at`, `manager_handles` text[], `manager_max_experience_years`, `metrics` jsonb (`{ available, dataDays, net: {sinceLaunch, d30, d90, y1}, gross: {…}, volatility, maxDrawdown }` decimal strings or null), `search_text` tsvector, `embedding` vector(768), `embedding_status` (`pending`, `ready`, `failed`), `embedding_attempts` int, `updated_at`. Rows exist only for listed statuses (Spec 6 public list rule); unlisted baskets are marked by status and excluded in queries.
- Grants/RLS as before (SELECT/INSERT/UPDATE, no DELETE).

## 6. Jobs (BullMQ worker, `apps/api/src/worker.ts`)

- Pinned `bullmq` (newest version allowed by the repo's minimum release age); connection from `env.REDIS_URL`; one `Queue` + `Worker` per job name; repeatable jobs registered on worker start with fixed job ids (single execution across instances).
- `price-snapshot` — daily 00:05 UTC: instruments with an `ACTIVE` market price reference; one batched CMC request (Spec 5 provider); insert `ON CONFLICT DO NOTHING`; on success enqueue `basket-performance`.
- `basket-performance` — per basket with a published version: compute each day after the last computed day up to the latest snapshot day (§4); then refresh that basket's search-index metrics.
- `search-index-refresh` `{ basketId }` — enqueued after commit on basket publish/pause/resume/retire/reassignment/retirement decisions (Spec 6 services) and on instrument sector/tag changes and manager-profile publish/hide (affected baskets); upserts or delists the row; sets `embedding_status = pending` when the published version changed.
- `embed-basket` `{ basketId }` — enqueued after publish; embeds `name + short description + long description + thesis + methodology + category + asset names + sectors + tags` with the Gemini embedding model (768 dimensions); sweep every 15 min retries `pending`/`failed` with `embedding_attempts < 5` (exponential backoff); no key → stays `pending`.
- All jobs: 3 attempts with exponential backoff (except the sweep), logging via `@repo/logger`, failed jobs kept in BullMQ's failed set.
- Env (validated in `env.ts`): `GEMINI_API_KEY` (optional, default ""), `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL` (defaults chosen from the current official Gemini docs at implementation and recorded in the README).

## 7. Search

**`DiscoveryFilters`** (`@repo/validator`, zod; shared by URL params, manual UI and the Gemini tool):
`q?` (≤200), `organizationId?`, `managerHandle?`, `categories?`, `assets?: { instrumentId? | symbol?, minBps?, maxBps? }[]` (≤10), `assetTypes?: { type, minBps?, maxBps? }[]`, `sectors?: { sector, minBps?, maxBps? }[]`, `tags?` (≤10), `maxSingleWeightBps?`, `maxMinimumInvestmentUsdc?` (DecimalString), `maxFeeBps?: { entry?, management?, rebalance?, subscription? }`, `reviewFrequencies?`, `minBasketAgeDays?`, `performance?: { minNetReturn1y?, minNetReturnSinceLaunch?, maxVolatility?, maxDrawdown? }` (decimal strings, fractions e.g. `0.12`), `minManagerExperienceYears?`, `sort?: "relevance" | "newest" | "return_1y" | "return_since_launch" | "minimum_asc" | "management_fee_asc"`, `cursor?`. Unknown keys are dropped (`.strip()`).

- **Structured search** `GET /v1/public/discovery/baskets?<filters>` (`limits.discoveryIp` 60/min/IP): one parameterized Drizzle query over `basket_search_index` (jsonb path predicates for exposures, `&&` for tags, numeric comparisons, `ts_rank` for `q` when sort = relevance), listed statuses only, cursor pagination (20 per page). Results: slug, name, short description, organization name, category, status, top 3 assets by weight, minimum, effective management fee bps, net 1 y (or null) and `available`.
- **AI search** `POST /v1/public/discovery/ai-search { query: string ≤500 }` (`limits.aiSearchIp` 10/min and `limits.aiSearchIpDay` 100/day per IP; `limits.aiSearchGlobalDay` 5000/day):
  1. Gemini `generateContent` with the system instruction "You translate basket search requests into a call to search_baskets. Never answer in prose.", one function declaration `search_baskets` whose parameters are the JSON schema of `DiscoveryFilters` (without `cursor`), function-calling mode forced (`ANY`), timeout 10 s, at most 2 tool rounds. The server validates each call's arguments with `DiscoveryFilters`, runs structured search and returns the result to Gemini only to allow one refinement round.
  2. If the final tool result is empty, or Gemini errors/times out/returns no valid call, or no key: embed the query (same embedding model) and rank listed baskets with `embedding_status = ready` by cosine distance (`<=>`), top 20 → `mode: "semantic"`.
  3. If embedding fails or no key: keyword search (`search_text @@ websearch_to_tsquery(query)`) → `mode: "keyword"`.
  - Response `{ mode: "tool" | "semantic" | "keyword", filters: DiscoveryFilters | null, results }`. Gemini text parts are discarded. Queries are not stored; logs record mode, latency and result count only (no query text).
- Only the query text and the filter JSON schema are sent to Google; no user identity. The UI shows "Queries are processed by Google Gemini."

## 8. Research and profiles

- **Basket research** (`/baskets/[slug]`, extends Spec 6; public detail gains `performance: { available, dataDays, series: { day, net, gross }[] (downsampled to ≤ 400 points), metrics }`, `sectors: {sector, bps}[]`, `tags`, and manager entries with `handle` when a published profile exists): chart (net + gross, range tabs 30 d / 90 d / 1 y / all), metric tiles with placeholders ("Available after 30 days of data", "Performance unavailable"), methodology label (§4), sector allocation, tags.
- **Manager profile** `GET /v1/public/managers/:handle` → profile fields, `selfReported: ["experienceYears", "qualifications"]`, `verified` (approved member verification in any organization, or OWNER of a VERIFIED organization), current and previous baskets (from Spec 6 assignments on listed or retired baskets: slug, name, role, from, to), organizations (current/former with Spec 4 opt-in names). `draft`/`hidden`/unknown → 404.
- **Own profile** (session): `GET /v1/me/manager-profile`, `PUT /v1/me/manager-profile` (create/update; handle taken → 409 `HANDLE_TAKEN`), `POST /v1/me/manager-profile/publish`, `POST …/unpublish`. `hidden` profiles cannot be published by the user (409).
- Manager filters/sorting use published profiles only.

## 9. Ops additions

- Spec 5 asset editor: `sector` select and tag picker (descriptive; audited; allowed while live) — `PATCH /v1/ops/assets/:id` accepts `sector` and `tagIds`.
- `GET/POST /v1/ops/asset-tags`, `POST /v1/ops/asset-tags/:id/retire` (`ops_admin`); `/ops/tags` page.
- `GET /v1/ops/manager-profiles?status=`, `POST /v1/ops/manager-profiles/:id/hide { reason }`, `POST …/unhide` (`ops_reviewer`); `/ops/manager-profiles` page; the owner is emailed on hide/unhide.

## 10. Web

- `/baskets`: filter sidebar synced to URL params (collapsible at phone width), sort select, result cards (1 y net or "New", minimum, management fee, top 3 assets, status badge), load more; AI search box → results with editable filter chips and a mode label ("Matched by filters", "Closest in meaning", "Keyword match") and the Gemini notice.
- Research page additions (§8); small inline SVG line chart (no new chart library), keyboard/screen-reader accessible with a data table fallback.
- `/managers/[handle]` page; profile editor section in `/profile`.
- Ops pages (§9). Dark design system, 44 px, status text + icon, lucide only; plain-text rendering only. No mobile changes.

## 11. Security & safety

- Performance always labelled simulated, before network/swap costs, not a promise; no generated recommendations.
- Gemini is limited to one read-only tool over public data; arguments validated; SQL parameterized; no user identity sent; queries not stored.
- Self-reported profile claims labelled; plain-text rendering; ops moderation audited.
- Jobs read external prices and write only derived tables; no money, no user balances.
- Rate limits on all public discovery endpoints; global AI cap.

## 12. Testing

- **Unit:** performance engine — buy-and-hold drift, reset on version change, each fee type (percent/fixed) applied at the right days on net only, subscription period boundaries, gap carry-forward and the > 3-day unavailable rule, 30-day threshold, golden decimal case; effective fee bps (percent and fixed); `DiscoveryFilters` parsing (unknown keys dropped, bounds).
- **Integration:** price snapshot idempotent; performance job computes only new days and handles a version change; search index refreshed on publish/pause/retire and delisted on retire; each filter and each sort; AI search with mocked Gemini — tool mode results; tool empty → semantic; Gemini error → semantic; embedding error → keyword; no key → keyword; invalid tool args ignored; rate limits (per-IP and global); profile handle uniqueness, publish/unpublish, hide → 404 and user cannot republish; verified badge rules; public responses contain no ids/emails/hidden profiles; worker registers repeatable jobs once (mocked queue).
- **Web:** filters ↔ URL; AI chips editable and re-run structured search; chart + data table; metric placeholders; manager page; profile editor; ops tag and profile moderation.

## 13. Execution shape

Four tasks, one review at the end: (1) DB + migration + validator (filters, performance math, effective fees) + BullMQ worker with `price-snapshot` and `basket-performance`; (2) search index + structured search + embeddings + Gemini tool search with fallbacks + profile APIs + ops APIs (sector, tags, hide) + public APIs + api-client; (3) web public discovery + research page chart + manager pages + profile editor; (4) web ops additions + web tests + docs (ADR-012 discovery/performance/AI; ADR-006 rewritten for BullMQ; D-018 rewritten; new decision rows; `USER-FEATURES.md`; `ASSET-REGISTRY.md` sector/tags; `ARCHITECTURE.md`; `apps/api/README.md` worker, Gemini env, pgvector; HANDOFF).

## 14. Open items

- Gemini plan, quotas and data-use terms (training on queries) — user.
- pgvector index choice (ivfflat vs hnsw) at scale; Supabase extension enablement.
- CoinMarketCap plan for daily snapshots and any future backfill.
- Compliance review of simulated-performance wording and fee assumptions.
- Investor counts (after first investment); jobs ops dashboard; final sector list.

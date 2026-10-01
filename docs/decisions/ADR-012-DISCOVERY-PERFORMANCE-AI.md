# ADR-012: Discovery, simulated model performance and AI search

- **Status:** APPROVED
- **Date:** 2026-10-01
- **Owners:** Backend / Platform
- **Related:** D-015, D-018, D-027, D-062, D-063, D-064, D-065, D-066; ADR-002, ADR-006, ADR-010, ADR-011; `docs/superpowers/specs/2026-10-01-discovery-design.md`

## Context
Anyone must be able to find, filter and research published baskets and their managers without signing in, see how a basket would have behaved, and describe what they want in plain language. Nothing invests, executes or charges in this release, and no generated advice may be shown. History needs scheduled work (daily prices, performance, index refreshes, embeddings), which the pg_cron-only setup of ADR-006 could not do.

## Decision
| Topic | Decision |
|---|---|
| Search index | `basket_search_index` is a derived table, one row per listed basket (`ACTIVE`, `PAUSED`, `REASSIGNMENT_REQUIRED`, `RETIREMENT_PENDING`), updated in place (the runtime role has no `DELETE`; a retired or unlisted basket is marked by status and excluded in queries). It holds exposures (instruments, asset types, sectors in bps), tags, max single weight, minimum, effective fee bps, review frequency, manager handles and experience, metrics, a `tsvector` and a `vector(768)` embedding with `embedding_status`. It carries `current_version_id` to detect a version change. Refresh jobs are enqueued after commit by every path that changes what the index shows: publish, pause, resume, retirement request and decision, platform pause, resume and retire, lead decision, assignment add or end, reassignment notices, instrument sector or tag changes and profile publish, unpublish, hide and unhide. |
| Structured filters | One `DiscoveryFilters` zod schema (`@repo/validator`) serves URL params, the manual UI and the Gemini tool; unknown keys are dropped. Filters travel in the URL as a single `f` param (base64url JSON, exact round trip) plus `cursor`; an invalid `f` is ignored. One parameterized Drizzle query runs over the index (jsonb path predicates, `&&` for tags, numeric comparisons, `ts_rank` for `q`), 20 per page with a keyset cursor over a numeric sort key plus basket id (`relevance` without `q` falls back to newest). Limit: 60 per minute per IP. |
| Fee comparison | `effectiveFeeBps`: a percent fee is its bps; a fixed fee is `amount × 10000 / minimum`, rounded half-up in exact micro-USDC. Fee ceilings compare these effective values. |
| AI search | `POST /v1/public/discovery/ai-search`. Gemini `generateContent` with one read-only function `search_baskets` (parameters = the `DiscoveryFilters` JSON schema without `cursor`), forced function calling (`ANY`), 10 s timeout, at most 2 tool rounds (a second round only when the first result was an error or empty). Arguments are validated by `DiscoveryFilters` (strip unknown keys, bounds), SQL stays parameterized and results come only from the public index. Gemini text parts are discarded. The response is `{ mode: tool, semantic or keyword, filters, results }`. |
| Fallbacks | Empty result, Gemini error or timeout, no valid call, or no key: embed the query and rank listed baskets with `embedding_status = ready` by cosine distance (`<=>`), top 20 (`semantic`). Embedding failure or no key: `websearch_to_tsquery` keyword search (`keyword`). Structured search and keyword mode work without any key. |
| Privacy | Only the query text and the filter JSON schema are sent to Google; no user identity, session or IP. Queries are never stored or logged; logs carry mode, latency and result count. The UI states "Queries are processed by Google Gemini." Limits: 10 per minute and 100 per day per IP, 5000 per day global (one key), consumed before any provider call. |
| Models | `GEMINI_MODEL` default `gemini-3.1-flash-lite` (cheapest stable model; the job is turning a sentence into one tool call), `GEMINI_EMBEDDING_MODEL` default `gemini-embedding-2` with `outputDimensionality: 768`. These were chosen from the Gemini documentation and **have not been exercised against the real API**. |
| Embeddings | Text: name, short and long description, thesis, methodology, category, asset names, sectors and tags. Queued from the index refresh when the version changed (so the row exists), retried by a 15-minute sweep for `pending` or `failed` rows with fewer than 5 attempts; without a key rows stay `pending`. Embed job ids include the attempt count so a retained failed job never blocks the sweep. |
| Performance methodology | Buy-and-hold of each version's target weights, reset to target on each version publish; index 100 at the first computed day. Prices are one CoinMarketCap USD price per instrument per UTC day from the `price-snapshot` job; no backfill. Net applies the basket's fees to a hypothetical investment equal to the minimum of the version in effect: entry once on the first computed day, management compounded daily (`bps/10000/365` or `amount/M/365`), rebalance on each later version publish day, subscription at each period start after launch (month-end clamped). Gross has no fees. Network, swap and slippage costs are not modelled. |
| Fixed-point math | Index values and fee factors are BigInt fixed-point with 18 decimals, stored as `numeric`; never JS `number`. Volatility (stdev of daily net returns × √365) and max drawdown are display statistics computed in floats from the stored decimals; drawdown is a positive fraction (0.25 = 25%), matching the `maxDrawdown` filter. |
| Engine rulings | On a version-change day the old holdings are stepped to that day's prices before the reset (the rebalance fee applies to net after stepping). The entry fee applies on the first computed day, also when the first snapshot arrives after the publish day. A reset is detected by `versionId` change. A missing price repeats the last known price and marks the day a gap; gap runs and last prices are pruned to current constituents so an exited asset cannot keep a basket unavailable. A constituent that has never had a price skips the day (no row), so a basket holding an instrument without a market price reference has no performance. |
| Metrics | Windows (30, 90, 365 days) need a row exactly N days before the last row. `available` is false when any constituent has a gap run above 3 days or the last row is more than 3 days before today. Volatility and drawdown need 30 data days. The public detail returns a series downsampled to at most 400 points. |
| Label | Always shown with performance: "Simulated model performance — not actual investor results. Net figures assume an investment equal to the basket minimum and include the basket's fees; network and swap costs are excluded." Net is the headline, gross is secondary; unavailable data shows "Performance unavailable", short history shows "Available after 30 days of data" style placeholders. |
| Manager profiles | One opt-in profile per user at `/managers/[handle]` (`draft`, `published`, `hidden`), plain text only, handle `^[a-z0-9-]{3,30}$` and unique (409 `HANDLE_TAKEN`); `apply` and `status` are reserved (static routes). Experience and qualifications are labelled "Self-reported". "Verified by Bytesac" comes only from an approved member verification in any organization or an OWNER of a VERIFIED organization. Ops hide with a required reason (audited, owner emailed when a verified email contact exists); a hidden profile returns 404, the owner cannot republish it (409), basket pages fall back to the opt-in team name, and unhide returns it to `draft`. Public basket manager names use the published profile name, else the opt-in membership name, else "Team member". |
| Sector and tags | One ops-set `sector` per instrument (14 fixed values, default `other`), so a basket's sector exposure sums to 100%, plus ops-managed `asset_tags` (active or retired, never deleted) linked through `instrument_tags` (removed rows timestamped). Both are descriptive: editable on a live asset (not while under review or retired), audited, and used for filtering. Retiring a tag stops it being added; assets keep it until ops remove it and the index drops it on the next refresh of each basket. |
| Data | Migration `0009_discovery.sql` (`CREATE EXTENSION IF NOT EXISTS vector`, `instrument_sector`, `instruments.sector`, `asset_tags`, `instrument_tags`, `manager_profiles`, `instrument_price_snapshots`, `basket_performance_days`, `basket_search_index`); SELECT, INSERT and UPDATE grants only, RLS as before. |
| Worker | BullMQ worker (`apps/api/src/worker.ts`) on the existing Redis; see ADR-006. `enqueue` swallows and logs queue errors so a committed change never returns 500. |

## Alternatives considered
- Pure LLM answers or free-text SQL: unbounded output, prompt-injection surface and generated advice. A single read-only tool over a validated schema is bounded.
- Keyword search only: no natural-language entry point.
- Decimal library for index math: another dependency; BigInt fixed-point is exact and enough.
- Real prices backfilled from CoinMarketCap history: needs a paid plan and mixes provenance; history starts at the first snapshot instead.
- Gross-only performance: hides fees that investors would pay.

## Consequences
### Positive
- Discovery works without sign-in and without any AI key; AI only helps to fill the same filters.
- Performance is reproducible: decimal math, stored daily rows, one clearly stated methodology.
- Search results can never contain drafts, hidden profiles, ids or emails.

### Negative / trade-offs
- The index can lag a change by about 10 s (refresh jobs are windowed); a lost enqueue is only repaired by the next change or the next nightly performance run (there is no refresh sweep).
- Performance history is short at launch and unavailable for baskets holding instruments without a market price reference.
- Google Gemini receives query text; terms and data use must be confirmed.
- Assignment ends caused by membership changes that do not lose the leader are not re-indexed until the next refresh.
- Hidden-profile emails are sent only to owners with a verified email contact.

### Security, financial and operational impact
- Jobs read external prices and write only derived tables; no money, balances or user data.
- Simulated performance is labelled, shown before network and swap costs, and is not a promise.
- Operations: run a second process (`start:worker`) with Redis that does not evict keys; pgvector must exist in the database (local image or Supabase extension).

## Migration / rollout
Run `pnpm --filter @repo/db db:migrate` (the local Postgres image needs rebuilding for pgvector: `docker compose down -v` once). Start the worker next to the API. Set `GEMINI_API_KEY` to enable AI search and embeddings; without it search falls back to keyword mode and baskets keep `embedding_status = pending`.

## Validation
API tests cover the engine (drift, entry, fixed and percent fees, compounding, version reset, subscription month-end, gap carry, gap run 3 versus 4, 29 versus 30 days), idempotent snapshots and performance days, index refresh on publish, pause and retire, each filter and sort, AI search with a mocked provider (tool, empty, error, no key, unknown keys, injection-like strings, rate limits) and profile rules. Web tests cover filters and the `f` round trip, results cards, AI mode, notice, chips and 429, the chart (both lines, range tabs, data table, placeholders, unavailable state), the manager page, the profile editor and the ops screens. No test calls Gemini or CoinMarketCap.

## Open questions
- Gemini plan, quotas and data-use terms (training on queries); verify the default models and tool calling with a real key before launch.
- pgvector index choice (ivfflat or hnsw) at scale; Supabase extension enablement.
- CoinMarketCap plan for daily snapshots and any backfill.
- Compliance review of the simulated-performance wording and fee assumptions.
- Investor counts (after the first investment), a jobs dashboard, the final sector list and a refresh sweep.

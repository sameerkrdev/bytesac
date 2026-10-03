import createHttpError from "http-errors";
import { and, asc, cosineDistance, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { basketSearchIndex as idx, db } from "@repo/db";
import { logger } from "@repo/logger";
import { discoveryFiltersSchema, z, type AiSearchResponse, type DiscoveryFilters, type DiscoverySearchItem, type DiscoverySearchResponse } from "@repo/validator";
import { env } from "../env";
import { embedText, geminiSearchCall } from "../providers/gemini";
import { LISTED_BASKET_STATUSES } from "./public-baskets";

const PAGE_SIZE = 20;
const cursorSchema = z.tuple([z.string().regex(/^-?\d+(\.\d+)?$/), z.uuid()]);
const columns = {
  id: idx.basketId, slug: idx.slug, name: idx.name, shortDescription: idx.shortDescription, organizationName: idx.organizationName, category: idx.category, status: idx.status,
  exposures: idx.exposures, minimumInvestmentUsdc: idx.minimumInvestmentUsdc, managementFeeBps: idx.feeManagementBps, metrics: idx.metrics,
};
const toItem = (r: { slug: string; name: string; shortDescription: string | null; organizationName: string; category: string; status: string; exposures: (typeof idx.$inferSelect)["exposures"]; minimumInvestmentUsdc: string; managementFeeBps: number; metrics: (typeof idx.$inferSelect)["metrics"] }) => ({
  slug: r.slug, name: r.name, shortDescription: r.shortDescription, organizationName: r.organizationName, category: r.category, status: r.status,
  topAssets: r.exposures.instruments.slice(0, 3).map((a) => ({ symbol: a.symbol, bps: a.bps })), minimumInvestmentUsdc: r.minimumInvestmentUsdc, managementFeeBps: r.managementFeeBps,
  netReturn1y: r.metrics.available ? r.metrics.net.y1 : null, available: r.metrics.available, hasEligibilityRequirements: r.exposures.assetTypes.some((a) => a.type.startsWith("TOKENIZED_")),
}) as DiscoverySearchItem;

/** Sum of a basket's weight in one exposure entry (0 when absent), e.g. `weight("instruments", "symbol", "BTC")`. `list` and `field` are code constants, never user input. */
const weight = (list: "instruments" | "assetTypes" | "sectors", field: "id" | "symbol" | "type" | "sector", value: string) =>
  sql`coalesce((select sum((e->>'bps')::int) from jsonb_array_elements(${idx.exposures}->${sql.raw(`'${list}'`)}) e where e->>${sql.raw(`'${field}'`)} = ${value}), 0)`;
const textArray = (values: string[]) => sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;
const metric = (path: string) => sql`(${idx.metrics}#>>${sql.raw(`'{${path}}'`)})::numeric`;
const SORT_KEYS: Record<Exclude<NonNullable<DiscoveryFilters["sort"]>, "relevance">, { key: SQL<unknown>; dir: "asc" | "desc" }> = {
  newest: { key: sql`extract(epoch from ${idx.publishedAt})`, dir: "desc" },
  return_1y: { key: sql`coalesce(case when (${idx.metrics}->>'available')::boolean then ${metric("net,y1")} end, -1000)`, dir: "desc" },
  return_since_launch: { key: sql`coalesce(case when (${idx.metrics}->>'available')::boolean then ${metric("net,sinceLaunch")} end, -1000)`, dir: "desc" },
  minimum_asc: { key: sql`${idx.minimumInvestmentUsdc}`, dir: "asc" },
  management_fee_asc: { key: sql`${idx.feeManagementBps}`, dir: "asc" },
};

/** One parameterized query over the search index: listed baskets only, every filter optional, keyset pagination (20 per page). */
export async function structuredSearch(f: DiscoveryFilters): Promise<DiscoverySearchResponse> {
  const c: Array<SQL | undefined> = [inArray(idx.status, [...LISTED_BASKET_STATUSES])];
  const between = (w: SQL, r: { minBps?: number; maxBps?: number }) => {
    if (r.minBps !== undefined) c.push(sql`${w} >= ${r.minBps}`);
    if (r.maxBps !== undefined) c.push(sql`${w} <= ${r.maxBps}`);
  };
  for (const a of f.assets ?? []) between(a.instrumentId ? weight("instruments", "id", a.instrumentId) : weight("instruments", "symbol", a.symbol!), a);
  for (const a of f.assetTypes ?? []) between(weight("assetTypes", "type", a.type), a);
  for (const s of f.sectors ?? []) between(weight("sectors", "sector", s.sector), s);
  if (f.organizationId) c.push(eq(idx.organizationId, f.organizationId));
  if (f.managerHandle) c.push(sql`${f.managerHandle} = any(${idx.managerHandles})`);
  if (f.categories?.length) c.push(inArray(idx.category, f.categories));
  if (f.tags?.length) c.push(sql`${idx.tags} && ${textArray(f.tags)}`);
  if (f.maxSingleWeightBps !== undefined) c.push(sql`${idx.maxWeightBps} <= ${f.maxSingleWeightBps}`);
  if (f.maxMinimumInvestmentUsdc) c.push(sql`${idx.minimumInvestmentUsdc} <= ${f.maxMinimumInvestmentUsdc}::numeric`);
  const fee = f.maxFeeBps;
  if (fee?.entry !== undefined) c.push(sql`${idx.feeEntryBps} <= ${fee.entry}`);
  if (fee?.management !== undefined) c.push(sql`${idx.feeManagementBps} <= ${fee.management}`);
  if (fee?.rebalance !== undefined) c.push(sql`${idx.feeRebalanceBps} <= ${fee.rebalance}`);
  if (fee?.subscription !== undefined) c.push(sql`coalesce(${idx.feeSubscriptionBps}, 0) <= ${fee.subscription}`);
  if (f.reviewFrequencies?.length) c.push(inArray(idx.reviewFrequency, f.reviewFrequencies));
  if (f.minBasketAgeDays !== undefined) c.push(sql`${idx.publishedAt} <= now() - make_interval(days => ${f.minBasketAgeDays})`);
  if (f.minManagerExperienceYears !== undefined) c.push(sql`${idx.managerMaxExperienceYears} >= ${f.minManagerExperienceYears}`);
  const p = f.performance;
  if (p && Object.keys(p).length) {
    // A basket without available performance never passes a performance filter.
    c.push(sql`(${idx.metrics}->>'available')::boolean`);
    if (p.minNetReturn1y) c.push(sql`${metric("net,y1")} >= ${p.minNetReturn1y}::numeric`);
    if (p.minNetReturnSinceLaunch) c.push(sql`${metric("net,sinceLaunch")} >= ${p.minNetReturnSinceLaunch}::numeric`);
    if (p.maxVolatility) c.push(sql`${metric("volatility")} <= ${p.maxVolatility}::numeric`);
    if (p.maxDrawdown) c.push(sql`${metric("maxDrawdown")} <= ${p.maxDrawdown}::numeric`);
  }
  const tsQuery = f.q ? sql`websearch_to_tsquery('english', ${f.q})` : null;
  if (tsQuery) c.push(sql`${idx.searchText} @@ ${tsQuery}`);
  const sort = f.sort === "relevance" && !tsQuery ? "newest" : (f.sort ?? (tsQuery ? "relevance" : "newest"));
  const { key, dir } = sort === "relevance" ? { key: sql`ts_rank(${idx.searchText}, ${tsQuery!})::numeric`, dir: "desc" as const } : SORT_KEYS[sort];
  if (f.cursor) {
    const parsed = cursorSchema.safeParse(Buffer.from(f.cursor, "base64url").toString().split("|"));
    if (!parsed.success) throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    c.push(sql`(${key}, ${idx.basketId}) ${sql.raw(dir === "desc" ? "<" : ">")} (${parsed.data[0]}::numeric, ${parsed.data[1]}::uuid)`);
  }
  const order = dir === "desc" ? desc : asc;
  const rows = await db.select({ ...columns, sortKey: sql<string>`(${key})::text` }).from(idx).where(and(...c)).orderBy(order(key), order(idx.basketId)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return { items: page.map(toItem), nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(`${last.sortKey}|${last.id}`).toString("base64url") : null };
}

/**
 * Gemini turns the query into one validated `search_baskets` call (mode `tool`); an empty result or any Gemini failure falls back to embedding
 * similarity (`semantic`), then to keyword search. Only database results are returned: Gemini text is never used. The query is never stored or logged.
 */
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
      const rows = await db.select(columns).from(idx).where(and(inArray(idx.status, [...LISTED_BASKET_STATUSES]), eq(idx.embeddingStatus, "ready"))).orderBy(cosineDistance(idx.embedding, v)).limit(PAGE_SIZE);
      results = rows.map(toItem);
    } catch {
      mode = "keyword";
      results = (await structuredSearch({ q: query, sort: "relevance" })).items;
    }
  }
  logger.info("ai search", { mode, ms: Date.now() - started, count: results.length });
  return { mode, filters: mode === "tool" ? filters : null, results };
}

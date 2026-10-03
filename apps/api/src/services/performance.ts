import { and, asc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { basketEvents, basketPerformanceDays, basketVersionAssets, basketVersions, baskets, db, instrumentPriceSnapshots, instruments, priceReferences } from "@repo/db";
import { logger } from "@repo/logger";
import { basketFeesSchema, computePerformanceDays, type PerformanceState, type PerformanceVersion } from "@repo/validator";
import { env } from "@/config/dotenv";
import { fetchQuotes } from "@/providers/coinmarketcap";
import { enqueue } from "@/config/queues";
import { LISTED_BASKET_STATUSES } from "./public-baskets";

const CMC_BATCH = 100;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const nextDay = (day: string) => utcDay(new Date(Date.parse(day) + 86_400_000));

/**
 * Captures today's (UTC) USD price for every instrument with an ACTIVE market reference that is ACTIVE or held by a published basket's current version
 * (a PAUSED/DEPRECATED holding still drifts in the index, D-015). All batches are fetched before anything is written, so a
 * provider failure writes nothing and throws (BullMQ retries); a rerun on the same day changes nothing.
 */
export async function runPriceSnapshot(): Promise<void> {
  if (!env.COINMARKETCAP_API_KEY) {
    logger.warn("price snapshot skipped: no CoinMarketCap key");
    return;
  }
  const refs = await db.select({ instrumentId: priceReferences.instrumentId, cmcId: priceReferences.externalId }).from(priceReferences)
    .innerJoin(instruments, eq(instruments.id, priceReferences.instrumentId))
    .where(and(eq(priceReferences.kind, "market"), eq(priceReferences.status, "ACTIVE"), or(eq(instruments.status, "ACTIVE"), sql`exists (
      select 1 from app.baskets b join app.basket_versions bv on bv.id = b.current_version_id join app.basket_version_assets bva on bva.version_id = bv.id and bva.revision = bv.assets_revision
      where bva.instrument_id = ${instruments.id} and b.status in (${sql.join(LISTED_BASKET_STATUSES.map((st) => sql`${st}`), sql`, `)}))`)));
  const cmcIds = [...new Set(refs.map((r) => r.cmcId!))];
  const quotes = new Map<string, string>();
  for (let k = 0; k < cmcIds.length; k += CMC_BATCH) for (const [id, q] of await fetchQuotes(cmcIds.slice(k, k + CMC_BATCH))) quotes.set(id, q.value);
  const day = utcDay(new Date());
  const rows = refs.flatMap((r) => { const price = quotes.get(r.cmcId!); return price && Number(price) > 0 ? [{ instrumentId: r.instrumentId, day, priceUsd: price }] : []; });
  if (rows.length) await db.insert(instrumentPriceSnapshots).values(rows).onConflictDoNothing();
  logger.info("price snapshot", { day, instruments: refs.length, stored: rows.length });
  await enqueue("basket-performance", {});
}

/**
 * Computes the missing performance days of published baskets (one, or all) from the stored price snapshots, then asks for a search-index refresh.
 * Rows are keyed `(basket, day)`, so a rerun or a second worker inserts nothing twice. A retired basket stops at its retirement day.
 */
export async function runBasketPerformance(basketId?: string): Promise<void> {
  const rows = await db.select({ id: baskets.id, status: baskets.status }).from(baskets)
    .where(and(isNotNull(baskets.currentVersionId), inArray(baskets.status, [...LISTED_BASKET_STATUSES, "RETIRED"]), basketId ? eq(baskets.id, basketId) : undefined));
  const [latest] = await db.select({ day: sql<string | null>`max(${instrumentPriceSnapshots.day})::text` }).from(instrumentPriceSnapshots);
  const compute = async (basket: (typeof rows)[number], latestDay: string) => {
    const published = await db.select().from(basketVersions).where(and(eq(basketVersions.basketId, basket.id), inArray(basketVersions.status, ["published", "superseded"]))).orderBy(asc(basketVersions.publishedAt));
    const weights = await db.select({ versionId: basketVersionAssets.versionId, instrumentId: basketVersionAssets.instrumentId, bps: basketVersionAssets.targetWeightBps })
      .from(basketVersionAssets).innerJoin(basketVersions, and(eq(basketVersions.id, basketVersionAssets.versionId), eq(basketVersions.assetsRevision, basketVersionAssets.revision)))
      .where(inArray(basketVersionAssets.versionId, published.map((v) => v.id)));
    const versions = published.map((v): PerformanceVersion => ({
      versionId: v.id, publishedDay: utcDay(v.publishedAt!), minimumUsdc: v.minimumInvestmentUsdc!, fees: basketFeesSchema.parse(v.fees),
      weights: weights.filter((w) => w.versionId === v.id).map(({ instrumentId, bps }) => ({ instrumentId, bps })),
    }));
    if (!versions.length) return;
    const [last] = await db.select().from(basketPerformanceDays).where(eq(basketPerformanceDays.basketId, basket.id)).orderBy(sql`${basketPerformanceDays.day} desc`).limit(1);
    let end = latestDay;
    if (basket.status === "RETIRED") {
      const [retired] = await db.select({ day: sql<string>`(${basketEvents.createdAt} at time zone 'UTC')::date::text` }).from(basketEvents)
        .where(and(eq(basketEvents.basketId, basket.id), eq(basketEvents.toStatus, "RETIRED"))).orderBy(sql`${basketEvents.createdAt} desc`).limit(1);
      if (retired && retired.day < end) end = retired.day;
    }
    const start = last ? nextDay(last.day) : versions[0]!.publishedDay;
    const instrumentIds = [...new Set(versions.flatMap((v) => v.weights.map((w) => w.instrumentId)))];
    const snapshots = await db.select({ instrumentId: instrumentPriceSnapshots.instrumentId, day: instrumentPriceSnapshots.day, price: instrumentPriceSnapshots.priceUsd }).from(instrumentPriceSnapshots)
      .where(and(inArray(instrumentPriceSnapshots.instrumentId, instrumentIds), gte(instrumentPriceSnapshots.day, last ? last.day : start)));
    const prices: Record<string, Record<string, string>> = {};
    for (const s of snapshots) (prices[s.instrumentId] ??= {})[s.day] = s.price;
    const firstPriced = snapshots.reduce<string | null>((min, s) => (min === null || s.day < min ? s.day : min), null);
    if (!firstPriced) return;
    const days: string[] = [];
    for (let d = firstPriced > start ? firstPriced : start; d <= end; d = nextDay(d)) days.push(d);
    const from: PerformanceState | null = last ? {
      day: last.day, versionId: last.versionId, indexGross: last.indexGross, indexNet: last.indexNet,
      holdingsGross: last.holdings.gross, holdingsNet: last.holdings.net, lastPrices: last.holdings.lastPrices, gapRun: last.holdings.gapRun,
    } : null;
    const computed = computePerformanceDays({ versions, prices, from, days });
    if (!computed.length) return;
    await db.insert(basketPerformanceDays).values(computed.map((r) => ({
      basketId: basket.id, day: r.day, versionId: r.versionId, indexGross: r.indexGross, indexNet: r.indexNet, gap: r.gap,
      holdings: { gross: r.holdingsGross, net: r.holdingsNet, lastPrices: r.lastPrices, gapRun: r.gapRun },
    }))).onConflictDoNothing();
  };
  for (const basket of rows) {
    // One failing basket must not block the rest; every listed basket is re-indexed each run so a lost publish-time refresh heals (metrics go stale too).
    try { if (latest?.day) await compute(basket, latest.day); } catch (err) { logger.error("basket performance failed", { basketId: basket.id, error: err instanceof Error ? err.message : "unknown" }); }
    await enqueue("search-index-refresh", { basketId: basket.id });
  }
}

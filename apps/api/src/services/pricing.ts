import { and, desc, eq, inArray } from "drizzle-orm";
import { db, navObservations, priceReferences } from "@repo/db";
import { logger } from "@repo/logger";
import type { PriceView } from "@repo/validator";
import { env } from "../env";
import { redis } from "../middleware/rate-limit";
import { fetchQuotes } from "../providers/coinmarketcap";

const STALE_MS = 5 * 60_000;

/**
 * Informational prices for the active references of `instrumentIds`: market (CoinMarketCap, cached 60 s in Redis) and NAV (latest issuer entry) are
 * separate entries and never converted. A missing key or provider failure yields `unavailable`, never an error.
 */
export async function getPrices(instrumentIds: string[]): Promise<PriceView[]> {
  if (!instrumentIds.length) return [];
  const refs = await db.select().from(priceReferences).where(and(inArray(priceReferences.instrumentId, instrumentIds), eq(priceReferences.status, "ACTIVE")));
  const market = refs.filter((r) => r.kind === "market");
  const cached = market.length ? await redis.mget(market.map((r) => `price:cmc:${r.externalId}`)) : [];
  const quotes = new Map<string, { value: string; observedAt: string }>();
  market.forEach((r, i) => { const hit = cached[i]; if (hit) quotes.set(r.externalId!, JSON.parse(hit)); });
  const missing = [...new Set(market.map((r) => r.externalId!).filter((cmcId) => !quotes.has(cmcId)))];
  if (missing.length && env.COINMARKETCAP_API_KEY) {
    try {
      const fresh = await fetchQuotes(missing);
      const pipe = redis.pipeline();
      for (const [cmcId, q] of fresh) { quotes.set(cmcId, q); pipe.set(`price:cmc:${cmcId}`, JSON.stringify(q), "EX", 60); }
      await pipe.exec();
    } catch (err) {
      logger.warn("coinmarketcap quotes unavailable", { errMessage: err instanceof Error ? err.message : "unknown" });
    }
  }
  const navRefs = refs.filter((r) => r.kind === "nav");
  const navRows = navRefs.length
    ? await db.selectDistinctOn([navObservations.priceReferenceId]).from(navObservations).where(inArray(navObservations.priceReferenceId, navRefs.map((r) => r.id)))
      .orderBy(navObservations.priceReferenceId, desc(navObservations.asOf), desc(navObservations.createdAt))
    : [];
  return refs.map((r): PriceView => {
    if (r.kind === "market") {
      const q = quotes.get(r.externalId!);
      return q
        ? { instrumentId: r.instrumentId, kind: "market", status: "ok", value: q.value, currency: "USD", source: "coinmarketcap", observedAt: q.observedAt, stale: Date.now() - Date.parse(q.observedAt) > STALE_MS }
        : { instrumentId: r.instrumentId, kind: "market", status: "unavailable", value: null, currency: "USD", source: "coinmarketcap", observedAt: null, stale: false };
    }
    const n = navRows.find((row) => row.priceReferenceId === r.id);
    return { instrumentId: r.instrumentId, kind: "nav", status: n ? "ok" : "unavailable", value: n?.value ?? null, currency: "USD", source: "issuer", observedAt: n ? n.asOf : null, stale: false };
  });
}

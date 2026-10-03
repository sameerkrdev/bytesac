import { z } from "@repo/validator";
import { env } from "@/config/dotenv";

const entry = z.object({ quote: z.object({ USD: z.object({ price: z.number().finite().nonnegative(), last_updated: z.iso.datetime({ offset: true }) }) }) });
/** Lookups by `id` return an object per id; by symbol, an array. Both are accepted. */
const response = z.object({ data: z.record(z.string(), z.unknown()) });
const oneOrMany = z.union([entry, z.array(entry).min(1)]);

/**
 * USD quotes for CoinMarketCap ids in one batched call (5 s timeout). `skip_invalid=true` (documented: without it any invalid id fails the whole request with 400) leaves an unknown id out of the response. Ids missing from the response, or whose own entry is unusable (null/non-numeric price), are missing from the map; any HTTP, network
 * or whole-body shape failure throws, and the caller reports "unavailable".
 */
export async function fetchQuotes(cmcIds: string[]): Promise<Map<string, { value: string; observedAt: string }>> {
  const res = await fetch(`https://pro-api.coinmarketcap.com/v2/cryptocurrency/quotes/latest?id=${cmcIds.join(",")}&convert=USD&skip_invalid=true`, {
    headers: { "X-CMC_PRO_API_KEY": env.COINMARKETCAP_API_KEY, Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`CoinMarketCap responded ${res.status}`);
  const { data } = response.parse(await res.json());
  return new Map(Object.entries(data).flatMap(([id, raw]) => {
    const parsed = oneOrMany.safeParse(raw);
    if (!parsed.success) return [];
    const e = parsed.data;
    const { price, last_updated } = (Array.isArray(e) ? e[0]! : e).quote.USD;
    // ponytail: a JS float is display-grade only; authoritative valuation needs a decimal source. toLocaleString avoids exponent notation (e.g. 1e-7), which the decimal-string contract forbids.
    return [[id, { value: price.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 18 }), observedAt: new Date(last_updated).toISOString() }]] as const;
  }));
}

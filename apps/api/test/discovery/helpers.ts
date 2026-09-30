import { adminSql } from "../helpers/db";

export const dayList = (start: string, n: number) => Array.from({ length: n }, (_, k) => new Date(Date.parse(start) + k * 86_400_000).toISOString().slice(0, 10));

/** Price snapshots: `prices[k]` is the USD price of `instrumentId` on the k-th day from `start` (null = no snapshot that day). */
export async function snapshots(instrumentId: string, start: string, prices: Array<string | null>) {
  for (const [k, day] of dayList(start, prices.length).entries()) {
    if (prices[k] !== null) await adminSql`INSERT INTO app.instrument_price_snapshots (instrument_id, day, price_usd) VALUES (${instrumentId}, ${day}, ${prices[k]!}) ON CONFLICT DO NOTHING`;
  }
}

export const setPublishedAt = (versionId: string, iso: string) => adminSql`UPDATE app.basket_versions SET published_at = ${iso} WHERE id = ${versionId}`;

export const performanceRows = (basketId: string) =>
  adminSql<{ day: string; version_id: string; index_gross: string; index_net: string; gap: boolean; holdings: { gross: Record<string, string> } }[]>`
    SELECT day::text, version_id, index_gross::text, index_net::text, gap, holdings FROM app.basket_performance_days WHERE basket_id = ${basketId} ORDER BY day`;

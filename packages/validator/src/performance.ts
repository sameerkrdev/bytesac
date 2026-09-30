import type { BasketFees, Fee } from "./baskets";

// BigInt fixed point, 18 fractional digits. Never a JS number for index values or fee factors.
const S = 10n ** 18n;
const dec = (s: string): bigint => {
  const [i = "0", f = ""] = s.split(".");
  const neg = i.startsWith("-");
  const v = BigInt(i.replace("-", "")) * S + BigInt((f + "0".repeat(18)).slice(0, 18));
  return neg ? -v : v;
};
const str = (v: bigint): string => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  return `${neg ? "-" : ""}${a / S}.${(a % S).toString().padStart(18, "0")}`;
};
const mul = (a: bigint, b: bigint) => (a * b) / S;
const div = (a: bigint, b: bigint) => (a * S) / b;

export interface PerformanceVersion {
  versionId: string;
  /** UTC `YYYY-MM-DD` of `published_at`. */
  publishedDay: string;
  minimumUsdc: string;
  weights: { instrumentId: string; bps: number }[];
  fees: BasketFees;
}
export interface PerformanceState {
  day: string;
  versionId: string;
  indexGross: string;
  indexNet: string;
  holdingsGross: Record<string, string>;
  holdingsNet: Record<string, string>;
  lastPrices: Record<string, string>;
  gapRun: Record<string, number>;
}
export interface PerformanceInput {
  /** Ascending by `publishedDay`. */
  versions: PerformanceVersion[];
  /** instrumentId → day → USD price. */
  prices: Record<string, Record<string, string>>;
  /** The last computed day, or null at launch. */
  from: PerformanceState | null;
  /** UTC days to compute, ascending. */
  days: string[];
}
export interface PerformanceDay extends PerformanceState {
  gap: boolean;
}

const utc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (day: string, n: number) => new Date(utc(day) + n * 86_400_000).toISOString().slice(0, 10);

/** Subscription period start after launch: same day-of-month (clamped to month end) for monthly, the anniversary for yearly; never on the anchor day. */
const isPeriodStart = (period: "monthly" | "yearly", anchor: string, day: string): boolean => {
  if (day <= anchor) return false;
  const [ay, am, ad] = anchor.split("-").map(Number) as [number, number, number];
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  if (period === "yearly" && m !== am) return false;
  return d === Math.min(ad, daysInMonth(y, m));
};

/**
 * Buy-and-hold index per UTC day (spec §4). Holdings drift with price; when a version is published they are stepped to that day, then reset to the new
 * target weights. Fees hit the net index only, for a hypothetical investment equal to the version's minimum. A missing price repeats the last known one
 * and flags the day; a constituent that never had a price skips the day (no row).
 */
export function computePerformanceDays(i: PerformanceInput): PerformanceDay[] {
  const out: PerformanceDay[] = [];
  let prev = i.from;
  for (const day of i.days) {
    const version = [...i.versions].reverse().find((v) => v.publishedDay <= day);
    if (!version) continue;
    const held = prev && prev.versionId !== version.versionId ? Object.keys(prev.holdingsGross) : [];
    const lastPrices = { ...(prev?.lastPrices ?? {}) };
    const gapRun = { ...(prev?.gapRun ?? {}) };
    let gap = false;
    for (const id of new Set([...version.weights.map((w) => w.instrumentId), ...held])) {
      const p = i.prices[id]?.[day];
      if (p) { lastPrices[id] = p; gapRun[id] = 0; }
      else { gap = gap || version.weights.some((w) => w.instrumentId === id); gapRun[id] = (gapRun[id] ?? 0) + 1; }
    }
    if ([...version.weights.map((w) => w.instrumentId), ...held].some((id) => !lastPrices[id])) continue;

    const M = dec(version.minimumUsdc);
    const fixedFactor = (amount: string, perDay = 1n) => S - div(dec(amount), M * perDay);
    const feeFactor = (fee: Fee, perDay = 1n) => (fee.type === "percent" ? S - (BigInt(fee.bps) * S) / (10_000n * perDay) : fixedFactor(fee.amountUsdc, perDay));
    const step = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([id, v]) => [id, div(mul(dec(v), dec(lastPrices[id]!)), dec(prev!.lastPrices[id]!))]));
    const sum = (h: Record<string, bigint>) => Object.values(h).reduce((a, b) => a + b, 0n);

    let gross: bigint, net: bigint, hg: Record<string, bigint>, hn: Record<string, bigint>;
    if (!prev || prev.versionId !== version.versionId) {
      // Launch (entry fee) or a new version (rebalance fee): continue the index, reset holdings to the target weights.
      gross = prev ? sum(step(prev.holdingsGross)) : 100n * S;
      net = prev ? sum(step(prev.holdingsNet)) : 100n * S;
      net = mul(net, feeFactor(prev ? version.fees.rebalance : version.fees.entry));
      hg = Object.fromEntries(version.weights.map((w) => [w.instrumentId, (gross * BigInt(w.bps)) / 10_000n]));
      hn = Object.fromEntries(version.weights.map((w) => [w.instrumentId, (net * BigInt(w.bps)) / 10_000n]));
    } else {
      hg = step(prev.holdingsGross);
      hn = step(prev.holdingsNet);
      let f = feeFactor(version.fees.management, 365n);
      const sub = version.fees.subscription;
      if (sub && isPeriodStart(sub.period, i.versions[0]!.publishedDay, day)) f = mul(f, fixedFactor(sub.amountUsdc));
      hn = Object.fromEntries(Object.entries(hn).map(([id, v]) => [id, mul(v, f)]));
      gross = sum(hg);
      net = sum(hn);
    }
    // Only the current constituents carry forward (an exited asset's gap run must not mark the basket unavailable).
    const keep = <T>(m: Record<string, T>) => Object.fromEntries(version.weights.map((w) => [w.instrumentId, m[w.instrumentId]!]));
    const row: PerformanceDay = {
      day, versionId: version.versionId, indexGross: str(gross), indexNet: str(net), gap,
      holdingsGross: Object.fromEntries(Object.entries(hg).map(([k, v]) => [k, str(v)])),
      holdingsNet: Object.fromEntries(Object.entries(hn).map(([k, v]) => [k, str(v)])),
      lastPrices: keep(lastPrices), gapRun: keep(gapRun),
    };
    out.push(row);
    prev = row;
  }
  return out;
}

export interface PerformanceMetrics {
  available: boolean;
  dataDays: number;
  net: { sinceLaunch: string | null; d30: string | null; d90: string | null; y1: string | null };
  gross: { sinceLaunch: string | null; d30: string | null; d90: string | null; y1: string | null };
  volatility: string | null;
  maxDrawdown: string | null;
}

/** `(a / b − 1)` as a signed decimal string with 6 fractional digits (truncated toward zero). */
const fraction = (a: string, b: string): string => {
  const q = ((dec(a) - dec(b)) * 1_000_000n) / dec(b);
  const abs = q < 0n ? -q : q;
  return `${q < 0n ? "-" : ""}${abs / 1_000_000n}.${(abs % 1_000_000n).toString().padStart(6, "0")}`;
};

/**
 * Windows are measured back from the last computed day and only reported when a row exists exactly that many days earlier. Volatility
 * (stdev of daily net returns × √365) and max drawdown of the net index need 30 data days. Stale data (last day more than 3 days before `today`)
 * or any constituent with a gap run above 3 days means `available: false`.
 */
export function performanceMetrics(days: PerformanceDay[], today: string): PerformanceMetrics {
  const last = days.at(-1);
  const empty = { sinceLaunch: null, d30: null, d90: null, y1: null };
  if (!last) return { available: false, dataDays: 0, net: empty, gross: empty, volatility: null, maxDrawdown: null };
  const byDay = new Map(days.map((d) => [d.day, d]));
  const window = (key: "indexNet" | "indexGross") => {
    const at = (n: number) => { const r = byDay.get(addDays(last.day, -n)); return r ? fraction(last[key], r[key]) : null; };
    return { sinceLaunch: fraction(last[key], days[0]![key]), d30: at(30), d90: at(90), y1: at(365) };
  };
  const available = Object.values(last.gapRun).every((g) => g <= 3) && last.day >= addDays(today, -3);
  let volatility: string | null = null;
  let maxDrawdown: string | null = null;
  if (days.length >= 30) {
    const net = days.map((d) => Number(d.indexNet));
    const r = net.slice(1).map((v, k) => v / net[k]! - 1);
    const mean = r.reduce((a, b) => a + b, 0) / r.length;
    volatility = (Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1)) * Math.sqrt(365)).toFixed(6);
    let peak = net[0]!;
    let dd = 0;
    for (const v of net) { peak = Math.max(peak, v); dd = Math.max(dd, (peak - v) / peak); }
    maxDrawdown = dd.toFixed(6);
  }
  return { available, dataDays: days.length, net: window("indexNet"), gross: window("indexGross"), volatility, maxDrawdown };
}

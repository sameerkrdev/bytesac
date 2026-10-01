import { describe, expect, it } from "vitest";
import { computePerformanceDays, performanceMetrics, type PerformanceInput, type PerformanceVersion } from "./performance";

const FEES0 = { entry: { type: "percent", bps: 0 }, management: { type: "percent", bps: 0 }, rebalance: { type: "percent", bps: 0 }, subscription: null } as const;
const range = (start: string, n: number) => Array.from({ length: n }, (_, k) => new Date(Date.parse(start) + k * 86_400_000).toISOString().slice(0, 10));
const v = (over: Partial<PerformanceVersion> = {}): PerformanceVersion => ({
  versionId: "v1", publishedDay: "2026-03-01", minimumUsdc: "1000", weights: [{ instrumentId: "A", bps: 5000 }, { instrumentId: "B", bps: 5000 }], fees: FEES0, ...over,
});
const run = (over: Partial<PerformanceInput> & { versions: PerformanceVersion[] }) => computePerformanceDays({ prices: {}, from: null, days: [], ...over });
/** Constant prices for A and B over `days`. */
const flat = (days: string[]) => ({ A: Object.fromEntries(days.map((d) => [d, "10"])), B: Object.fromEntries(days.map((d) => [d, "5"])) });

describe("computePerformanceDays", () => {
  it("drifts holdings with price: 50/50, one asset doubles -> gross 150", () => {
    const rows = run({ versions: [v()], days: ["2026-03-01", "2026-03-02"], prices: { A: { "2026-03-01": "10", "2026-03-02": "20" }, B: { "2026-03-01": "5", "2026-03-02": "5" } } });
    expect(rows.map((r) => r.indexGross)).toEqual(["100.000000000000000000", "150.000000000000000000"]);
    expect(rows[1]!.holdingsGross).toEqual({ A: "100.000000000000000000", B: "50.000000000000000000" });
  });

  it("applies the entry fee to net only: 1% percent -> 99, fixed 10 on 1000 -> 99", () => {
    const days = ["2026-03-01"];
    for (const entry of [{ type: "percent", bps: 100 }, { type: "fixed", amountUsdc: "10" }] as const) {
      const [row] = run({ versions: [v({ fees: { ...FEES0, entry } })], days, prices: flat(days) });
      expect(row!.indexNet).toBe("99.000000000000000000");
      expect(row!.indexGross).toBe("100.000000000000000000");
    }
  });

  it("management 100 bps per year compounds daily over 365 days", () => {
    const days = range("2026-03-01", 366);
    const rows = run({ versions: [v({ fees: { ...FEES0, management: { type: "percent", bps: 100 } } })], days, prices: flat(days) });
    expect(Number(rows.at(-1)!.indexNet)).toBeCloseTo(100 * (1 - 0.01 / 365) ** 365, 9);
    expect(rows.at(-1)!.indexGross).toBe("100.000000000000000000");
  });

  it("a new version steps to its publish day, resets to the new weights and charges the rebalance fee", () => {
    const days = range("2026-03-01", 3);
    const prices = { A: { [days[0]!]: "10", [days[1]!]: "20", [days[2]!]: "30" }, B: { [days[0]!]: "5", [days[1]!]: "5", [days[2]!]: "5" } };
    const v2 = v({ versionId: "v2", publishedDay: days[2]!, weights: [{ instrumentId: "A", bps: 10_000 }], fees: { ...FEES0, rebalance: { type: "percent", bps: 50 } } });
    const rows = run({ versions: [v(), v2], days, prices });
    expect(rows[2]!.versionId).toBe("v2");
    expect(rows[2]!.indexGross).toBe("200.000000000000000000"); // stepped to the publish day: 5 A at 30 + 10 B at 5
    expect(rows[2]!.indexNet).toBe("199.000000000000000000");
    expect(rows[2]!.holdingsGross).toEqual({ A: "200.000000000000000000" });
    expect(Object.keys(rows[2]!.lastPrices)).toEqual(["A"]);
  });

  it("a version publish day still charges management and a subscription period start (before the rebalance fee)", () => {
    const days = range("2026-03-01", 32); // Mar 1 .. Apr 1
    const fees = { ...FEES0, subscription: { amountUsdc: "10", period: "monthly" as const } };
    const v2 = v({ versionId: "v2", publishedDay: "2026-04-01", fees: { ...fees, management: { type: "percent", bps: 3650 }, rebalance: { type: "percent", bps: 100 } } });
    const rows = run({ versions: [v({ fees }), v2], days, prices: flat(days) });
    // 100 on Mar 31, then x(1 - 0.001 daily mgmt) x(1 - 10/1000 subscription) x(1 - 1% rebalance) on Apr 1
    expect(Number(rows.at(-1)!.indexNet)).toBeCloseTo(100 * 0.999 * 0.99 * 0.99, 9);
  });

  it("net since launch is measured from 100, so the entry fee counts", () => {
    const days = range("2026-03-01", 2);
    const rows = run({ versions: [v({ fees: { ...FEES0, entry: { type: "percent", bps: 100 } } })], days, prices: flat(days) });
    const m = performanceMetrics(rows, days[1]!);
    expect(m.net.sinceLaunch).toBe("-0.010000");
    expect(m.gross.sinceLaunch).toBe("0.000000");
  });

  it("resumes from a stored day and matches a full run", () => {
    const days = range("2026-03-01", 5);
    const prices = { A: Object.fromEntries(days.map((d, k) => [d, String(10 + k)])), B: Object.fromEntries(days.map((d, k) => [d, String(5 + 2 * k)])) };
    const full = run({ versions: [v()], days, prices });
    const { gap: _gap, ...from } = full[1]!;
    expect(run({ versions: [v()], days: days.slice(2), prices, from })).toEqual(full.slice(2));
  });

  it("deducts a monthly subscription on the day-of-month only (clamped to month end), never on the anchor day", () => {
    const days = range("2026-01-30", 33); // Jan 30 .. Mar 3
    const fees = { ...FEES0, subscription: { amountUsdc: "10", period: "monthly" as const } };
    const rows = run({ versions: [v({ publishedDay: "2026-01-30", fees })], days, prices: flat(days) });
    const net = Object.fromEntries(rows.map((r) => [r.day, r.indexNet]));
    expect(net["2026-01-30"]).toBe("100.000000000000000000");
    expect(net["2026-02-27"]).toBe("100.000000000000000000");
    expect(net["2026-02-28"]).toBe("99.000000000000000000");
    expect(net["2026-03-02"]).toBe("99.000000000000000000");
    expect(net["2026-03-03"]).toBe("99.000000000000000000");
    const yearly = run({ versions: [v({ publishedDay: "2026-01-30", fees: { ...FEES0, subscription: { amountUsdc: "10", period: "yearly" } } })], days, prices: flat(days) });
    expect(yearly.at(-1)!.indexNet).toBe("100.000000000000000000");
  });

  it("carries the last price through a gap and flags the day", () => {
    const days = range("2026-03-01", 3);
    const rows = run({ versions: [v()], days, prices: { A: { [days[0]!]: "10", [days[2]!]: "20" }, B: flat(days).B } });
    expect(rows.map((r) => r.gap)).toEqual([false, true, false]);
    expect(rows[1]!.indexGross).toBe("100.000000000000000000");
    expect(rows[2]!.indexGross).toBe("150.000000000000000000");
    expect(rows[1]!.gapRun.A).toBe(1);
    expect(rows[2]!.gapRun.A).toBe(0);
  });

  it("skips days while a constituent has never had a price", () => {
    const days = range("2026-03-01", 2);
    const rows = run({ versions: [v()], days, prices: { A: { [days[1]!]: "10" }, B: { [days[1]!]: "5" } } });
    expect(rows.map((r) => r.day)).toEqual([days[1]]);
  });
});

describe("performanceMetrics", () => {
  const series = (n: number) => {
    const days = range("2026-03-01", n);
    const prices = { A: Object.fromEntries(days.map((d, k) => [d, String(10 + (k % 3))])), B: flat(days).B };
    return { days, rows: run({ versions: [v()], days, prices }) };
  };

  it("reports unavailable when a constituent has a gap run above 3 days, available at exactly 3", () => {
    const days = range("2026-03-01", 5);
    const prices = (priced: number) => ({ A: Object.fromEntries(days.slice(0, priced).map((d) => [d, "10"])), B: flat(days).B });
    const at3 = run({ versions: [v()], days, prices: prices(2) });
    expect(at3.at(-1)!.gapRun.A).toBe(3);
    expect(performanceMetrics(at3, days[4]!).available).toBe(true);
    const at4 = run({ versions: [v()], days, prices: prices(1) });
    expect(at4.at(-1)!.gapRun.A).toBe(4);
    expect(performanceMetrics(at4, days[4]!).available).toBe(false);
  });

  it("is unavailable when the stored series is stale", () => {
    expect(performanceMetrics(series(5).rows, "2026-03-20").available).toBe(false);
  });

  it("needs 30 data days for volatility and drawdown, and a full window for returns", () => {
    const s29 = series(29);
    const m29 = performanceMetrics(s29.rows, s29.days.at(-1)!);
    expect([m29.volatility, m29.maxDrawdown, m29.net.d30]).toEqual([null, null, null]);
    const s30 = series(30);
    const m30 = performanceMetrics(s30.rows, s30.days.at(-1)!);
    expect(m30.volatility).not.toBeNull();
    expect(m30.maxDrawdown).not.toBeNull();
    expect(m30.net.d30).toBeNull(); // 30 rows span 29 days
    const s31 = series(31);
    const m31 = performanceMetrics(s31.rows, s31.days.at(-1)!);
    expect(m31.net.d30).toMatch(/^-?\d+\.\d{6}$/);
    expect(m31.net.d90).toBeNull();
    expect(m31.dataDays).toBe(31);
  });

  it("returns since launch as a 6-decimal fraction and drawdown as the largest peak-to-trough fall", () => {
    const days = range("2026-03-01", 2);
    const prices = { A: { [days[0]!]: "10", [days[1]!]: "20" } };
    const rows = run({ versions: [v({ weights: [{ instrumentId: "A", bps: 10_000 }] })], days, prices });
    expect(performanceMetrics(rows, days[1]!).net.sinceLaunch).toBe("1.000000");
  });

  it("max drawdown is the largest peak-to-trough fall of the net index", () => {
    const days = range("2026-03-01", 40);
    const px = days.map((_, k) => (k < 10 ? 10 + k : k < 20 ? 19 - (k - 9) : 10 + (k - 19) / 2)); // up to 19, down to 9, then recover
    const prices = { A: Object.fromEntries(days.map((d, k) => [d, String(px[k])])) };
    const rows = run({ versions: [v({ weights: [{ instrumentId: "A", bps: 10_000 }] })], days, prices });
    expect(performanceMetrics(rows, days.at(-1)!).maxDrawdown).toBe(((19 - 9) / 19).toFixed(6));
  });
});

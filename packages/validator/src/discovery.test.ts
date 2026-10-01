import { describe, expect, it } from "vitest";
import { discoveryFiltersSchema, effectiveFeeBps, managerProfileRequestSchema } from "./discovery";

describe("effectiveFeeBps", () => {
  it("percent fees pass through", () => expect(effectiveFeeBps({ type: "percent", bps: 75 }, "100")).toBe(75));
  it("fixed fees are amount / minimum in bps, rounded half-up, exact", () => {
    expect(effectiveFeeBps({ type: "fixed", amountUsdc: "10" }, "1000")).toBe(100);
    expect(effectiveFeeBps({ type: "fixed", amountUsdc: "0.05" }, "1000")).toBe(1); // 0.5 bps rounds up
    expect(effectiveFeeBps({ type: "fixed", amountUsdc: "0.049999" }, "1000")).toBe(0);
    expect(effectiveFeeBps({ amountUsdc: "5" }, "1000")).toBe(50);
  });
});

describe("discoveryFiltersSchema", () => {
  it("drops unknown keys and keeps valid ones", () => {
    const r = discoveryFiltersSchema.parse({ q: "btc", evil: "x; drop table", maxFeeBps: { management: 50, nope: 1 } });
    expect(r).toEqual({ q: "btc", maxFeeBps: { management: 50 } });
  });
  it("enforces limits and formats", () => {
    const bad = [
      { assets: Array.from({ length: 11 }, () => ({ symbol: "BTC" })) }, { tags: Array.from({ length: 11 }, () => "ab") }, { maxSingleWeightBps: 10_001 },
      { maxMinimumInvestmentUsdc: "1.1234567" }, { performance: { minNetReturn1y: "0.1234567" } }, { assets: [{ minBps: 1 }] }, { q: "x".repeat(201) }, { sort: "random" },
    ];
    for (const b of bad) expect(discoveryFiltersSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
    expect(discoveryFiltersSchema.safeParse({ performance: { minNetReturn1y: "-0.3", maxVolatility: "1.5" }, assets: [{ symbol: "btc", minBps: 100 }] }).success).toBe(true);
  });
});

describe("managerProfileRequestSchema", () => {
  it("requires https links and a valid handle", () => {
    expect(managerProfileRequestSchema.safeParse({ handle: "ada-l", displayName: "Ada", links: [{ label: "Site", url: "https://x.dev" }] }).success).toBe(true);
    expect(managerProfileRequestSchema.safeParse({ handle: "Ada", displayName: "Ada" }).success).toBe(false);
    // /managers/apply and /managers/status are static routes
    expect(managerProfileRequestSchema.safeParse({ handle: "apply", displayName: "Ada" }).success).toBe(false);
    expect(managerProfileRequestSchema.safeParse({ handle: "ada-l", displayName: "Ada", links: [{ label: "Site", url: "http://x.dev" }] }).success).toBe(false);
  });
});

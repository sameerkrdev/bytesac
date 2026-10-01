import { describe, expect, it } from "vitest";
import { feePlacement, headlineOf, notificationText, planRebalance, scaleBuys, splitRepair, NOTIFICATION_KINDS, type PlanInput } from "./rebalance";

const usd = (n: number) => BigInt(n) * 1_000_000n;
// Every test asset is priced at $1 with 6 decimals, so quantity == value in micro-USD.
const hold = (id: string, dollars: number, chain: "ethereum" | "solana" = "solana") => ({ deploymentId: id, chain, quantity: usd(dollars), decimals: 6, priceMicro: 1_000_000n });
const tgt = (id: string, bps: number, chain: "ethereum" | "solana" = "solana") => ({ deploymentId: id, chain, decimals: 6, priceMicro: 1_000_000n, bps });
const base = (over: Partial<PlanInput>): PlanInput => ({ holdings: [], cashMicro: 0n, targets: [], minTradeBps: 50, minTradeMicro: usd(5), reserveMicro: 0n, ...over });

describe("planRebalance", () => {
  it("sells the overweight, buys the underweight and new assets, leaves a matching one alone", () => {
    const r = planRebalance(base({
      holdings: [hold("BTC", 4000), hold("ETH", 3000), hold("SOL", 2000)], cashMicro: usd(1000),
      targets: [tgt("BTC", 3500), tgt("ETH", 3500), tgt("SOL", 2000), tgt("ARB", 1000)],
    }));
    expect(r.valueMicro).toBe(usd(10_000));
    expect(r.sells).toEqual([{ deploymentId: "BTC", chain: "solana", quantity: usd(500), valueMicro: usd(500) }]);
    expect(r.buys.map((b) => [b.deploymentId, b.amountMicro])).toEqual([["ETH", usd(500)], ["ARB", usd(1000)]]);
  });

  it("applies both thresholds", () => {
    const targets = [tgt("A", 4000), tgt("B", 6000)];
    // weight gap 40 bps (A holds 39.6%), value gap $40
    expect(planRebalance(base({ holdings: [hold("A", 3960), hold("B", 6040)], targets }))).toMatchObject({ sells: [], buys: [] });
    // V = $60: A at $20 vs $24 target → gap $4 (< $5) although 667 bps
    expect(planRebalance(base({ holdings: [hold("A", 20), hold("B", 40)], targets }))).toMatchObject({ sells: [], buys: [] });
    // both above the thresholds → trade
    const r = planRebalance(base({ holdings: [hold("A", 3000), hold("B", 7000)], targets }));
    expect(r.sells.length).toBe(1);
    expect(r.buys.length).toBe(1);
  });

  it("sells a removed asset in full despite the threshold", () => {
    const r = planRebalance(base({ holdings: [hold("A", 997), hold("OLD", 3)], targets: [tgt("A", 10_000)] }));
    expect(r.sells).toEqual([{ deploymentId: "OLD", chain: "solana", quantity: usd(3), valueMicro: usd(3) }]);
  });

  it("returns nothing when everything is within thresholds", () => {
    expect(planRebalance(base({ holdings: [hold("A", 5000), hold("B", 5000)], targets: [tgt("A", 5000), tgt("B", 5000)] }))).toMatchObject({ sells: [], buys: [] });
  });

  it("a fee reserve from cash reduces the buys pro-rata", () => {
    const r = planRebalance(base({ cashMicro: usd(1000), targets: [tgt("A", 5000), tgt("B", 5000)], reserveMicro: usd(100) }));
    expect(r.buys.map((b) => b.amountMicro)).toEqual([usd(450), usd(450)]);
  });
});

describe("scaleBuys", () => {
  it("scales down, up, and gives the remainder to the last", () => {
    expect(scaleBuys([300n, 700n], 500n)).toEqual([150n, 350n]);
    expect(scaleBuys([300n, 700n], 1001n)).toEqual([300n, 701n]);
    expect(scaleBuys([1n, 1n, 1n], 2n)).toEqual([0n, 0n, 2n]);
  });
});

describe("feePlacement", () => {
  const i = { freeMicro: 0n, cashMicro: 0n, feeMicro: 10n, sellChains: [] as ("solana" | "ethereum" | "bitcoin")[] };
  it("follows the D-071 extension", () => {
    expect(feePlacement({ ...i, freeMicro: 10n, sellChains: ["ethereum"] })).toEqual({ at: "first", fromCash: false });
    expect(feePlacement({ ...i, cashMicro: 10n })).toEqual({ at: "first", fromCash: true });
    expect(feePlacement({ ...i, cashMicro: 5n })).toBeNull();
    expect(feePlacement({ ...i, sellChains: ["solana", "solana"] })).toEqual({ at: "after_sells", fromCash: true });
    expect(feePlacement({ ...i, sellChains: ["solana", "ethereum"] })).toBeNull();
    expect(feePlacement({ ...i, sellChains: ["bitcoin"] })).toBeNull();
  });
});

describe("splitRepair", () => {
  const shares = [{ positionId: "A", shortfall: 6n }, { positionId: "B", shortfall: 9n }];
  it("splits pro-rata with the remainder to the largest and caps at the shortfall", () => {
    expect([...splitRepair(10n, shares)]).toEqual([["A", 4n], ["B", 6n]]);
    expect([...splitRepair(20n, shares)]).toEqual([["A", 6n], ["B", 9n]]);
  });
  it("first listed wins a tie", () => {
    const tie = [{ positionId: "A", shortfall: 5n }, { positionId: "B", shortfall: 5n }];
    expect([...splitRepair(3n, tie)]).toEqual([["A", 2n], ["B", 1n]]);
  });
});

describe("headlineOf", () => {
  const ok = { version: "CURRENT", backing: "VERIFIED", allocation: "ALIGNED", execution: "NONE" } as const;
  it("follows the priority table", () => {
    expect(headlineOf(ok)).toBe("ALIGNED");
    expect(headlineOf({ ...ok, allocation: "CUSTOMIZED" })).toBe("CUSTOMIZED");
    expect(headlineOf({ ...ok, allocation: "WEIGHT_DRIFT" })).toBe("DRIFTED");
    expect(headlineOf({ ...ok, version: "SKIPPED" })).toBe("ALIGNED");
    expect(headlineOf({ ...ok, version: "OUT_OF_DATE", allocation: "WEIGHT_DRIFT" })).toBe("REBALANCE_AVAILABLE");
    expect(headlineOf({ ...ok, version: "OUT_OF_DATE", execution: "INCOMPLETE" })).toBe("EXECUTION_INCOMPLETE");
    expect(headlineOf({ ...ok, backing: "REPAIR_REQUIRED", execution: "INCOMPLETE" })).toBe("REPAIR_REQUIRED");
    expect(headlineOf({ ...ok, backing: "REPAIR_REQUIRED", execution: "PENDING" })).toBe("EXECUTION_PENDING");
    expect(headlineOf({ ...ok, backing: "DATA_STALE" })).toBe("ALIGNED");
  });
});

describe("notificationText", () => {
  it("never claims a trade happened and links to the right page", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const t = notificationText(kind, { basketName: "Blue", basketSlug: "blue", positionId: "p1", asset: "d1" });
      expect(`${t.title} ${t.body}`).not.toMatch(/executed|bought|sold/i);
      expect(t.link.startsWith("/")).toBe(true);
    }
    expect(notificationText("repair_required", { asset: "d1" }).link).toBe("/portfolio/repair/d1");
    expect(notificationText("drifted", { positionId: "p1" }).link).toBe("/portfolio/p1/rebalance");
    expect(notificationText("basket_paused", { basketSlug: "blue" }).link).toBe("/baskets/blue");
  });
});

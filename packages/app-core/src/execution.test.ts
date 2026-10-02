import { describe, expect, it } from "vitest";
import { explorerTxUrl, formatUnits, legAmounts, legTitle } from "./execution";

const leg = (o: object = {}) => ({ kind: "swap" as const, toChain: "ethereum" as const, amountIn: "25000000", minOut: "9900000000000000", routeSummary: { tool: "stargate", estimatedOut: "10000000000000000", symbol: "ETH", decimals: 18 }, ...o });

describe("execution formatting", () => {
  it("formatUnits keeps exact digits, trims zeros and truncates", () => {
    expect(formatUnits("1500000", 6)).toBe("1.5");
    expect(formatUnits("10000000", 6)).toBe("10");
    expect(formatUnits(5n, 6)).toBe("0.000005");
    expect(formatUnits("123456789", 8, 4)).toBe("1.2345");
    expect(formatUnits("7", 0)).toBe("7");
  });
  it("describes buy and sell legs from the plan summary", () => {
    expect(legTitle(leg(), true)).toBe("Buy ETH");
    expect(legTitle(leg(), false)).toBe("Sell ETH");
    expect(legTitle({ ...leg(), kind: "network_fee" }, true)).toBe("Fees");
    expect(legAmounts(leg(), true)).toEqual({ in: "25 USDC", estimatedOut: "0.01 ETH", minOut: "0.0099 ETH" });
    expect(legAmounts(leg({ amountIn: "10000000000000000", minOut: "24000000", routeSummary: { estimatedOut: "25000000", symbol: "ETH", decimals: 18 } }), false)).toEqual({ in: "0.01 ETH", estimatedOut: "25 USDC", minOut: "24 USDC" });
  });
  it("builds explorer links", () => {
    expect(explorerTxUrl("bitcoin", "abc")).toBe("https://mempool.space/tx/abc");
  });
});

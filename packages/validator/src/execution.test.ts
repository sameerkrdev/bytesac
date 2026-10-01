import { describe, expect, it } from "vitest";
import { LEG_STATES, LEG_TRANSITIONS, OPERATION_STATES, OPERATION_TRANSITIONS, investRequestSchema, legSubmitSchema, minOut, networkFeeMicro, splitInvestment } from "./execution";

describe("splitInvestment", () => {
  it("splits deployable by bps and gives the remainder to the largest weight", () => {
    const out = splitInvestment(100_000_003n, 3n, [{ deploymentId: "a", bps: 3333 }, { deploymentId: "b", bps: 3333 }, { deploymentId: "c", bps: 3334 }]);
    expect(out.map((o) => o.amountMicro)).toEqual([33_330_000n, 33_330_000n, 33_340_000n]);
    expect(out.reduce((s, o) => s + o.amountMicro, 0n)).toBe(100_000_000n);
  });
  it("remainder goes to the first of equal largest weights", () => {
    const out = splitInvestment(10n, 0n, [{ deploymentId: "a", bps: 3333 }, { deploymentId: "b", bps: 3333 }, { deploymentId: "c", bps: 3334 }, { deploymentId: "d", bps: 0 }]);
    expect(out.reduce((s, o) => s + o.amountMicro, 0n)).toBe(10n);
    const tie = splitInvestment(7n, 0n, [{ deploymentId: "a", bps: 5000 }, { deploymentId: "b", bps: 5000 }]);
    expect(tie.map((o) => o.amountMicro)).toEqual([4n, 3n]);
  });
});

describe("minOut", () => {
  it("floors", () => {
    expect(minOut(1_000_001n, 100)).toBe(990_000n);
    expect(minOut(999n, 300)).toBe(969n);
  });
});

describe("networkFeeMicro", () => {
  it("adds a 20% buffer and converts with the USDC price", () => {
    expect(networkFeeMicro([0.5, 0.25], "1")).toBe(900_000n);
    expect(networkFeeMicro([1], "2")).toBe(600_000n);
  });
  it("has a 0.01 USDC minimum", () => {
    expect(networkFeeMicro([], "1")).toBe(10_000n);
    expect(networkFeeMicro([0.001], "1")).toBe(10_000n);
  });
});

describe("state machines", () => {
  it("maps every state and ends terminals", () => {
    for (const s of LEG_STATES) expect(LEG_TRANSITIONS).toHaveProperty(s);
    for (const s of OPERATION_STATES) expect(OPERATION_TRANSITIONS).toHaveProperty(s);
    expect(LEG_TRANSITIONS.SETTLED).toEqual([]);
    expect(LEG_TRANSITIONS.UNKNOWN).toEqual(["SETTLED", "FAILED"]);
    expect(OPERATION_TRANSITIONS.PLANNED).toEqual(["IN_PROGRESS", "CANCELLED"]);
    expect(OPERATION_TRANSITIONS.PARTIAL).toEqual([]);
  });
});

describe("request schemas", () => {
  it("defaults slippage to 100 bps and caps it at 300", () => {
    const base = { basketId: "0190f3a0-0000-7000-8000-000000000001", amountUsdc: "100", idempotencyKey: "key-12345" };
    expect(investRequestSchema.parse(base).slippageBps).toBe(100);
    expect(investRequestSchema.safeParse({ ...base, slippageBps: 301 }).success).toBe(false);
  });
  it("legSubmit needs exactly one proof", () => {
    expect(legSubmitSchema.safeParse({}).success).toBe(false);
    expect(legSubmitSchema.safeParse({ txHash: "0x1", signedTx: "x" }).success).toBe(false);
    expect(legSubmitSchema.safeParse({ txHash: "0x1" }).success).toBe(true);
  });
});

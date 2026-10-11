import { describe, expect, it } from "vitest";
import { K_SIGN_ALL, K_SIGN_AND_SEND, LEG_STATES, continueRequestSchema, approvalsEstimate, feeShares, groupRequestSchema, groupSentSchema, groupSubmitSchema, resolveLegRequestSchema, LEG_TRANSITIONS, OPERATION_STATES, OPERATION_TRANSITIONS, investRequestSchema, legSubmitSchema, minOut, networkFeeMicro, splitInvestment } from "./execution";

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

describe("networkFeeMicro inputs", () => {
  it("refuses NaN gas and a non-positive price instead of crashing later", () => {
    expect(() => networkFeeMicro([Number.NaN], "1")).toThrow(RangeError);
    expect(() => networkFeeMicro([1], "0")).toThrow(RangeError);
  });
});

describe("resolveLegRequestSchema", () => {
  it("needs evidence and a reason", () => {
    const ok = { status: "SETTLED", amountReceived: "42", txEvidence: "0xabcdef12", reason: "Verified on the explorer." };
    expect(resolveLegRequestSchema.safeParse(ok).success).toBe(true);
    expect(resolveLegRequestSchema.safeParse({ ...ok, reason: "" }).success).toBe(false);
    expect(resolveLegRequestSchema.safeParse({ ...ok, status: "UNKNOWN" }).success).toBe(false);
  });
});

describe("state machines", () => {
  it("maps every state and ends terminals", () => {
    for (const s of LEG_STATES) expect(LEG_TRANSITIONS).toHaveProperty(s);
    for (const s of OPERATION_STATES) expect(OPERATION_TRANSITIONS).toHaveProperty(s);
    expect(LEG_TRANSITIONS.SETTLED).toEqual([]);
    expect(LEG_TRANSITIONS.UNKNOWN).toEqual(["SETTLED", "FAILED"]);
    expect(LEG_TRANSITIONS.PLANNED).toEqual(["SUBMITTING", "FAILED"]); // the claim comes before any send; a planned leg can only fail unsent
    expect(LEG_TRANSITIONS.SUBMITTING).toContain("PLANNED"); // a refused send releases it
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
  it("a Continue without slippageBps has none (it must not reset the operation's own to the default)", () => {
    expect(continueRequestSchema.parse({ idempotencyKey: "key-12345" })).not.toHaveProperty("slippageBps");
    expect(continueRequestSchema.parse({ idempotencyKey: "key-12345", slippageBps: 200 }).slippageBps).toBe(200);
    expect(continueRequestSchema.safeParse({ idempotencyKey: "key-12345", slippageBps: 301 }).success).toBe(false);
  });
  it("legSubmit needs exactly one proof", () => {
    expect(legSubmitSchema.safeParse({}).success).toBe(false);
    expect(legSubmitSchema.safeParse({ txHash: "0x1", signedTx: "x" }).success).toBe(false);
    expect(legSubmitSchema.safeParse({ txHash: "0x1" }).success).toBe(true);
  });
});

describe("feeShares", () => {
  it("splits each kind by base, remainder to the largest base, sums exactly", () => {
    const s = feeShares({ manager_entry: 1_000_001n, platform: 10n }, [100n, 300n, 100n]);
    expect(s.map((x) => x.manager_entry)).toEqual([200_000n, 600_001n, 200_000n]);
    expect(s.map((x) => x.platform)).toEqual([2n, 6n, 2n]);
    expect(s.reduce((t, x) => t + x.manager_entry!, 0n)).toBe(1_000_001n);
  });
  it("gives the remainder to the first largest base on ties and omits zero kinds", () => {
    const s = feeShares({ platform: 5n, network: 0n }, [1n, 1n]);
    expect(s).toEqual([{ platform: 3n }, { platform: 2n }]);
  });
  it("returns empty shares when there is no base", () => {
    expect(feeShares({ platform: 5n }, [])).toEqual([]);
  });
});

describe("approvalsEstimate", () => {
  it("counts chunks of K, one slot per chunk taken by the fee when charged", () => {
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 4, charged: true })).toBe(1);
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 11, charged: true })).toBe(1);
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 12, charged: true })).toBe(2);
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 12, charged: false })).toBe(1);
    expect(approvalsEstimate({ tier: "sign_all", solanaLegs: 50, charged: true })).toBe(5);
    expect(approvalsEstimate({ tier: "single", solanaLegs: 50, charged: true })).toBe(51);
    expect(approvalsEstimate({ tier: "sign_and_send", solanaLegs: 24, charged: true })).toBe(4);
  });
});

describe("groupSentSchema", () => {
  it("takes 1 to K signatures of 80 to 90 characters per leg, and tier sign_and_send is a group tier", () => {
    const one = { legId: "0190a7b2-0000-7000-8000-000000000001", signature: "1".repeat(87) };
    expect(groupSentSchema.safeParse({ signatures: [] }).success).toBe(false);
    expect(groupSentSchema.safeParse({ signatures: Array(K_SIGN_AND_SEND + 1).fill(one) }).success).toBe(false);
    expect(groupSentSchema.safeParse({ signatures: [{ ...one, signature: "short" }] }).success).toBe(false);
    expect(groupSentSchema.safeParse({ signatures: [{ ...one, extra: 1 }] }).success).toBe(false);
    expect(groupSentSchema.safeParse({ signatures: [one] }).success).toBe(true);
    expect(groupRequestSchema.safeParse({ chain: "solana", tier: "sign_and_send", idempotencyKey: "grp-aaaaaaaa" }).success).toBe(true);
  });
});

describe("groupSubmitSchema", () => {
  it("bounds the batch", () => {
    const one = { legId: "0190a7b2-0000-7000-8000-000000000001", signedTx: "AA==" };
    expect(groupSubmitSchema.safeParse({ signed: [] }).success).toBe(false);
    expect(groupSubmitSchema.safeParse({ signed: Array(K_SIGN_ALL + 1).fill(one) }).success).toBe(false);
    expect(groupSubmitSchema.safeParse({ signed: [one] }).success).toBe(true);
  });
});

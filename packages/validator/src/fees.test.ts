import { describe, expect, it } from "vitest";
import { feeSchema, managerFeeMicro, microToUsdc, platformFeeMicro, platformFeeOverrideInputSchema, platformFeeScheduleInputSchema, resolvePlatformSchedule, type ScheduleRow } from "./index";

describe("managerFeeMicro", () => {
  const base = 1_000_000_000n; // 1 000 USDC
  it("percent, cap, fixed, none, floor", () => {
    expect(managerFeeMicro({ type: "percent", bps: 100 }, base)).toBe(10_000_000n);
    expect(managerFeeMicro({ type: "percent", bps: 100, maxUsdc: "5" }, base)).toBe(5_000_000n);
    expect(managerFeeMicro({ type: "fixed", amountUsdc: "2.5" }, base)).toBe(2_500_000n);
    expect(managerFeeMicro(undefined, base)).toBe(0n);
    expect(managerFeeMicro({ type: "percent", bps: 33 }, 1n)).toBe(0n);
  });
});

describe("microToUsdc", () => {
  it("drops trailing zeros only", () => {
    expect([100_000n, 50_000_000n, 2_500_000n, 0n, 10_000_000n, 1n].map(microToUsdc)).toEqual(["0.1", "50", "2.5", "0", "10", "0.000001"]);
  });
});

describe("platformFeeMicro", () => {
  it("clamps to min and max; zero bps is zero", () => {
    expect(platformFeeMicro({ bps: 25, minMicro: 100_000n, maxMicro: null }, 10_000_000n)).toBe(100_000n);
    expect(platformFeeMicro({ bps: 25, minMicro: null, maxMicro: 50_000_000n }, 1_000_000_000_000n)).toBe(50_000_000n);
    expect(platformFeeMicro({ bps: 0, minMicro: 100_000n, maxMicro: null }, 10_000_000n)).toBe(0n);
  });
});

describe("resolvePlatformSchedule", () => {
  const now = new Date("2026-10-02T00:00:00Z");
  const row = (o: Partial<ScheduleRow> & { id: string }): ScheduleRow & { id: string } => ({ scope: "default", scopeId: null, operationKind: "invest", supersededAt: null, endsAt: null, ...o });
  const i = { organizationId: "org", basketId: "bk", operation: "invest" as const, now };
  it("basket > organization > default", () => {
    const rows = [row({ id: "d" }), row({ id: "o", scope: "organization", scopeId: "org" }), row({ id: "b", scope: "basket", scopeId: "bk" })];
    expect(resolvePlatformSchedule(rows, i)?.id).toBe("b");
    expect(resolvePlatformSchedule(rows.slice(0, 2), i)?.id).toBe("o");
    expect(resolvePlatformSchedule(rows.slice(0, 1), i)?.id).toBe("d");
  });
  it("ignores superseded, expired, other operations and other scopes", () => {
    const rows = [
      row({ id: "d" }),
      row({ id: "o", scope: "organization", scopeId: "org", supersededAt: new Date("2026-01-01") }),
      row({ id: "b", scope: "basket", scopeId: "bk", endsAt: new Date("2026-09-01") }),
      row({ id: "x", scope: "basket", scopeId: "other" }),
    ];
    expect(resolvePlatformSchedule(rows, i)?.id).toBe("d");
    expect(resolvePlatformSchedule(rows, { ...i, operation: "repair" })).toBeNull();
    expect(resolvePlatformSchedule([], i)).toBeNull();
  });
});

describe("schemas", () => {
  it("feeSchema cap must be above zero", () => {
    expect(feeSchema.safeParse({ type: "percent", bps: 100, maxUsdc: "50" }).success).toBe(true);
    expect(feeSchema.safeParse({ type: "percent", bps: 100, maxUsdc: "0" }).success).toBe(false);
    expect(feeSchema.safeParse({ type: "percent", bps: 100 }).success).toBe(true);
  });
  it("schedule: min <= max, reason required, bps 0-100", () => {
    const ok = { operationKind: "invest", bps: 25, minUsdc: "0.1", maxUsdc: "50", reason: "launch" };
    expect(platformFeeScheduleInputSchema.safeParse(ok).success).toBe(true);
    expect(platformFeeScheduleInputSchema.safeParse({ ...ok, minUsdc: "60" }).success).toBe(false);
    expect(platformFeeScheduleInputSchema.safeParse({ ...ok, reason: " " }).success).toBe(false);
    expect(platformFeeScheduleInputSchema.safeParse({ ...ok, bps: 101 }).success).toBe(false);
  });
  it("override: future end date only", () => {
    const ok = { scope: "basket", scopeId: "0198a1b2-0000-7000-8000-000000000001", operationKind: "invest", bps: 10, reason: "promo" };
    expect(platformFeeOverrideInputSchema.safeParse({ ...ok, endsAt: new Date(Date.now() + 86_400_000).toISOString() }).success).toBe(true);
    expect(platformFeeOverrideInputSchema.safeParse({ ...ok, endsAt: "2020-01-01T00:00:00Z" }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_FLAGS, BASKET_ISSUE_CODES, BASKET_STATUSES, BASKET_TRANSITIONS, BASKET_VERSION_STATUSES, BASKET_VERSION_TRANSITIONS, CO_MANAGER_DEFAULT_FLAGS, LEAD_FLAGS,
  basketFeesSchema, canonicalJson, createAssignmentRequestSchema, decimalStringSchema, diffBasketVersions, feeSchema, feeWithinCap, maxFixedFeeUsdc, saveBasketDraftRequestSchema,
  validateBasketVersion, type BasketIssueCode, type BasketValidationInput,
} from "./index";

const FEES = { entry: { type: "percent", bps: 0 }, management: { type: "percent", bps: 0 }, rebalance: { type: "percent", bps: 0 }, subscription: null } as const;
const asset = (id: string, w: number, over: Partial<BasketValidationInput["assets"][number]> = {}) => ({
  instrumentId: id, targetWeightBps: w, minWeightBps: null, maxWeightBps: null, instrument: { status: "ACTIVE" as const, assetType: "CRYPTO" as const, hasActiveDeployment: true }, ...over,
});
/** A valid input; each test breaks exactly one rule. */
const valid = (over: Partial<BasketValidationInput> = {}, version: Partial<BasketValidationInput["version"]> = {}): BasketValidationInput => ({
  version: {
    name: "Core", shortDescription: "Short", strategyRisks: "Risky", thesis: "T", methodology: "M", rationale: null, constraints: {}, fees: FEES,
    minimumInvestmentUsdc: "100", minimumIncrementUsdc: null, ...version,
  },
  assets: [asset("a", 6000), asset("b", 4000)],
  versionNumber: 1, hasActiveLead: true, orgVerified: true, ...over,
});
const codes = (i: BasketValidationInput) => validateBasketVersion(i).issues.map((x) => x.code);

describe("validateBasketVersion", () => {
  it("accepts a valid basket with no issues or warnings", () => {
    expect(validateBasketVersion(valid())).toEqual({ issues: [], warnings: [{ code: "CONSTRAINT_VIOLATION", section: "assets", field: "a", message: "One asset is more than half of the basket." }] });
  });

  const cases: [BasketIssueCode, BasketValidationInput][] = [
    ["ORG_NOT_ELIGIBLE", valid({ orgVerified: false })],
    ["BASKET_NAME_REQUIRED", valid({}, { shortDescription: " " })],
    ["DISCLOSURE_MISSING", valid({}, { strategyRisks: null })],
    ["ASSET_UNSUPPORTED", valid({ assets: [asset("a", 6000, { instrument: { status: "PAUSED", assetType: "CRYPTO", hasActiveDeployment: true } }), asset("b", 4000)] })],
    ["ASSET_COUNT_INVALID", valid({ assets: Array.from({ length: 21 }, (_, n) => asset(`i${n}`, n === 20 ? 480 : 476)) })],
    ["ALLOCATION_DUPLICATE", valid({ assets: [asset("a", 5000), asset("a", 5000)] })],
    ["ALLOCATION_WEIGHT_INVALID", valid({ assets: [asset("a", 9950), asset("b", 50)] })],
    ["ALLOCATION_TOTAL_INVALID", valid({ assets: [asset("a", 6000), asset("b", 3000)] })],
    ["CONSTRAINT_VIOLATION", valid({}, { constraints: { maxWeightPerAssetBps: 5000 } })],
    ["FEE_CONFIGURATION_INVALID", valid({}, { fees: { ...FEES, entry: { type: "fixed", amountUsdc: "1.000001" } } })],
    ["MINIMUM_INVESTMENT_INVALID", valid({}, { minimumInvestmentUsdc: "0" })],
    ["MANAGER_ASSIGNMENT_REQUIRED", valid({ hasActiveLead: false })],
    ["REBALANCE_RATIONALE_REQUIRED", valid({ versionNumber: 2 })],
  ];
  it("covers every blocking code", () => {
    expect(new Set(cases.map(([c]) => c))).toEqual(new Set(BASKET_ISSUE_CODES));
  });
  it.each(cases)("%s blocks on its own input", (code, input) => {
    expect(codes(input)).toContain(code);
    expect(codes(input).filter((c) => c !== code)).toEqual([]);
  });

  it("checks weights against their band, the stablecoin cap and the RWA cap", () => {
    expect(codes(valid({ assets: [asset("a", 6000, { maxWeightBps: 5000 }), asset("b", 4000)] }))).toEqual(["ALLOCATION_WEIGHT_INVALID"]);
    const stable = asset("a", 6000, { instrument: { status: "ACTIVE", assetType: "STABLECOIN", hasActiveDeployment: true } });
    expect(codes(valid({ assets: [stable, asset("b", 4000)] }, { constraints: { maxStablecoinBps: 5000 } }))).toEqual(["CONSTRAINT_VIOLATION"]);
    const rwa = asset("b", 4000, { instrument: { status: "ACTIVE", assetType: "TOKENIZED_TREASURY", hasActiveDeployment: true } });
    expect(codes(valid({ assets: [asset("a", 6000), rwa] }, { constraints: { maxRwaBps: 3000 } }))).toEqual(["CONSTRAINT_VIOLATION"]);
  });
  it("rejects a non-integer weight and a bad increment", () => {
    expect(codes(valid({ assets: [asset("a", 6000.5), asset("b", 3999.5)] }))).toContain("ALLOCATION_WEIGHT_INVALID");
    expect(codes(valid({}, { minimumIncrementUsdc: "101" }))).toEqual(["MINIMUM_INVESTMENT_INVALID"]);
  });
  it("caps the subscription amount and percent fees", () => {
    expect(codes(valid({}, { fees: { ...FEES, subscription: { amountUsdc: "1.000001", period: "monthly" } } }))).toEqual(["FEE_CONFIGURATION_INVALID"]);
    expect(codes(valid({}, { fees: { ...FEES, subscription: { amountUsdc: "1", period: "yearly" } } }))).toEqual([]);
    expect(codes(valid({}, { fees: { ...FEES, management: { type: "percent", bps: 101 } } }))).toEqual(["FEE_CONFIGURATION_INVALID"]);
  });
  it("warns, without blocking, on paused assets, heavy weights and a missing thesis", () => {
    const paused = asset("a", 4000, { instrument: { status: "PAUSED", assetType: "CRYPTO", hasActiveDeployment: true } });
    const r = validateBasketVersion(valid({ assets: [paused, asset("b", 6000)] }, { thesis: null }));
    expect(r.warnings.map((w) => w.message)).toEqual([
      "This asset is paused or deprecated in the registry.", "One asset is more than half of the basket.", "Investors understand a basket better with a thesis and methodology.",
    ]);
    expect(r.issues.map((i) => i.code)).toEqual(["ASSET_UNSUPPORTED"]);
  });
});

describe("fixed fee cap (exact micro-USDC)", () => {
  it("is exactly 1% of a six-decimal minimum", () => {
    expect(feeWithinCap("12.345678", "1234.567891")).toBe(true);
    expect(feeWithinCap("12.345679", "1234.567891")).toBe(false);
    expect(feeWithinCap("1", "100")).toBe(true);
    expect(feeWithinCap("1.000001", "100")).toBe(false);
    expect([maxFixedFeeUsdc("100"), maxFixedFeeUsdc("1234.567891"), maxFixedFeeUsdc("1000"), maxFixedFeeUsdc("1050"), maxFixedFeeUsdc("1005"), maxFixedFeeUsdc("50")]).toEqual(["1", "12.345678", "10", "10.5", "10.05", "0.5"]);
  });
  it("accepts percent 100 bps and rejects 101 at the schema", () => {
    expect(feeSchema.safeParse({ type: "percent", bps: 100 }).success).toBe(true);
    expect(feeSchema.safeParse({ type: "percent", bps: 101 }).success).toBe(false);
    expect(basketFeesSchema.safeParse({ ...FEES, entry: { type: "percent", bps: 101 } }).success).toBe(false);
  });
  it("limits decimal strings to 12 integer and 6 fraction digits", () => {
    for (const ok of ["0", "1.5", "999999999999.999999"]) expect(decimalStringSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["1.1234567", "1000000000000", ".5", "-1", "1e3"]) expect(decimalStringSchema.safeParse(bad).success, bad).toBe(false);
  });
});

describe("requests", () => {
  it("requires expectedUpdatedAt and rejects unknown keys", () => {
    expect(saveBasketDraftRequestSchema.safeParse({ name: "Core" }).success).toBe(false);
    expect(saveBasketDraftRequestSchema.safeParse({ expectedUpdatedAt: new Date().toISOString(), status: "ACTIVE" }).success).toBe(false);
    expect(saveBasketDraftRequestSchema.safeParse({ expectedUpdatedAt: new Date().toISOString(), shortDescription: null }).success).toBe(true);
  });
  it("accepts unique assignment flags only", () => {
    const base = { membershipId: "11111111-1111-4111-8111-111111111111", role: "co_manager" } as const;
    expect(createAssignmentRequestSchema.safeParse({ ...base, permissions: ["edit", "edit"] }).success).toBe(false);
    expect(createAssignmentRequestSchema.safeParse({ ...base, permissions: ["delete"] }).success).toBe(false);
    expect(createAssignmentRequestSchema.safeParse({ ...base, permissions: ["edit"] }).success).toBe(true);
  });
  it("lead flags are all five; co-manager defaults are edit and submit", () => {
    expect(LEAD_FLAGS).toEqual(ASSIGNMENT_FLAGS);
    expect(ASSIGNMENT_FLAGS).toEqual(["edit", "submit", "publish", "lifecycle", "assign"]);
    expect(CO_MANAGER_DEFAULT_FLAGS).toEqual(["edit", "submit"]);
  });
});

describe("state maps", () => {
  it("are total and only point at known states", () => {
    expect(Object.keys(BASKET_TRANSITIONS).sort()).toEqual([...BASKET_STATUSES].sort());
    expect(Object.keys(BASKET_VERSION_TRANSITIONS).sort()).toEqual([...BASKET_VERSION_STATUSES].sort());
    for (const to of Object.values(BASKET_TRANSITIONS).flat()) expect(BASKET_STATUSES).toContain(to);
    for (const to of Object.values(BASKET_VERSION_TRANSITIONS).flat()) expect(BASKET_VERSION_STATUSES).toContain(to);
  });
  it("terminal states have no exits and approved only publishes", () => {
    for (const s of ["RETIRED", "REJECTED"] as const) expect(BASKET_TRANSITIONS[s]).toEqual([]);
    for (const s of ["superseded", "rejected"] as const) expect(BASKET_VERSION_TRANSITIONS[s]).toEqual([]);
    expect(BASKET_VERSION_TRANSITIONS.approved).toEqual(["published"]);
    expect(BASKET_TRANSITIONS.DRAFT).toEqual(["ACTIVE", "REJECTED"]);
  });
});

describe("canonicalJson and diffBasketVersions", () => {
  it("serializes equal content identically whatever the key order", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ y: 1, x: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [{ x: 2, y: 1 }] }, b: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
  const v = { constraints: {}, rebalance: { reviewFrequency: "none" as const }, fees: FEES, minimumInvestmentUsdc: "100", minimumIncrementUsdc: null };
  const a = (id: string, w: number, min: number | null = null, max: number | null = null) => ({ instrumentId: id, targetWeightBps: w, minWeightBps: min, maxWeightBps: max });
  it("reports added, removed, changed and band changes", () => {
    const prev = { version: v, assets: [a("a", 5000), a("b", 3000), a("c", 2000)] };
    const next = { version: v, assets: [a("a", 6000, 5000, 7000), a("c", 2000), a("d", 2000)] };
    expect(diffBasketVersions(prev, next)).toEqual({
      added: [{ instrumentId: "d", weightBps: 2000 }], removed: [{ instrumentId: "b", weightBps: 3000 }], changed: [{ instrumentId: "a", fromBps: 5000, toBps: 6000 }],
      bandChanged: ["a"], constraints: false, rebalance: false, fees: false, minimums: false,
    });
  });
  it("reports constraint, rebalance, fee and minimum changes; with no previous version everything is added", () => {
    const prev = { version: v, assets: [a("a", 10_000)] };
    const next = {
      version: { constraints: { maxRwaBps: 10 }, rebalance: { reviewFrequency: "monthly" as const }, fees: { ...FEES, entry: { type: "percent" as const, bps: 5 } }, minimumInvestmentUsdc: "200", minimumIncrementUsdc: null },
      assets: prev.assets,
    };
    expect(diffBasketVersions(prev, next)).toMatchObject({ added: [], constraints: true, rebalance: true, fees: true, minimums: true });
    expect(diffBasketVersions(null, next)).toMatchObject({ added: [{ instrumentId: "a", weightBps: 10_000 }], removed: [], constraints: false });
  });
});

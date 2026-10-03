import { describe, expect, it } from "vitest";
import { evaluateEligibility, rwaProblem, type EligibilityRuleInput, type InvestorStatus } from "./eligibility";

const now = new Date("2026-10-03T00:00:00Z");
const decl = (country = "DE", investorStatus: InvestorStatus = "retail", ageDays = 1) => ({ country, investorStatus, createdAt: new Date(now.getTime() - ageDays * 86_400_000) });
const rule = (o: Partial<EligibilityRuleInput> & { id: string }): EligibilityRuleInput => ({
  instrumentId: "i1", routeId: null, jurisdiction: "DE", action: "acquire", outcome: "ALLOWED", investorStatuses: [], status: "ACTIVE", ...o,
});
const run = (o: Partial<Parameters<typeof evaluateEligibility>[0]> = {}) =>
  evaluateEligibility({ rwa: true, instrumentId: "i1", routeId: "r1", action: "acquire", rules: [], declaration: decl(), ipCountry: null, now, ...o });

describe("evaluateEligibility", () => {
  it("allows crypto without rules or declaration", () => {
    expect(run({ rwa: false, declaration: null })).toMatchObject({ outcome: "ALLOWED", reason: "NO_RULE_CRYPTO" });
  });
  it("needs a declaration for an RWA, and a fresh one", () => {
    expect(run({ declaration: null }).outcome).toBe("DECLARATION_REQUIRED");
    expect(run({ declaration: decl("DE", "retail", 366) }).outcome).toBe("DECLARATION_REQUIRED");
    expect(run({ declaration: decl("DE", "retail", 365), rules: [rule({ id: "a" })] }).outcome).toBe("ALLOWED");
  });
  it("flags an IP/declared country mismatch and ignores XX, T1 and null", () => {
    const rules = [rule({ id: "a" })];
    expect(run({ rules, ipCountry: "FR" })).toMatchObject({ outcome: "REVIEW_REQUIRED", reason: "IP_COUNTRY_MISMATCH" });
    for (const ipCountry of ["XX", "T1", null]) expect(run({ rules, ipCountry }).outcome).toBe("ALLOWED");
    expect(run({ rules, ipCountry: "DE" }).outcome).toBe("ALLOWED");
  });
  it("restricts an RWA with no rule", () => {
    expect(run()).toMatchObject({ outcome: "RESTRICTED", reason: "NO_RULE", ruleIds: [] });
  });
  it("route+country beats a stricter instrument+country rule", () => {
    const rules = [rule({ id: "route", routeId: "r1" }), rule({ id: "inst", outcome: "RESTRICTED" })];
    expect(run({ rules })).toMatchObject({ outcome: "ALLOWED", ruleIds: ["route"] });
  });
  it("strictest outcome wins within a tier", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b", outcome: "RESTRICTED" })];
    expect(run({ rules })).toMatchObject({ outcome: "RESTRICTED", ruleIds: ["b"] });
  });
  it("uses * only when no exact-country rule exists at the same level", () => {
    const star = rule({ id: "star", jurisdiction: "*", outcome: "RESTRICTED" });
    expect(run({ rules: [star, rule({ id: "de" })] }).outcome).toBe("ALLOWED");
    expect(run({ rules: [star] }).outcome).toBe("RESTRICTED");
  });
  it("filters by investor status and falls through to the next tier", () => {
    const rules = [rule({ id: "acc", routeId: "r1", investorStatuses: ["accredited"] }), rule({ id: "inst", outcome: "KYC_REQUIRED" })];
    expect(run({ rules })).toMatchObject({ outcome: "KYC_REQUIRED", ruleIds: ["inst"] });
    expect(run({ rules: [rules[0]!] }).reason).toBe("NO_RULE");
    expect(run({ rules, declaration: decl("DE", "accredited") }).ruleIds).toEqual(["acc"]);
  });
  it("ignores RETIRED and DRAFT rules and rules for another action", () => {
    const rules = [rule({ id: "a", status: "RETIRED" }), rule({ id: "b", status: "DRAFT" }), rule({ id: "c", action: "sell" })];
    expect(run({ rules }).reason).toBe("NO_RULE");
    expect(run({ rules, action: "sell" }).ruleIds).toEqual(["c"]);
  });
  it("applies only * rules to crypto without a declaration", () => {
    const rules = [rule({ id: "de", outcome: "RESTRICTED" }), rule({ id: "star", jurisdiction: "*", outcome: "REVIEW_REQUIRED" })];
    expect(run({ rwa: false, declaration: null, rules })).toMatchObject({ outcome: "REVIEW_REQUIRED", ruleIds: ["star"] });
  });
});

describe("rwaProblem", () => {
  const opt = (permissioned: boolean, method = "swap") => ({ permissioned, method });
  it("names why a tokenized asset can't be offered", () => {
    expect(rwaProblem([opt(true)], true)).toBe("RWA_PERMISSIONED");
    expect(rwaProblem([opt(false, "subscription")], true)).toBe("RWA_ROUTE_UNSUPPORTED");
    expect(rwaProblem([opt(true), opt(false, "secondary_market")], false)).toBe("RWA_PRICE_REQUIRED");
    expect(rwaProblem([opt(true), opt(false)], true)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { blockedAssetNotices, INELIGIBLE_ACTION } from "./eligibility-copy";
import { feeLines, feeText, rateText } from "./fees";
import { investAmountProblem } from "./format";
import { isSkipped, positionActions } from "./portfolio-actions";
import { toRaw, validateSyncSplit } from "./sync-split";

describe("fees", () => {
  it("words rates and fees", () => {
    expect(rateText(100, null, "50")).toBe("1% up to $50");
    expect(rateText(100, "2", "50")).toBe("1% (at least $2, up to $50)");
    expect(feeText({ type: "fixed", amountUsdc: "2" } as never)).toBe("2 USDC");
  });
  it("lists every fee, a waived one with its reason, and the total", () => {
    const { lines, total } = feeLines([
      { kind: "network", amountMicro: "70000", recipientLabel: "x", waivedReason: null },
      { kind: "manager_entry", amountMicro: "500000", recipientLabel: "Acme", waivedReason: "dust" },
    ]);
    expect(lines[0]).toEqual({ label: "Network fee (paid to Bytesac for gas)", amount: "0.07 USDC", waived: false });
    expect(lines[1]).toEqual({ label: "Manager fee (to Acme)", amount: "Waived — below $0.01", waived: true });
    expect(total).toBe("0.57 USDC");
  });
});

describe("investAmountProblem", () => {
  it("checks format, minimum, increment and zero", () => {
    expect(investAmountProblem("abc", null, null)).toMatch(/up to 6 decimals/);
    expect(investAmountProblem("5", "10", null)).toBe("The minimum is 10 USDC.");
    expect(investAmountProblem("15", "10", "10")).toBe("The amount must be a multiple of 10 USDC.");
    expect(investAmountProblem("0", null, null)).toBe("Enter an amount above zero.");
    expect(investAmountProblem("20", "10", "10")).toBeNull();
  });
});

describe("sync split", () => {
  it("parses decimals within precision only", () => {
    expect(toRaw("1.5", 2)).toBe(150n);
    expect(toRaw("1.555", 2)).toBeNull();
    expect(toRaw("x", 2)).toBeNull();
  });
  it("needs the exact total and no entry above its ledger", () => {
    expect(validateSyncSplit(["1", "2"], ["5", "5"], "300", 2).valid).toBe(false);
    expect(validateSyncSplit(["1", "2"], ["500", "500"], "300", 2).valid).toBe(true);
    expect(validateSyncSplit(["1", "2"], ["50", "500"], "300", 2).valid).toBe(false);
    expect(validateSyncSplit(["1", "oops"], ["500", "500"], "100", 2)).toMatchObject({ valid: false, raw: [100n, null] });
  });
});

describe("eligibility copy", () => {
  it("keeps only blocking outcomes and maps fixes to a place", () => {
    expect(blockedAssetNotices([{ instrumentId: "a", outcome: "ELIGIBLE" }, { instrumentId: "b", outcome: "RESTRICTED" }])).toEqual([{ instrumentId: "b", text: "Not available in your region / for your investor status" }]);
    expect(INELIGIBLE_ACTION.OPERATION_IN_PROGRESS!.target).toBe("portfolio");
    expect(INELIGIBLE_ACTION.EMAIL_NOT_VERIFIED!.target).toBe("profile");
  });
});

describe("positionActions", () => {
  const p = (headline: string, version = "CURRENT", latestVersion: object | null = { number: 2 }) => ({ headline, latestVersion, states: { version } }) as never;
  it("maps each headline to its actions", () => {
    expect(positionActions(p("REBALANCE_AVAILABLE", "OUTDATED")).map((a) => a.kind)).toEqual(["review"]);
    expect(positionActions(p("DRIFTED")).map((a) => a.kind)).toEqual(["rebalance", "keepCustom"]);
    expect(positionActions(p("DRIFTED", "OUTDATED"))[0]).toMatchObject({ kind: "rebalance", target: "latest" });
    expect(positionActions(p("CUSTOMIZED")).map((a) => a.kind)).toEqual(["revertCustom"]);
    expect(positionActions(p("REPAIR_REQUIRED")).map((a) => a.kind)).toEqual(["repair"]);
    expect(positionActions(p("EXECUTION_INCOMPLETE")).map((a) => a.kind)).toEqual(["continue"]);
    expect(positionActions(p("EXECUTION_PENDING")).map((a) => a.kind)).toEqual(["viewOperation"]);
    expect(positionActions(p("ALIGNED"))).toEqual([]);
  });
  it("offers the skipped version again", () => {
    expect(isSkipped(p("ALIGNED", "SKIPPED"))).toBe(true);
    expect(positionActions(p("ALIGNED", "SKIPPED")).map((a) => a.kind)).toEqual(["review"]);
    expect(positionActions(p("ALIGNED", "SKIPPED", null))).toEqual([]);
  });
});

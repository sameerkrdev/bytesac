import { describe, expect, it } from "vitest";
import { normalizeOtp, verifyReducer, type VerifyState } from "./verify-flow";

describe("verifyReducer", () => {
  it("happy path", () => {
    let s: VerifyState = { step: "idle" };
    s = verifyReducer(s, { type: "START" });
    expect(s.step).toBe("signing");
    s = verifyReducer(s, { type: "SIGNED" });
    expect(s.step).toBe("verifying");
    s = verifyReducer(s, { type: "VERIFIED", isNewUser: true });
    expect(s).toEqual({ step: "done", isNewUser: true });
  });
  it("START is ignored while busy (double click)", () => {
    expect(verifyReducer({ step: "signing" }, { type: "START" })).toEqual({ step: "signing" });
    expect(verifyReducer({ step: "verifying" }, { type: "START" })).toEqual({ step: "verifying" });
  });
  it("failure and reset", () => {
    const s = verifyReducer({ step: "signing" }, { type: "FAILED", code: "WALLET_REJECTED" });
    expect(s).toEqual({ step: "error", code: "WALLET_REJECTED" });
    expect(verifyReducer(s, { type: "RESET" })).toEqual({ step: "idle" });
    expect(verifyReducer(s, { type: "START" }).step).toBe("signing");
  });
});

describe("normalizeOtp", () => {
  it("strips spaces and non-digits, caps at 6", () => {
    expect(normalizeOtp("123 456")).toBe("123456");
    expect(normalizeOtp(" 12-34a56 7")).toBe("123456");
  });
});

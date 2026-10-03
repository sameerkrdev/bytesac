import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ create: vi.fn(), check: vi.fn() }));
vi.mock("twilio", () => ({
  default: () => ({ verify: { v2: { services: () => ({ verifications: { create: sdk.create }, verificationChecks: { create: sdk.check } }) } } }),
}));

const { checkSmsVerification, startSmsVerification } = await vi.importActual<typeof import("@/providers/twilio")>("@/providers/twilio");

beforeEach(() => { sdk.create.mockReset(); sdk.check.mockReset(); });

describe("checkSmsVerification", () => {
  it("approved -> true, any other status -> false", async () => {
    sdk.check.mockResolvedValueOnce({ status: "approved" });
    expect(await checkSmsVerification("+14155552671", "123456")).toBe(true);
    sdk.check.mockResolvedValueOnce({ status: "pending" });
    expect(await checkSmsVerification("+14155552671", "000000")).toBe(false);
  });
  it.each([[{ status: 404 }], [{ code: 20404 }], [{ code: 60202 }]])("%j (not found / max check attempts) means the code cannot be accepted", async (err) => {
    sdk.check.mockRejectedValueOnce(err);
    expect(await checkSmsVerification("+14155552671", "123456")).toBe(false);
  });
  it.each([[{ status: 429, code: 20429 }], [{ status: 429 }]])("%j -> 429 RATE_LIMITED with Retry-After", async (err) => {
    sdk.check.mockRejectedValueOnce(err);
    await expect(checkSmsVerification("+14155552671", "123456")).rejects.toMatchObject({ code: "RATE_LIMITED", headers: { "retry-after": "60" } });
  });
  it.each([[{ status: 500 }], [{ status: 401, code: 20003 }], [new Error("ECONNRESET")], [null]])("%j -> 503 OTP_DELIVERY_FAILED", async (err) => {
    sdk.check.mockRejectedValueOnce(err);
    await expect(checkSmsVerification("+14155552671", "123456")).rejects.toMatchObject({ code: "OTP_DELIVERY_FAILED" });
  });
});

describe("startSmsVerification", () => {
  it("returns the verification SID", async () => {
    sdk.create.mockResolvedValueOnce({ sid: "VE123" });
    expect(await startSmsVerification("+14155552671")).toBe("VE123");
    expect(sdk.create).toHaveBeenCalledWith({ to: "+14155552671", channel: "sms" });
  });
  it("60203 max send attempts -> 429 OTP_COOLDOWN with a Retry-After", async () => {
    sdk.create.mockRejectedValueOnce({ status: 429, code: 60203 });
    await expect(startSmsVerification("+14155552671")).rejects.toMatchObject({ code: "OTP_COOLDOWN", headers: { "retry-after": "600" } });
  });
  it("20429 too many requests -> 429 RATE_LIMITED", async () => {
    sdk.create.mockRejectedValueOnce({ status: 429, code: 20429 });
    await expect(startSmsVerification("+14155552671")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
  it("other failures -> 503 OTP_DELIVERY_FAILED, never retried", async () => {
    sdk.create.mockRejectedValueOnce(new Error("boom"));
    await expect(startSmsVerification("+14155552671")).rejects.toMatchObject({ code: "OTP_DELIVERY_FAILED" });
    expect(sdk.create).toHaveBeenCalledTimes(1);
  });
});

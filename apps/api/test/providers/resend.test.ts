import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: sdk.send }; } }));

const { sendOtpEmail } = await vi.importActual<typeof import("../../src/providers/resend")>("../../src/providers/resend");

beforeEach(() => sdk.send.mockReset());

describe("sendOtpEmail", () => {
  it("sends the code with an idempotency key per verification", async () => {
    sdk.send.mockResolvedValueOnce({ data: { id: "e1" }, error: null });
    await sendOtpEmail("a@b.co", "123456", "v-1");
    const [payload, options] = sdk.send.mock.calls[0]!;
    expect(payload).toMatchObject({ to: "a@b.co", subject: "Your Bytesac verification code" });
    expect(payload.text).toContain("123456");
    expect(options).toEqual({ idempotencyKey: "contact-otp/v-1" });
  });
  it("a reported error -> 503 OTP_DELIVERY_FAILED", async () => {
    sdk.send.mockResolvedValueOnce({ data: null, error: { name: "application_error", message: "down", statusCode: null } });
    await expect(sendOtpEmail("a@b.co", "123456", "v-2")).rejects.toMatchObject({ status: 503, code: "OTP_DELIVERY_FAILED" });
  });
});

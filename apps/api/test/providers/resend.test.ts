import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: sdk.send }; } }));

const { sendOtpEmail, sendApplicationEmail, sendOrganizationEmail, sendBasketEmail } = await vi.importActual<typeof import("../../src/providers/resend")>("../../src/providers/resend");

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
    await expect(sendOtpEmail("a@b.co", "123456", "v-2")).rejects.toMatchObject({ code: "OTP_DELIVERY_FAILED" });
  });
});

describe("sendApplicationEmail", () => {
  const error = { name: "application_error", message: "down", statusCode: null };
  it("sends with the caller's idempotency key", async () => {
    sdk.send.mockResolvedValueOnce({ data: { id: "e1" }, error: null });
    await sendApplicationEmail("approved", "a@b.co", { walletLabel: "0x12…abcd on Base" }, "application-status/e-1");
    const [payload, options] = sdk.send.mock.calls[0]!;
    expect(payload.text).toContain("Sign in to Bytesac with wallet 0x12…abcd on Base to finish.");
    expect(options).toEqual({ idempotencyKey: "application-status/e-1" });
  });
  it("code failure -> 503 OTP_DELIVERY_FAILED", async () => {
    sdk.send.mockResolvedValueOnce({ data: null, error });
    await expect(sendApplicationEmail("code", "a@b.co", { code: "123456" }, "application-code/c-1")).rejects.toMatchObject({ code: "OTP_DELIVERY_FAILED" });
  });
  it("status email failure is logged, not thrown", async () => {
    sdk.send.mockResolvedValueOnce({ data: null, error });
    await expect(sendApplicationEmail("rejected", "a@b.co", {}, "application-status/e-2")).resolves.toBeUndefined();
  });
});

describe("sendOrganizationEmail", () => {
  it("sends with the caller's idempotency key and includes the message", async () => {
    sdk.send.mockResolvedValueOnce({ data: { id: "e1" }, error: null });
    await sendOrganizationEmail("changes_required", "a@b.co", { message: "Fix the address" }, "organization-status/e-1");
    const [payload, options] = sdk.send.mock.calls[0]!;
    expect(payload).toMatchObject({ to: "a@b.co", subject: "Bytesac organization: changes required" });
    expect(payload.text).toContain("Fix the address");
    expect(options).toEqual({ idempotencyKey: "organization-status/e-1" });
  });
  it("a delivery failure is logged, not thrown", async () => {
    sdk.send.mockResolvedValueOnce({ data: null, error: { name: "application_error", message: "down", statusCode: null } });
    await expect(sendOrganizationEmail("verified", "a@b.co", {}, "organization-status/e-2")).resolves.toBeUndefined();
  });
});

describe("sendBasketEmail", () => {
  it("sends with the caller's idempotency key and never claims assets moved", async () => {
    sdk.send.mockResolvedValueOnce({ data: { id: "e1" }, error: null });
    await sendBasketEmail("published", "a@b.co", { basketName: "Core" }, "basket/e-1/u-1");
    const [payload, options] = sdk.send.mock.calls[0]!;
    expect(payload).toMatchObject({ to: "a@b.co", subject: "Bytesac basket version published" });
    expect(payload.text).toContain("No assets were moved");
    expect(options).toEqual({ idempotencyKey: "basket/e-1/u-1" });
  });
  it("a failure is logged, not thrown", async () => {
    sdk.send.mockResolvedValueOnce({ data: null, error: { name: "application_error", message: "down", statusCode: null } });
    await expect(sendBasketEmail("rejected", "a@b.co", { message: "Why" }, "basket/e-2/u-1")).resolves.toBeUndefined();
  });
});

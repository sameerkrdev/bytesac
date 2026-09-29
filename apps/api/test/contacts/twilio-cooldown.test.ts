import request from "supertest";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contactVerifications } from "@repo/db";
import { app } from "../../src/app";
import { limits } from "../../src/middleware/rate-limit";
import { signIn, webHeaders } from "../helpers/auth";
import { resetDb, testDb } from "../helpers/db";
import { newEvmWallet } from "../helpers/wallets";

// Drive the real Twilio adapter (not the shared fake) with a mocked SDK.
const sdk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("twilio", () => ({
  default: () => ({ verify: { v2: { services: () => ({ verifications: { create: sdk.create }, verificationChecks: { create: vi.fn() } }) } } }),
}));
vi.mock("../../src/providers/twilio", async (importActual) => importActual());

beforeEach(resetDb);

describe("Twilio 60203 (max send attempts) on send", () => {
  it("answers 429 OTP_COOLDOWN, refunds the rate-limit points and marks the verification failed", async () => {
    const s = await signIn(app, newEvmWallet(), "base");
    sdk.create.mockRejectedValueOnce({ status: 429, code: 60203 });
    const res = await request(app).post("/v1/me/contacts").set(webHeaders(s.cookie)).send({ type: "phone", value: "+1 415 555 2671" });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("OTP_COOLDOWN");
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
    expect((await limits.otpUser.get(s.userId))?.consumedPoints ?? 0).toBe(0);
    const rows = await testDb.db.select().from(contactVerifications).where(eq(contactVerifications.channel, "sms"));
    expect(rows.map((r) => r.status)).toEqual(["failed"]);
  });
});

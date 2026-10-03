import { afterEach, describe, expect, it, vi } from "vitest";

const base = {
  NODE_ENV: "test", PORT: "4000", REDIS_URL: "redis://x:1/0",
  SESSION_TOKEN_PEPPER: "p".repeat(32), OTP_HMAC_SECRET: "s".repeat(32), ALCHEMY_API_KEY: "k",
  RESEND_API_KEY: "r", EMAIL_FROM: "Bytesac <a@b.co>", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t",
  TWILIO_VERIFY_SERVICE_SID: "VA1", SMS_ALLOWED_COUNTRIES: "IN, us", AUTH_DOMAIN: "localhost:3000",
  AUTH_URI: "http://localhost:3000", ALLOWED_ORIGINS: "http://localhost:3000,https://app.bytesac.com",
  R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b",
};

/** env.ts validates process.env when first imported, so each case imports a fresh copy. */
async function loadEnv(overrides: Record<string, string | undefined> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...base, COOKIE_SECURE: undefined, TRUST_PROXY: undefined, ...overrides })) {
    if (v === undefined) vi.stubEnv(k, undefined as unknown as string);
    else vi.stubEnv(k, v);
  }
  return (await import("@/config/dotenv")).env;
}

afterEach(() => vi.unstubAllEnvs());

describe("env", () => {
  it("parses lists and booleans", async () => {
    const env = await loadEnv();
    expect(env.SMS_ALLOWED_COUNTRIES).toEqual(["IN", "US"]);
    expect(env.ALLOWED_ORIGINS).toEqual(["http://localhost:3000", "https://app.bytesac.com"]);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.PORT).toBe(4000);
  });
  it("parses TRUST_PROXY: digits -> number, true/false -> boolean, else string", async () => {
    expect((await loadEnv({ TRUST_PROXY: "1" })).TRUST_PROXY).toBe(1);
    expect((await loadEnv({ TRUST_PROXY: "true" })).TRUST_PROXY).toBe(true);
    expect((await loadEnv({ TRUST_PROXY: "false" })).TRUST_PROXY).toBe(false);
    expect((await loadEnv({ TRUST_PROXY: "loopback" })).TRUST_PROXY).toBe("loopback");
    expect((await loadEnv()).TRUST_PROXY).toBe("loopback");
  });
  it("exits on a short secret", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => { throw new Error("exit"); }) as never);
    await expect(loadEnv({ SESSION_TOKEN_PEPPER: "short" })).rejects.toThrow("exit");
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore();
  });
});

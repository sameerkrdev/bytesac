import { describe, expect, it } from "vitest";
import { loadEnv, loadOpsEnv } from "../../src/config/env.js";

const base = {
  NODE_ENV: "test", PORT: "4000", DATABASE_URL: "postgres://a@b/c", REDIS_URL: "redis://x:1/0",
  SESSION_TOKEN_PEPPER: "p".repeat(32), OTP_HMAC_SECRET: "s".repeat(32), ALCHEMY_API_KEY: "k",
  RESEND_API_KEY: "r", EMAIL_FROM: "Bytesac <a@b.co>", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t",
  TWILIO_VERIFY_SERVICE_SID: "VA1", SMS_ALLOWED_COUNTRIES: "IN, us", AUTH_DOMAIN: "localhost:3000",
  AUTH_URI: "http://localhost:3000", ALLOWED_ORIGINS: "http://localhost:3000,https://app.bytesac.com",
};

describe("loadEnv", () => {
  it("parses lists and booleans", () => {
    const env = loadEnv(base);
    expect(env.SMS_ALLOWED_COUNTRIES).toEqual(["IN", "US"]);
    expect(env.ALLOWED_ORIGINS).toEqual(["http://localhost:3000", "https://app.bytesac.com"]);
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.PORT).toBe(4000);
  });
  it("parses TRUST_PROXY: digits -> number, true/false -> boolean, else string", () => {
    expect(loadEnv({ ...base, TRUST_PROXY: "1" }).TRUST_PROXY).toBe(1);
    expect(loadEnv({ ...base, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
    expect(loadEnv({ ...base, TRUST_PROXY: "false" }).TRUST_PROXY).toBe(false);
    expect(loadEnv({ ...base, TRUST_PROXY: "loopback" }).TRUST_PROXY).toBe("loopback");
    expect(loadEnv(base).TRUST_PROXY).toBe("loopback");
  });
  it("ops env needs only DATABASE_URL and LOG_LEVEL", () => {
    expect(loadOpsEnv({ DATABASE_URL: "postgres://a@b/c" })).toEqual({ DATABASE_URL: "postgres://a@b/c", LOG_LEVEL: "info" });
    expect(() => loadOpsEnv({})).toThrow(/DATABASE_URL/);
  });
  it("rejects short secrets and names the key", () => {
    expect(() => loadEnv({ ...base, SESSION_TOKEN_PEPPER: "short" })).toThrow(/SESSION_TOKEN_PEPPER/);
  });
});

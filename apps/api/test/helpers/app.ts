import { sql } from "drizzle-orm";
import type { Express } from "express";
import { createApp } from "../../src/app.js";
import { loadEnv, type Env } from "../../src/config/env.js";
import type { AppDeps } from "../../src/deps.js";
import { createLogger } from "../../src/shared/logger.js";
import { testDb } from "./db.js";
import { FakeEmailSender, FakeEvmRpc, FakeRateLimiter, FakeSmsOtp } from "./fakes.js";

export const ORIGIN = "http://localhost:3000";

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return loadEnv({
    NODE_ENV: "test", PORT: "0", LOG_LEVEL: "silent",
    DATABASE_URL: process.env.TEST_DATABASE_URL, REDIS_URL: process.env.TEST_REDIS_URL,
    SESSION_TOKEN_PEPPER: "test-pepper-test-pepper-test-pepper-00", OTP_HMAC_SECRET: "test-otp-secret-test-otp-secret-000",
    ALCHEMY_API_KEY: "x", RESEND_API_KEY: "x", EMAIL_FROM: "Bytesac <no-reply@test.dev>",
    TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "x", TWILIO_VERIFY_SERVICE_SID: "VA",
    SMS_ALLOWED_COUNTRIES: "IN,US,GB", AUTH_DOMAIN: "localhost:3000", AUTH_URI: ORIGIN,
    ALLOWED_ORIGINS: ORIGIN, COOKIE_SECURE: "false", TRUST_PROXY: "loopback",
    ...overrides,
  });
}

export interface TestApp {
  app: Express;
  deps: AppDeps;
  fakes: { evmRpc: FakeEvmRpc; email: FakeEmailSender; sms: FakeSmsOtp; rateLimiter: FakeRateLimiter };
}

export function buildTestApp(overrides: Partial<AppDeps> = {}): TestApp {
  const fakes = { evmRpc: new FakeEvmRpc(), email: new FakeEmailSender(), sms: new FakeSmsOtp(), rateLimiter: new FakeRateLimiter() };
  const deps: AppDeps = {
    env: testEnv(), db: testDb.db, logger: createLogger("silent"),
    rateLimiter: fakes.rateLimiter, evmRpc: fakes.evmRpc, emailSender: fakes.email, smsOtp: fakes.sms,
    health: { db: async () => { await testDb.db.execute(sql`select 1`); }, redis: async () => undefined },
    ...overrides,
  };
  return { app: createApp(deps), deps, fakes };
}

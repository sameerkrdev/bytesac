import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// TEST_* connection strings come from apps/api/.env (or the CI environment).
const local = loadEnv("test", process.cwd(), "TEST_");
const fromEnv = (key: string) => process.env[key] ?? local[key];

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: fromEnv("TEST_DATABASE_URL"),
      TEST_ADMIN_DATABASE_URL: fromEnv("TEST_ADMIN_DATABASE_URL"),
      REDIS_URL: fromEnv("TEST_REDIS_URL"),
      SESSION_TOKEN_PEPPER: "test-pepper-test-pepper-test-pepper-00",
      OTP_HMAC_SECRET: "test-otp-secret-test-otp-secret-000",
      ALCHEMY_API_KEY: "x",
      COINMARKETCAP_API_KEY: "test-cmc-key",
      LIFI_API_KEY: "test-lifi-key",
      GEMINI_API_KEY: "test-gemini-key",
      RESEND_API_KEY: "x",
      EMAIL_FROM: "Bytesac <no-reply@test.dev>",
      TWILIO_ACCOUNT_SID: "AC",
      TWILIO_AUTH_TOKEN: "x",
      TWILIO_VERIFY_SERVICE_SID: "VA",
      SMS_ALLOWED_COUNTRIES: "IN,US,GB",
      AUTH_DOMAIN: "localhost:3000",
      AUTH_URI: "http://localhost:3000",
      ALLOWED_ORIGINS: "http://localhost:3000",
      COOKIE_SECURE: "false",
      TRUST_PROXY: "loopback",
      R2_ACCOUNT_ID: "acct",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_BUCKET: "bytesac-test",
    },
  },
});

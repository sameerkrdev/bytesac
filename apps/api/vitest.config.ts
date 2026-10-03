import { fileURLToPath } from "node:url";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// TEST_* connection strings come from apps/api/.env (or the CI environment).
const local = loadEnv("test", process.cwd(), "TEST_");
const fromEnv = (key: string) => process.env[key] ?? local[key];

// Throwaway platform keys for every test run: nothing here is a real key and nothing is committed.
const solanaKey = () => {
  const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  return { secret: bs58.encode(Buffer.concat([Buffer.from(jwk.d!, "base64url"), Buffer.from(jwk.x!, "base64url")])), pub: bs58.encode(Buffer.from(jwk.x!, "base64url")) };
};

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
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
      SOLANA_FEE_PAYER_SECRET: solanaKey().secret,
      EVM_GAS_WALLET_SECRET: `0x${randomBytes(32).toString("hex")}`,
      GAS_TREASURY_SOLANA_ADDRESS: solanaKey().pub,
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

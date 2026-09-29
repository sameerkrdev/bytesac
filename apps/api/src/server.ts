import { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { AlchemyEvmRpc } from "./adapters/evm-rpc.js";
import { ResendEmailSender } from "./adapters/email-sender.js";
import { RedisRateLimiter } from "./adapters/rate-limiter.js";
import { TwilioVerifySmsOtp } from "./adapters/sms-otp.js";
import { createApp } from "./app.js";
import { loadDotEnvIfPresent, loadEnv } from "./config/env.js";
import { createDb } from "@repo/db";
import { createLogger } from "./shared/logger.js";

loadDotEnvIfPresent();
const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const { db } = createDb(env.DATABASE_URL);
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

const app = createApp({
  env, db, logger,
  rateLimiter: new RedisRateLimiter(redis),
  evmRpc: new AlchemyEvmRpc(env.ALCHEMY_API_KEY),
  emailSender: new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM),
  smsOtp: new TwilioVerifySmsOtp(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, env.TWILIO_VERIFY_SERVICE_SID),
  health: { db: async () => { await db.execute(sql`select 1`); }, redis: async () => { await redis.ping(); } },
});

app.listen(env.PORT, () => logger.info({ port: env.PORT }, "api listening"));

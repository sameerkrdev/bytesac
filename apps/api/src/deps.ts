import type { EmailSender } from "./adapters/email-sender.js";
import type { EvmRpc } from "./adapters/evm-rpc.js";
import type { RateLimiter } from "./adapters/rate-limiter.js";
import type { SmsOtpProvider } from "./adapters/sms-otp.js";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import type { Logger } from "./shared/logger.js";

export interface AppDeps {
  env: Env;
  db: Db;
  logger: Logger;
  rateLimiter: RateLimiter;
  evmRpc: EvmRpc;
  emailSender: EmailSender;
  smsOtp: SmsOtpProvider;
  health: { db(): Promise<void>; redis(): Promise<void> };
}

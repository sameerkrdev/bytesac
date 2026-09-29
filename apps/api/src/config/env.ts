import { z } from "zod";

const list = (upper: boolean) =>
  z.string().transform((s) => s.split(",").map((x) => (upper ? x.trim().toUpperCase() : x.trim())).filter(Boolean));

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.url(),
  MIGRATOR_DATABASE_URL: z.url().optional(),
  RETENTION_DATABASE_URL: z.url().optional(),
  REDIS_URL: z.url(),
  SESSION_TOKEN_PEPPER: z.string().min(32),
  OTP_HMAC_SECRET: z.string().min(32),
  ALCHEMY_API_KEY: z.string().min(1),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(3),
  TWILIO_ACCOUNT_SID: z.string().min(1),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  TWILIO_VERIFY_SERVICE_SID: z.string().min(1),
  SMS_ALLOWED_COUNTRIES: list(true).pipe(z.array(z.string().length(2)).min(1)),
  AUTH_DOMAIN: z.string().min(1),
  AUTH_URI: z.url(),
  ALLOWED_ORIGINS: list(false).pipe(z.array(z.url()).min(1)),
  COOKIE_SECURE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  TRUST_PROXY: z.string().default("loopback"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration: ${keys}`);
  }
  return parsed.data;
}

/** Loads apps/api/.env for local runs; production must inject real env vars. */
export function loadDotEnvIfPresent(): void {
  if (process.env.NODE_ENV === "production") return;
  try {
    process.loadEnvFile(".env");
  } catch {
    // no .env file: rely on the process environment
  }
}

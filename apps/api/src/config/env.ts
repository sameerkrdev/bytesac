import { z } from "zod";

const list = (upper: boolean) =>
  z.string().transform((s) => s.split(",").map((x) => (upper ? x.trim().toUpperCase() : x.trim())).filter(Boolean));

/** Express treats "1" as an IP and rejects "true": digits become a hop count, true/false a boolean, anything else an IP/CIDR/keyword list. */
const trustProxy = z.string().default("loopback").transform((v): boolean | number | string => {
  const t = v.trim();
  if (/^[0-9]+$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return t;
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().nonnegative().default(4000),
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
  TRUST_PROXY: trustProxy,
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

const opsEnvSchema = z.object({
  DATABASE_URL: z.url(),
  LOG_LEVEL: envSchema.shape.LOG_LEVEL,
});

/** The ops CLI needs only the database; it must not require provider keys. */
export function loadOpsEnv(source: NodeJS.ProcessEnv = process.env): z.infer<typeof opsEnvSchema> {
  const parsed = opsEnvSchema.safeParse(source);
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

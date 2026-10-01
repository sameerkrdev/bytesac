import { cleanEnv, makeValidator, port, str, url, bool } from "envalid";

const commaList = (upper: boolean) => (raw: string) =>
  raw.split(",").map((x) => (upper ? x.trim().toUpperCase() : x.trim())).filter(Boolean);

/** envalid `str()` accepts an empty string; provider keys and domains must be set. */
const nonEmpty = makeValidator((v) => {
  if (!v.trim()) throw new Error("must not be empty");
  return v;
});

const secret = makeValidator((v) => {
  if (v.length < 32) throw new Error("must be at least 32 characters");
  return v;
});

const countries = makeValidator((v) => {
  const list = commaList(true)(v);
  if (list.length === 0 || list.some((c) => c.length !== 2)) throw new Error("expected comma-separated ISO 3166-1 alpha-2 codes");
  return list;
});

const origins = makeValidator((v) => {
  const list = commaList(false)(v);
  if (list.length === 0 || list.some((o) => !URL.canParse(o))) throw new Error("expected comma-separated URLs");
  return list;
});

/** Express treats "1" as an IP and rejects "true": digits become a hop count, true/false a boolean, anything else an IP/CIDR/keyword list. */
const trustProxy = makeValidator<boolean | number | string>((v) => {
  const t = v.trim();
  if (/^[0-9]+$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return t;
});

const routeProviders = makeValidator((v) => {
  const list = commaList(false)(v).map((x) => x.toLowerCase());
  if (list.length === 0 || list.some((x) => x !== "lifi")) throw new Error("expected a comma-separated list of known route providers (lifi)");
  return list;
});

export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ["development", "test", "production"], default: "development" }),
  PORT: port({ default: 4000 }),
  REDIS_URL: url(),
  SESSION_TOKEN_PEPPER: secret(),
  OTP_HMAC_SECRET: secret(),
  ALCHEMY_API_KEY: nonEmpty(),
  RESEND_API_KEY: nonEmpty(),
  EMAIL_FROM: nonEmpty(),
  TWILIO_ACCOUNT_SID: nonEmpty(),
  TWILIO_AUTH_TOKEN: nonEmpty(),
  TWILIO_VERIFY_SERVICE_SID: nonEmpty(),
  SMS_ALLOWED_COUNTRIES: countries(),
  AUTH_DOMAIN: nonEmpty(),
  AUTH_URI: url(),
  ALLOWED_ORIGINS: origins(),
  COOKIE_SECURE: bool({ default: true }),
  TRUST_PROXY: trustProxy({ default: "loopback" }),
  R2_ACCOUNT_ID: nonEmpty(),
  R2_ACCESS_KEY_ID: nonEmpty(),
  R2_SECRET_ACCESS_KEY: nonEmpty(),
  R2_BUCKET: nonEmpty(),
  /** Empty disables market prices (they report "unavailable"). */
  COINMARKETCAP_API_KEY: str({ default: "" }),
  /** Empty disables AI search and embeddings (structured and keyword search still work). */
  GEMINI_API_KEY: str({ default: "" }),
  GEMINI_MODEL: str({ default: "gemini-3.1-flash-lite" }),
  GEMINI_EMBEDDING_MODEL: str({ default: "gemini-embedding-2" }),
  /** Empty disables routing: quotes and connection checks fail with ROUTE_UNAVAILABLE. */
  LIFI_API_KEY: str({ default: "" }),
  LIFI_INTEGRATOR: str({ default: "bytesac" }),
  /** Platform keys (KMS before launch): never logged. Empty disables Solana fee sponsoring / EVM gas drops. Solana: base58 of the 64-byte secret key. EVM: 0x-prefixed private key. */
  SOLANA_FEE_PAYER_SECRET: str({ default: "" }),
  EVM_GAS_WALLET_SECRET: str({ default: "" }),
  /** Owner (public address) of the platform's USDC token account that receives network fees. */
  GAS_TREASURY_SOLANA_ADDRESS: str({ default: "" }),
  /** Firebase service-account JSON for web push (a secret). Empty disables push; the inbox and email still work. */
  FIREBASE_SERVICE_ACCOUNT: str({ default: "" }),
  ROUTE_PROVIDER_ORDER: routeProviders({ default: ["lifi"] }),
});

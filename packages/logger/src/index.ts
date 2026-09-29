import winston from "winston";

const levels = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const isProduction = process.env.NODE_ENV === "production";

/** Values that must never reach a log line: credentials, signatures, OTP codes and contact details. */
const REDACTED_KEYS = /^(token|tokenHash|signature|code|codeHash|password|secret|value|destination|email|phone|authorization|cookie|set-cookie)$/i;

const redact = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(redact);
  if (typeof v !== "object" || v === null) return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, REDACTED_KEYS.test(k) ? "[redacted]" : redact(x)]));
};

const redacted = winston.format((info) => Object.assign(info, redact(info)));

winston.addColors({ error: "red", warn: "yellow", info: "green", http: "magenta", debug: "blue" });

/** `LOG_LEVEL` is one of error|warn|info|http|debug|silent; the default is info in production and debug otherwise. */
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  silent: process.env.LOG_LEVEL === "silent",
  levels,
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), redacted()),
  transports: [
    new winston.transports.Console({
      format: isProduction
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize({ all: true }),
            winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
              const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
              return `${timestamp} ${level}: ${message}${extra}${stack ? `\n${stack}` : ""}`;
            }),
          ),
    }),
  ],
});

export type Logger = winston.Logger;

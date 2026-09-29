import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.cookie", "req.headers.authorization", "res.headers[\"set-cookie\"]",
        "*.token", "*.tokenHash", "*.signature", "*.code", "*.codeHash", "*.password",
        "*.value", "*.destination", "*.secret",
      ],
      censor: "[redacted]",
    },
  });
}

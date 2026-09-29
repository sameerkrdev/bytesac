import { pino, type DestinationStream, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    redact: {
      paths: [
        "req.headers.cookie", "req.headers.authorization", "res.headers[\"set-cookie\"]",
        "*.token", "*.tokenHash", "*.signature", "*.code", "*.codeHash", "*.password",
        "*.value", "*.destination", "*.secret",
      ],
      censor: "[redacted]",
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

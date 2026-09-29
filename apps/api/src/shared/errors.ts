import type { ErrorCode } from "@repo/validator";

export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly retryAfterSec?: number;

  constructor(code: ErrorCode, message: string, opts: { details?: unknown; retryAfterSec?: number } = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = opts.details;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

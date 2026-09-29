import type { ErrorCode } from "@repo/validator";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK_ERROR",
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
    /** Server-provided extra data, e.g. `{ applicationId }` on OTP_DELIVERY_FAILED for a new application. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

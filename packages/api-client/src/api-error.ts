import type { ErrorCode } from "@repo/validator";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | "NETWORK_ERROR",
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

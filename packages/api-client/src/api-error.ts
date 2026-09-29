import type { ErrorCode } from "@repo/contracts";

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

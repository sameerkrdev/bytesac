import { ApiError } from "@repo/api-client";
import { describeError } from "@repo/app-core";

export interface DisplayError { title: string; message?: string }

/** Copy for an API/network failure. Validation errors show the server's own (field-specific) message. */
export function toDisplayError(e: unknown): DisplayError {
  if (e instanceof ApiError && e.code === "VALIDATION_FAILED") return { title: e.message };
  const { title, message } = describeError(e instanceof ApiError ? e.code : "INTERNAL");
  return { title, message };
}

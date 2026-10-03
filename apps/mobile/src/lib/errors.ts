import { ApiError } from "@repo/api-client";
import { describeError, WalletRejectedError, WrongWalletError } from "@repo/app-core";

export interface DisplayError { title: string; message?: string }

/** Copy for an API, network or wallet failure. Validation errors show the server's own (field-specific) message. */
export function displayError(e: unknown): DisplayError {
  if (e instanceof ApiError && e.code === "VALIDATION_FAILED") return { title: e.message };
  if (e instanceof ApiError && e.code === "INSUFFICIENT_BALANCE") return { title: describeError("INSUFFICIENT_BALANCE").title, message: e.message };
  if (e instanceof WrongWalletError) return { title: "Wrong wallet", message: e.message };
  if (e instanceof WalletRejectedError) return describeError("WALLET_REJECTED");
  const { title, message } = describeError(e instanceof ApiError ? e.code : "INTERNAL") ?? describeError("INTERNAL");
  return { title, message };
}

/** True when the API refused because the user has no current eligibility declaration. */
export const isDeclarationRequired = (e: unknown) => e instanceof ApiError && e.code === "DECLARATION_REQUIRED";

import type { DescribableCode } from "./error-copy.js";

export type VerifyState =
  | { step: "idle" }
  | { step: "signing" }
  | { step: "verifying" }
  | { step: "done"; isNewUser: boolean }
  | { step: "error"; code: DescribableCode; retryAfterSec?: number };

export type VerifyEvent =
  | { type: "START" }
  | { type: "SIGNED" }
  | { type: "VERIFIED"; isNewUser: boolean }
  | { type: "FAILED"; code: DescribableCode; retryAfterSec?: number }
  | { type: "RESET" };

export function verifyReducer(s: VerifyState, e: VerifyEvent): VerifyState {
  switch (e.type) {
    case "START":
      return s.step === "signing" || s.step === "verifying" ? s : { step: "signing" };
    case "SIGNED":
      return s.step === "signing" ? { step: "verifying" } : s;
    case "VERIFIED":
      return { step: "done", isNewUser: e.isNewUser };
    case "FAILED":
      return { step: "error", code: e.code, ...(e.retryAfterSec === undefined ? {} : { retryAfterSec: e.retryAfterSec }) };
    case "RESET":
      return { step: "idle" };
  }
}

export function normalizeOtp(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

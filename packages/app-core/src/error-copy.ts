import type { ErrorCode } from "@repo/validator";

export type Recovery = "retry" | "restart" | "reauthenticate" | "fix-input" | "wait" | "contact-support";
export type DescribableCode = ErrorCode | "NETWORK_ERROR" | "WALLET_REJECTED";

const COPY: Record<DescribableCode, { title: string; message: string; recovery: Recovery }> = {
  VALIDATION_FAILED: { title: "Check your details", message: "Some information isn't valid. Review the highlighted fields.", recovery: "fix-input" },
  UNSUPPORTED_CHAIN: { title: "Unsupported network", message: "Switch your wallet to Ethereum, Base, BNB Chain, Arbitrum or Solana.", recovery: "fix-input" },
  CHALLENGE_NOT_FOUND: { title: "Sign-in request not found", message: "Start the sign-in again.", recovery: "restart" },
  CHALLENGE_EXPIRED: { title: "Sign-in request expired", message: "The request is valid for 5 minutes. Start again to get a new one.", recovery: "restart" },
  CHALLENGE_CONSUMED: { title: "Request already used", message: "This sign-in request was already used. Start again.", recovery: "restart" },
  CHALLENGE_IN_PROGRESS: { title: "Still verifying", message: "We're already verifying this signature. Wait a moment.", recovery: "wait" },
  SIGNATURE_INVALID: { title: "Signature not accepted", message: "We couldn't verify the signature for this address. Start again.", recovery: "restart" },
  VERIFIER_UNAVAILABLE: { title: "Verification unavailable", message: "Wallet verification is temporarily unavailable. Try again.", recovery: "retry" },
  ADDRESS_DISABLED: { title: "Address disabled", message: "This wallet address has been disabled. Contact support.", recovery: "contact-support" },
  ADDRESS_ALREADY_LINKED: { title: "Address already linked", message: "This address belongs to another Bytesac account.", recovery: "fix-input" },
  CHAIN_FAMILY_ALREADY_LINKED: { title: "Different wallet", message: "A different address on this network family is already linked. Use the same wallet.", recovery: "fix-input" },
  SESSION_EXPIRED: { title: "Session expired", message: "Sign in with your wallet again to continue.", recovery: "reauthenticate" },
  USER_NOT_ACTIVE: { title: "Account unavailable", message: "This account is not active. Contact support.", recovery: "contact-support" },
  CSRF_REJECTED: { title: "Request blocked", message: "Reload the page and try again.", recovery: "retry" },
  NOT_FOUND: { title: "Not found", message: "This item no longer exists. Refresh and try again.", recovery: "retry" },
  OTP_INVALID: { title: "Incorrect code", message: "That code is incorrect. Check it and try again.", recovery: "fix-input" },
  OTP_EXPIRED: { title: "Code expired", message: "Request a new code.", recovery: "restart" },
  OTP_ATTEMPTS_EXCEEDED: { title: "Too many attempts", message: "Request a new code.", recovery: "restart" },
  OTP_COOLDOWN: { title: "Please wait", message: "You can request another code shortly.", recovery: "wait" },
  OTP_DELIVERY_FAILED: { title: "Code not sent", message: "We couldn't send the code. Try again shortly.", recovery: "retry" },
  RATE_LIMITED: { title: "Too many requests", message: "Wait a moment and try again.", recovery: "wait" },
  INVALID_TRANSITION: { title: "Action not allowed", message: "That change isn't allowed in the current state. Refresh and try again.", recovery: "retry" },
  APPLICATION_EXISTS: { title: "Application already in progress", message: "An application for this email or wallet is already in progress. Check your email.", recovery: "fix-input" },
  APPLICATION_TOKEN_INVALID: { title: "Status link invalid", message: "This status link is invalid or has expired.", recovery: "contact-support" },
  REPLY_NOT_ALLOWED: { title: "Reply not available", message: "This application isn't waiting for a reply.", recovery: "retry" },
  FORBIDDEN: { title: "No access", message: "You don't have access to this area.", recovery: "contact-support" },
  INTERNAL: { title: "Something went wrong", message: "Try again. If it keeps happening, contact support.", recovery: "retry" },
  NETWORK_ERROR: { title: "No connection", message: "Check your connection and try again.", recovery: "retry" },
  WALLET_REJECTED: { title: "Signature cancelled", message: "You cancelled the request in your wallet. Try again when ready.", recovery: "retry" },
};

export function describeError(code: DescribableCode) {
  return COPY[code];
}

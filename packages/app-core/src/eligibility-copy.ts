/** What the user sees for a tokenized asset they can't buy; the server decides the outcome, this only words it. */
export const OUTCOME_NOTICE: Record<string, string> = {
  RESTRICTED: "Not available in your region / for your investor status",
  KYC_REQUIRED: "Identity verification required — not available yet",
  REVIEW_REQUIRED: "Needs review — contact support",
  DECLARATION_REQUIRED: "Declare your country and investor status in your profile to see availability",
};

/** Where the user fixes each reason they cannot invest yet (`target` is app-agnostic: each app maps it to its own route). */
export const INELIGIBLE_ACTION: Record<string, { target: "profile" | "portfolio"; label: string }> = {
  EMAIL_NOT_VERIFIED: { target: "profile", label: "Verify your email" },
  PHONE_NOT_VERIFIED: { target: "profile", label: "Verify your phone" },
  EVM_ADDRESS_REQUIRED: { target: "profile", label: "Link an EVM wallet" },
  SOLANA_ADDRESS_REQUIRED: { target: "profile", label: "Link a Solana wallet" },
  BTC_ADDRESS_REQUIRED: { target: "profile", label: "Link a Bitcoin wallet" },
  OPERATION_IN_PROGRESS: { target: "portfolio", label: "Finish your current operation" },
};

/** The per-asset notices of a basket: only outcomes that block the user, in server order. */
export const blockedAssetNotices = (assets: { instrumentId: string; outcome: string }[]) =>
  assets.filter((a) => OUTCOME_NOTICE[a.outcome]).map((a) => ({ instrumentId: a.instrumentId, text: OUTCOME_NOTICE[a.outcome]! }));

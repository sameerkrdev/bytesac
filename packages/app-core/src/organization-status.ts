import type { OrganizationStatus, PayoutWalletStatus } from "@repo/validator";

type Tone = "success" | "warning" | "danger" | "neutral";
type Label = { label: string; tone: Tone };

export const ORGANIZATION_STATUS_LABEL: Record<OrganizationStatus, Label> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SUBMITTED: { label: "Submitted", tone: "neutral" },
  UNDER_REVIEW: { label: "Under review", tone: "neutral" },
  CHANGES_REQUIRED: { label: "Changes required", tone: "warning" },
  RESUBMITTED: { label: "Resubmitted", tone: "neutral" },
  VERIFIED: { label: "Verified", tone: "success" },
  REJECTED: { label: "Not approved", tone: "danger" },
};

export const PAYOUT_WALLET_STATUS_LABEL: Record<PayoutWalletStatus, Label> = {
  UNVERIFIED: { label: "Not yet signed", tone: "warning" },
  VERIFYING: { label: "Waiting for signature", tone: "warning" },
  VERIFIED: { label: "Verified", tone: "success" },
  REPLACEMENT_PENDING: { label: "Replacement awaiting review", tone: "warning" },
  REVOKED: { label: "Revoked", tone: "neutral" },
};

import type { MembershipRole, MembershipStatus, MemberVerificationStatus } from "@repo/validator";

type Tone = "success" | "warning" | "danger" | "neutral";
type Label = { label: string; tone: Tone };

export const MEMBERSHIP_ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: "Owner", ADMIN: "Admin", MANAGER: "Manager", ANALYST: "Analyst", VIEWER: "Viewer",
};

export const MEMBERSHIP_STATUS_LABEL: Record<MembershipStatus, Label> = {
  PENDING_WALLET_VERIFICATION: { label: "Waiting for wallet", tone: "neutral" },
  INVITED: { label: "Invited", tone: "neutral" },
  PENDING_DOCUMENTS: { label: "Verification needed", tone: "warning" },
  UNDER_REVIEW: { label: "Under review", tone: "neutral" },
  CHANGES_REQUIRED: { label: "Changes required", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  REJECTED: { label: "Not approved", tone: "danger" },
  REMOVAL_REQUESTED: { label: "Removal requested", tone: "warning" },
  REVOKED: { label: "Removed", tone: "neutral" },
};

export const MEMBER_VERIFICATION_STATUS_LABEL: Record<MemberVerificationStatus, Label> = {
  draft: { label: "Not submitted", tone: "warning" },
  in_review: { label: "In review", tone: "neutral" },
  changes_required: { label: "Changes required", tone: "warning" },
  approved: { label: "Verified", tone: "success" },
  rejected: { label: "Not approved", tone: "danger" },
};

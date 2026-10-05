import type { MembershipRole, MembershipStatus, MemberVerificationStatus, OrganizationPermission } from "@repo/validator";

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

/** Plain-language meaning of each organization permission, grouped by whether it lets someone see or change things (ADR-019). */
export const PERMISSION_INFO: Record<OrganizationPermission, { label: string; detail: string; kind: "see" | "change" | "owner" }> = {
  "org.read": { label: "See the organization", detail: "Profile, team list, baskets and their versions.", kind: "see" },
  "analytics.read": { label: "See adoption", detail: "How many investors applied, skipped or haven't answered each basket version (small counts hidden).", kind: "see" },
  "earnings.read": { label: "See earnings", detail: "Settled manager fees and the earnings export.", kind: "see" },
  "baskets.manage": { label: "Work on baskets", detail: "Create baskets and act on the ones they're assigned to (edit, submit, publish as the assignment allows).", kind: "change" },
  "members.manage": { label: "Manage the team", detail: "Invite and remove members and change roles (not admins).", kind: "change" },
  "members.manage_admins": { label: "Manage admins and roles", detail: "Add or remove admins and define custom roles.", kind: "owner" },
  "org.edit": { label: "Edit the organization", detail: "Profile, documents and change requests.", kind: "owner" },
  "payout.manage": { label: "Set the payout wallet", detail: "Where manager fees are paid.", kind: "owner" },
};

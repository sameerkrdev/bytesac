import { z } from "zod";
import { chainSchema } from "./chains";
import { membershipRoleSchema, type MembershipRole, type OrganizationPermission } from "./organizations";

export const MEMBERSHIP_STATUSES = [
  "PENDING_WALLET_VERIFICATION", "INVITED", "PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED", "ACTIVE", "REJECTED", "REMOVAL_REQUESTED", "REVOKED",
] as const;
export const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

/** Every transition a membership can make; anything else is a 409 INVALID_TRANSITION. Who may trigger each one is decided by the service. */
export const MEMBERSHIP_TRANSITIONS: Readonly<Record<MembershipStatus, readonly MembershipStatus[]>> = {
  PENDING_WALLET_VERIFICATION: ["INVITED", "REVOKED"],
  INVITED: ["ACTIVE", "PENDING_DOCUMENTS", "REJECTED", "REVOKED"],
  PENDING_DOCUMENTS: ["UNDER_REVIEW", "REJECTED"],
  UNDER_REVIEW: ["ACTIVE", "CHANGES_REQUIRED", "REJECTED"],
  CHANGES_REQUIRED: ["UNDER_REVIEW", "REJECTED"],
  ACTIVE: ["REMOVAL_REQUESTED", "REVOKED"],
  REMOVAL_REQUESTED: ["ACTIVE", "REVOKED"],
  REJECTED: [],
  REVOKED: [],
};

/** Only an ACTIVE membership grants permissions. Roles that need the member's own verification before they are ACTIVE. */
export const REVIEWED_ROLES = ["ADMIN", "MANAGER"] as const;

/** The one permission matrix, shared by the API and the web app. The server is authoritative. */
export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly OrganizationPermission[]>> = {
  OWNER: ["org.read", "org.edit", "payout.manage", "members.manage", "members.manage_admins", "analytics.read", "baskets.manage"],
  ADMIN: ["org.read", "members.manage", "analytics.read", "baskets.manage"],
  MANAGER: ["org.read", "analytics.read", "baskets.manage"],
  ANALYST: ["org.read", "analytics.read"],
  VIEWER: ["org.read"],
};

const INVITABLE_ROLES = ["ADMIN", "MANAGER", "ANALYST", "VIEWER"] as const;
const invitableRoleSchema = z.enum(INVITABLE_ROLES);

export const inviteMemberRequestSchema = z.strictObject({
  walletChain: chainSchema,
  walletAddress: z.string().trim().min(1).max(128),
  role: invitableRoleSchema,
  email: z.email().max(254).toLowerCase(),
});
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

export const changeRoleRequestSchema = z.strictObject({ role: invitableRoleSchema });
export type ChangeRoleRequest = z.infer<typeof changeRoleRequestSchema>;

/** `null` clears a value; an omitted key is left unchanged. */
export const membershipProfileRequestSchema = z.strictObject({
  publicDisplayName: z.string().trim().min(2).max(80).nullable().optional(),
  publicTitle: z.string().trim().max(80).nullable().optional(),
});
export type MembershipProfileRequest = z.infer<typeof membershipProfileRequestSchema>;

const isoTime = z.iso.datetime({ offset: true });

/**
 * One row of the member list. The invited wallet and email are only filled for callers holding `members.manage`;
 * `verificationStatus` is the status of the member's own verification, never its content.
 */
export const memberViewSchema = z.object({
  id: z.uuid(),
  role: membershipRoleSchema,
  requestedRole: membershipRoleSchema.nullable(),
  status: membershipStatusSchema,
  publicDisplayName: z.string().nullable(),
  publicTitle: z.string().nullable(),
  isSelf: z.boolean(),
  activatedAt: isoTime.nullable(),
  inviteExpiresAt: isoTime.nullable(),
  invitedWallet: z.object({ chain: chainSchema, address: z.string() }).nullable(),
  invitedEmail: z.string().nullable(),
  verificationStatus: z.enum(["draft", "in_review", "changes_required", "approved", "rejected"]).nullable(),
});
export type MemberView = z.infer<typeof memberViewSchema>;

export const listMembersResponseSchema = z.object({ members: z.array(memberViewSchema) });
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;

export const invitationViewSchema = z.object({
  membershipId: z.uuid(),
  organization: z.object({ id: z.uuid(), displayName: z.string().nullable() }),
  role: membershipRoleSchema,
  expiresAt: isoTime,
});
export type InvitationView = z.infer<typeof invitationViewSchema>;

export const listInvitationsResponseSchema = z.object({ invitations: z.array(invitationViewSchema) });
export type ListInvitationsResponse = z.infer<typeof listInvitationsResponseSchema>;

/** The caller's own membership after one of their lifecycle actions. */
export const myMembershipSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  role: membershipRoleSchema,
  requestedRole: membershipRoleSchema.nullable(),
  status: membershipStatusSchema,
  publicDisplayName: z.string().nullable(),
  publicTitle: z.string().nullable(),
});
export type MyMembership = z.infer<typeof myMembershipSchema>;

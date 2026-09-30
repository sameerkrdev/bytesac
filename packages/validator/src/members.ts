import { z } from "zod";
import { chainSchema } from "./chains";
import { documentViewSchema, draftPart, membershipRoleSchema, organizationStatusSchema, type MembershipRole, type OrganizationPermission } from "./organizations";

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

export const MEMBER_VERIFICATION_STATUSES = ["draft", "in_review", "changes_required", "approved", "rejected"] as const;
export const memberVerificationStatusSchema = z.enum(MEMBER_VERIFICATION_STATUSES);
export type MemberVerificationStatus = z.infer<typeof memberVerificationStatusSchema>;

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
  verificationStatus: memberVerificationStatusSchema.nullable(),
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

// ---------------------------------------------------------------------------------------------------------------------
// Member verification (the member's own KYC: visible to the member and ops only)
// ---------------------------------------------------------------------------------------------------------------------

/** Keys must be private catalog fields (the service narrows them to the member template); `null` removes a key. */
export const updateMemberVerificationRequestSchema = z.strictObject({ details: draftPart("private") });
export type UpdateMemberVerificationRequest = z.infer<typeof updateMemberVerificationRequestSchema>;

const organizationRef = z.object({ id: z.uuid(), displayName: z.string().nullable() });

export const memberVerificationViewSchema = z.object({
  membershipId: z.uuid(),
  membershipStatus: membershipStatusSchema,
  role: membershipRoleSchema,
  requestedRole: membershipRoleSchema.nullable(),
  organization: organizationRef,
  status: memberVerificationStatusSchema,
  details: z.record(z.string(), z.unknown()),
  documents: z.array(documentViewSchema),
  template: z.object({ requiredFields: z.array(z.string()), requiredDocuments: z.array(z.string()) }),
  missing: z.object({ fields: z.array(z.string()), documents: z.array(z.string()) }),
  submittedAt: isoTime.nullable(),
  latestMessageToMember: z.string().nullable(),
});
export type MemberVerificationView = z.infer<typeof memberVerificationViewSchema>;

// Ops review

export const listMemberReviewQuerySchema = z.object({ status: membershipStatusSchema.optional(), cursor: z.string().max(200).optional() });
export type ListMemberReviewQuery = z.input<typeof listMemberReviewQuerySchema>;

export const memberReviewSummarySchema = z.object({
  id: z.uuid(),
  organization: organizationRef,
  publicDisplayName: z.string().nullable(),
  role: membershipRoleSchema,
  requestedRole: membershipRoleSchema.nullable(),
  status: membershipStatusSchema,
  verificationStatus: memberVerificationStatusSchema.nullable(),
  submittedAt: isoTime.nullable(),
  updatedAt: isoTime,
});
export type MemberReviewSummary = z.infer<typeof memberReviewSummarySchema>;

export const listMemberReviewResponseSchema = z.object({ items: z.array(memberReviewSummarySchema), nextCursor: z.string().nullable() });
export type ListMemberReviewResponse = z.infer<typeof listMemberReviewResponseSchema>;

const reviewNote = z.string().trim().min(1).max(4000);

export const decideMemberVerificationRequestSchema = z.strictObject({
  decision: z.enum(["approved", "changes_required", "rejected"]),
  messageToMember: reviewNote.optional(),
  internalNote: reviewNote.optional(),
}).refine((v) => v.decision !== "changes_required" || v.messageToMember, { path: ["messageToMember"], message: "A message to the member is required" });
export type DecideMemberVerificationRequest = z.infer<typeof decideMemberVerificationRequestSchema>;

export const membershipEventViewSchema = z.object({
  id: z.uuid(),
  actorType: z.enum(["member", "org", "ops", "system"]),
  actorUserId: z.uuid().nullable(),
  kind: z.string(),
  fromStatus: membershipStatusSchema.nullable(),
  toStatus: membershipStatusSchema.nullable(),
  fromRole: membershipRoleSchema.nullable(),
  toRole: membershipRoleSchema.nullable(),
  decision: z.string().nullable(),
  messageToMember: z.string().nullable(),
  internalNote: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: isoTime,
});

/** Ops view: the member's own details and documents (metadata; downloads go through the ops download route), wallets and history. */
export const memberReviewDetailSchema = z.object({
  id: z.uuid(),
  organization: organizationRef.extend({ status: organizationStatusSchema }),
  userId: z.uuid().nullable(),
  addresses: z.array(z.object({ chain: chainSchema, address: z.string() })),
  role: membershipRoleSchema,
  requestedRole: membershipRoleSchema.nullable(),
  status: membershipStatusSchema,
  verification: z.object({
    id: z.uuid(),
    status: memberVerificationStatusSchema,
    details: z.record(z.string(), z.unknown()),
    submittedAt: isoTime.nullable(),
    documents: z.array(documentViewSchema),
  }).nullable(),
  events: z.array(membershipEventViewSchema),
});
export type MemberReviewDetail = z.infer<typeof memberReviewDetailSchema>;

export const transferOwnershipRequestSchema = z.strictObject({ targetMembershipId: z.uuid(), reason: z.string().trim().min(10).max(1000) });
export type TransferOwnershipRequest = z.infer<typeof transferOwnershipRequestSchema>;

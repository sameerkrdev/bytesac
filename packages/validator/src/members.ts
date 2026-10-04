import { z } from "zod";
import { chainSchema, signInChainSchema } from "./chains";
import { documentViewSchema, draftPart, membershipRoleSchema, organizationPermissionSchema, organizationStatusSchema, type MembershipRole, type OrganizationPermission } from "./organizations";

export const MEMBERSHIP_STATUSES = [
  "PENDING_WALLET_VERIFICATION", "INVITED", "PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED", "ACTIVE", "REJECTED", "REMOVAL_REQUESTED", "REVOKED",
] as const;
export const membershipStatusSchema = z.enum(MEMBERSHIP_STATUSES);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

/** Every transition a membership can make; anything else is a 409 INVALID_TRANSITION. Who may trigger each one is decided by the service. */
export const MEMBERSHIP_TRANSITIONS: Readonly<Record<MembershipStatus, readonly MembershipStatus[]>> = {
  PENDING_WALLET_VERIFICATION: ["INVITED", "REVOKED"],
  INVITED: ["ACTIVE", "PENDING_DOCUMENTS", "REJECTED", "REVOKED"],
  PENDING_DOCUMENTS: ["UNDER_REVIEW", "REJECTED", "REVOKED"],
  UNDER_REVIEW: ["ACTIVE", "CHANGES_REQUIRED", "REJECTED", "REVOKED"],
  CHANGES_REQUIRED: ["UNDER_REVIEW", "REJECTED", "REVOKED"],
  ACTIVE: ["REMOVAL_REQUESTED", "REVOKED"],
  REMOVAL_REQUESTED: ["ACTIVE", "REVOKED"],
  REJECTED: [],
  REVOKED: [],
};

/** Only an ACTIVE membership grants permissions. Roles that need the member's own verification before they are ACTIVE. */
export const REVIEWED_ROLES = ["ADMIN", "MANAGER"] as const;

/** The one permission matrix, shared by the API and the web app. The server is authoritative. */
export const ROLE_PERMISSIONS: Readonly<Record<MembershipRole, readonly OrganizationPermission[]>> = {
  OWNER: ["org.read", "org.edit", "payout.manage", "members.manage", "members.manage_admins", "analytics.read", "baskets.manage", "earnings.read"],
  ADMIN: ["org.read", "members.manage", "analytics.read", "baskets.manage", "earnings.read"],
  MANAGER: ["org.read", "analytics.read", "baskets.manage"],
  ANALYST: ["org.read", "analytics.read"],
  VIEWER: ["org.read"],
};

// ---------------------------------------------------------------------------------------------------------------------
// Custom roles (ADR-019)
// ---------------------------------------------------------------------------------------------------------------------

/** Never part of a custom role: they stay with the OWNER (custody, payout and admin control). */
export const OWNER_ONLY_PERMISSIONS: readonly OrganizationPermission[] = ["org.edit", "payout.manage", "members.manage_admins"];
/** Read-only permissions a custom role may add on top of any base role. */
export const GRANTABLE_READ_PERMISSIONS: readonly OrganizationPermission[] = ["analytics.read", "earnings.read"];

/** What a custom role on `base` may contain: the base role's own permissions minus owner-only ones, plus the grantable reads. */
export function allowedCustomPermissions(base: Exclude<MembershipRole, "OWNER">): OrganizationPermission[] {
  const own = ROLE_PERMISSIONS[base].filter((p) => !OWNER_ONLY_PERMISSIONS.includes(p));
  return [...new Set([...own, ...GRANTABLE_READ_PERMISSIONS])];
}

/** Problems with a proposed permission set for `base` (empty when valid). `org.read` is always required. */
export function customRoleProblems(base: Exclude<MembershipRole, "OWNER">, permissions: readonly OrganizationPermission[]): string[] {
  const allowed = allowedCustomPermissions(base);
  const problems: string[] = [];
  if (!permissions.includes("org.read")) problems.push("Every role can see the organization (org.read).");
  for (const p of permissions) if (!allowed.includes(p)) problems.push(OWNER_ONLY_PERMISSIONS.includes(p) ? `${p} stays with the owner.` : `${p} needs a higher base role.`);
  return problems;
}

/** Permissions a membership actually holds: its custom role when it still applies (same base role, not archived), else the built-in role's. */
export function effectiveRolePermissions(role: MembershipRole, custom: { baseRole: MembershipRole; permissions: readonly string[]; archived: boolean } | null): OrganizationPermission[] {
  if (role === "OWNER" || !custom || custom.archived || custom.baseRole !== role) return [...ROLE_PERMISSIONS[role]];
  const allowed = allowedCustomPermissions(role);
  // Defence in depth: a stored set is re-filtered, so a bad row can never exceed what the rules allow.
  return custom.permissions.filter((p): p is OrganizationPermission => (allowed as string[]).includes(p));
}

const customBaseRoleSchema = z.enum(["ADMIN", "MANAGER", "ANALYST", "VIEWER"]);
const roleName = z.string().trim().min(2).max(40);
const roleDescription = z.string().trim().max(200).nullable();
const permissionSet = z.array(organizationPermissionSchema).min(1).max(20).transform((p) => [...new Set(p)]);

export const createCustomRoleRequestSchema = z.strictObject({ name: roleName, description: roleDescription.optional(), baseRole: customBaseRoleSchema, permissions: permissionSet })
  .superRefine((v, ctx) => { for (const message of customRoleProblems(v.baseRole, v.permissions)) ctx.addIssue({ code: "custom", path: ["permissions"], message }); });
export type CreateCustomRoleRequest = z.infer<typeof createCustomRoleRequestSchema>;
/** The base role can't change (members hold it); permissions are re-checked against it server-side. */
export const updateCustomRoleRequestSchema = z.strictObject({ name: roleName.optional(), description: roleDescription.optional(), permissions: permissionSet.optional() });
export type UpdateCustomRoleRequest = z.infer<typeof updateCustomRoleRequestSchema>;
export const assignCustomRoleRequestSchema = z.strictObject({ customRoleId: z.uuid().nullable() });
export type AssignCustomRoleRequest = z.infer<typeof assignCustomRoleRequestSchema>;

export const customRoleViewSchema = z.object({
  id: z.uuid(), name: z.string(), description: z.string().nullable(), baseRole: customBaseRoleSchema, permissions: z.array(organizationPermissionSchema),
  /** Active members currently holding it (whether or not it applies to them right now). */
  memberCount: z.number().int(), createdAt: z.string(), updatedAt: z.string(),
});
export type CustomRoleView = z.infer<typeof customRoleViewSchema>;
export const listRolesResponseSchema = z.object({
  builtIn: z.array(z.object({ role: membershipRoleSchema, permissions: z.array(organizationPermissionSchema) })),
  custom: z.array(customRoleViewSchema),
});
export type ListRolesResponse = z.infer<typeof listRolesResponseSchema>;

const INVITABLE_ROLES = ["ADMIN", "MANAGER", "ANALYST", "VIEWER"] as const;
const invitableRoleSchema = z.enum(INVITABLE_ROLES);

export const inviteMemberRequestSchema = z.strictObject({
  walletChain: signInChainSchema,
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
  /** The custom role linked to this membership and whether it currently applies (it doesn't after a base role change). */
  customRole: z.object({ id: z.uuid(), name: z.string(), applies: z.boolean() }).nullable().default(null),
  /** What this member can actually do in the organization. */
  permissions: z.array(organizationPermissionSchema).default([]),
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

import createHttpError from "http-errors";
import { and, eq, gt, inArray, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { logger } from "@repo/logger";
import {
  contacts, db, isUniqueViolation, memberVerifications, membershipEvents, organizationMemberships, organizations, type DbOrTx, type Tx,
} from "@repo/db";
import {
  MEMBERSHIP_TRANSITIONS, REVIEWED_ROLES, ROLE_PERMISSIONS, familyOf,
  type Chain, type ChangeRoleRequest, type InviteMemberRequest, type ListInvitationsResponse, type ListMembersResponse, type MembershipProfileRequest, type MembershipStatus,
  type MyMembership, type OrganizationPermission, type VerificationMethod,
} from "@repo/validator";
import { consume, limits } from "../middleware/rate-limit";
import { sendMembershipEmail, type MembershipEmailKind } from "../providers/resend";
import { endIneligibleAssignments, notifyReassignmentRequired } from "./baskets";
import { writeAudit } from "./audit";
import type { OrganizationRow, OwnerCtx } from "./organizations";
import { canonicalizeAddress, findAddressOwner } from "./wallets";

export type MembershipRow = typeof organizationMemberships.$inferSelect;
type EventKind = typeof membershipEvents.$inferInsert.kind;

const INVITE_OPEN: MembershipStatus[] = ["PENDING_WALLET_VERIFICATION", "INVITED"];
const TERMINAL: MembershipStatus[] = ["REJECTED", "REVOKED"];
const WITHDRAWABLE: MembershipStatus[] = ["PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED"];
const DECLINABLE: MembershipStatus[] = ["INVITED", "PENDING_DOCUMENTS", "CHANGES_REQUIRED"];

export const notFound = () => createHttpError("Organization not found", { code: "NOT_FOUND" });
const memberNotFound = () => createHttpError("Membership not found", { code: "NOT_FOUND" });
const forbidden = () => createHttpError("You don't have access to this organization.", { code: "FORBIDDEN" });
const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });
const ownerImmovable = () => invalid("Contact support to transfer ownership first.");
const iso = (d: Date | null) => d?.toISOString() ?? null;
export const orgDisplayName = sql<string | null>`(select v.public_profile->>'displayName' from app.organization_versions v where v.id = ${organizations.currentVersionId})`;

/**
 * Guard for every organization route: 404 for an unknown organization, 403 unless the user holds an ACTIVE membership whose role grants `permission`.
 * `lock` takes the organization row FOR UPDATE (use inside a transaction): every member-management writer takes it before locking membership rows.
 */
export async function requirePermission(conn: DbOrTx, userId: string, orgId: string, permission: OrganizationPermission, lock = false): Promise<{ org: OrganizationRow; membership: MembershipRow }> {
  const query = conn.select().from(organizations).where(eq(organizations.id, orgId));
  const [org] = await (lock ? query.for("update") : query);
  if (!org) throw notFound();
  const [membership] = await conn.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.userId, userId), eq(organizationMemberships.status, "ACTIVE"),
  ));
  if (!membership || !ROLE_PERMISSIONS[membership.role].includes(permission)) throw forbidden();
  return { org, membership };
}

const lockMembership = async (tx: Tx, mid: string, scope: SQL): Promise<MembershipRow> => {
  const [m] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, mid), scope)).for("update");
  if (!m) throw memberNotFound();
  return m;
};

/** Who may touch whom: only the OWNER touches an ADMIN; nobody changes the OWNER (403 for others, 409 for the OWNER: ownership moves through support). */
const guardRoles = (actor: MembershipRow, ...roles: MembershipRow["role"][]) => {
  if (roles.includes("OWNER")) throw actor.role === "OWNER" ? ownerImmovable() : forbidden();
  if (roles.includes("ADMIN") && !ROLE_PERMISSIONS[actor.role].includes("members.manage_admins")) throw forbidden();
};

const isReviewed = (role: MembershipRow["role"]) => (REVIEWED_ROLES as readonly string[]).includes(role);

/** Only an approval of this very membership counts: a past membership's approval (leave, re-invite) does not carry over. */
export async function hasApprovedVerification(conn: DbOrTx, membershipId: string): Promise<boolean> {
  const [v] = await conn.select({ id: memberVerifications.id }).from(memberVerifications)
    .where(and(eq(memberVerifications.membershipId, membershipId), eq(memberVerifications.status, "approved"))).limit(1);
  return v !== undefined;
}

/** Closes the membership's open verification without an approval (role downgrade, withdrawal, leaving): it can never be approved later without a fresh one. */
export async function closeOpenVerification(tx: Tx, membershipId: string): Promise<void> {
  await tx.update(memberVerifications).set({ status: "rejected", decidedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(memberVerifications.membershipId, membershipId), inArray(memberVerifications.status, ["draft", "in_review", "changes_required"])));
}

/** Idempotent: a membership has at most one open verification, so an existing one is kept. */
export async function openMemberVerification(tx: Tx, membershipId: string): Promise<void> {
  await tx.insert(memberVerifications).values({ membershipId }).onConflictDoNothing();
}

interface MoveInput {
  actorType: "member" | "org" | "ops" | "system";
  actorUserId: string | null;
  sessionId?: string;
  requestId: string;
  kind: EventKind;
  action: string;
  set?: Partial<typeof organizationMemberships.$inferInsert>;
  reason?: string;
  decision?: string;
  messageToMember?: string;
  internalNote?: string;
}

/** Applies one MEMBERSHIP_TRANSITIONS edge: the status change, its event and its audit entry in the caller's transaction. The caller has locked `m`. */
export async function moveMembership(tx: Tx, m: MembershipRow, to: MembershipStatus, i: MoveInput): Promise<void> {
  if (!MEMBERSHIP_TRANSITIONS[m.status].includes(to)) throw invalid(`A membership in ${m.status} cannot move to ${to}.`);
  await tx.update(organizationMemberships).set({
    ...i.set, status: to, updatedAt: sql`now()`,
    ...(to === "ACTIVE" && !m.activatedAt ? { activatedAt: sql`now()` } : {}),
    ...(to === "REVOKED" && m.activatedAt ? { leftAt: sql`now()` } : {}),
  }).where(eq(organizationMemberships.id, m.id));
  if (TERMINAL.includes(to)) await closeOpenVerification(tx, m.id);
  await tx.insert(membershipEvents).values({
    membershipId: m.id, organizationId: m.organizationId, actorType: i.actorType, actorUserId: i.actorUserId, kind: i.kind, fromStatus: m.status, toStatus: to,
    fromRole: m.role, toRole: i.set?.role ?? m.role, decision: i.decision, messageToMember: i.messageToMember, internalNote: i.internalNote, reason: i.reason, requestId: i.requestId,
  });
  await writeAudit(tx, {
    actorType: i.actorUserId ? "user" : "system", actorUserId: i.actorUserId, action: i.action, entityType: "organization_membership", entityId: m.id,
    requestId: i.requestId, sessionId: i.sessionId, metadata: { organizationId: m.organizationId, from: m.status, to },
  });
  await endIneligibleAssignments(tx, m.id, i.requestId, i.actorUserId);
}

/** Moves open invites matching `scope` whose 14 days ran out to REVOKED (event `expired`). Returns how many. No job: every read or accept of an invite calls this first. */
export async function expireInvites(tx: Tx, scope: SQL, requestId: string): Promise<number> {
  const due = await tx.select().from(organizationMemberships)
    .where(and(inArray(organizationMemberships.status, INVITE_OPEN), lte(organizationMemberships.inviteExpiresAt, sql`now()`), scope)).for("update");
  for (const m of due) await moveMembership(tx, m, "REVOKED", { actorType: "system", actorUserId: null, requestId, kind: "expired", action: "membership.invite_expired" });
  return due.length;
}

/** Emails a user's verified email contact (or a given address); with none the notice is skipped (logged). Never throws: a committed change is not undone by a notice problem. */
export async function notifyMember(kind: MembershipEmailKind, to: { userId: string } | { email: string }, data: { orgId: string; role?: string; message?: string | null }, idempotencyKey: string): Promise<void> {
  try {
    const email = "email" in to ? to.email : (await db.select({ value: contacts.value }).from(contacts)
      .where(and(eq(contacts.userId, to.userId), eq(contacts.type, "email"), eq(contacts.status, "verified"))))[0]?.value;
    if (!email) {
      logger.info("membership email skipped: no verified email", { kind });
      return;
    }
    const [org] = await db.select({ name: orgDisplayName }).from(organizations).where(eq(organizations.id, data.orgId));
    await sendMembershipEmail(kind, email, { organizationName: org?.name, role: data.role, message: data.message }, idempotencyKey);
  } catch (err) {
    logger.warn("membership email failed", { kind, error: err instanceof Error ? err.name : "unknown" });
  }
}

export const myMembershipView = (m: MembershipRow): MyMembership => ({
  id: m.id, organizationId: m.organizationId, role: m.role, requestedRole: m.requestedRole, status: m.status,
  publicDisplayName: m.publicDisplayName, publicTitle: m.publicTitle,
});

export async function listMembers(ctx: OwnerCtx, orgId: string): Promise<ListMembersResponse> {
  const { membership } = await requirePermission(db, ctx.userId, orgId, "org.read");
  const canManage = ROLE_PERMISSIONS[membership.role].includes("members.manage");
  await db.transaction((tx) => expireInvites(tx, eq(organizationMemberships.organizationId, orgId), ctx.meta.requestId));
  const rows = await db.select({
    m: organizationMemberships,
    verificationStatus: sql<ListMembersResponse["members"][number]["verificationStatus"]>`(select v.status from app.member_verifications v where v.membership_id = "app"."organization_memberships"."id" order by v.created_at desc, v.id desc limit 1)`, // drizzle leaves a column of a single-table select unqualified
  }).from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, orgId), notInArray(organizationMemberships.status, TERMINAL)))
    .orderBy(organizationMemberships.joinedAt, organizationMemberships.id);
  return {
    members: rows.map(({ m, verificationStatus }) => ({
      id: m.id, role: m.role, requestedRole: m.requestedRole, status: m.status, publicDisplayName: m.publicDisplayName, publicTitle: m.publicTitle,
      isSelf: m.userId === ctx.userId, activatedAt: iso(m.activatedAt), inviteExpiresAt: iso(m.inviteExpiresAt),
      invitedWallet: canManage && m.invitedWalletChain && m.invitedWalletAddress ? { chain: m.invitedWalletChain, address: m.invitedWalletAddress } : null,
      invitedEmail: canManage ? m.invitedEmail : null, verificationStatus: canManage ? verificationStatus : null,
    })),
  };
}

export async function inviteMember(ctx: OwnerCtx, orgId: string, body: InviteMemberRequest): Promise<ListMembersResponse> {
  const address = canonicalizeAddress(body.walletChain, body.walletAddress);
  const mid = await db.transaction(async (tx) => {
    const { org } = await requirePermission(tx, ctx.userId, orgId, body.role === "ADMIN" ? "members.manage_admins" : "members.manage", true);
    if (org.status !== "VERIFIED") throw invalid("Your organization must be verified before inviting members.");
    // A typed address never links anyone by itself: only a wallet already proven by an active user makes the invite INVITED.
    const known = await findAddressOwner(tx, body.walletChain, address);
    const userId = known?.status === "active" && known.userStatus === "active" ? known.userId : null;
    const to = userId ? "INVITED" : "PENDING_WALLET_VERIFICATION";
    const [m] = await tx.insert(organizationMemberships).values({
      organizationId: orgId, userId, role: body.role, status: to, invitedWalletChain: body.walletChain, invitedWalletFamily: familyOf(body.walletChain), invitedWalletAddress: address,
      invitedEmail: body.email, invitedByUserId: ctx.userId, inviteExpiresAt: sql`now() + interval '14 days'`,
    }).returning({ id: organizationMemberships.id });
    await tx.insert(membershipEvents).values({
      membershipId: m!.id, organizationId: orgId, actorType: "org", actorUserId: ctx.userId, kind: "invited", fromStatus: null, toStatus: to, toRole: body.role, requestId: ctx.meta.requestId,
    });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "membership.invited", entityType: "organization_membership", entityId: m!.id, requestId: ctx.meta.requestId,
      sessionId: ctx.sessionId, metadata: { organizationId: orgId, role: body.role, chain: body.walletChain, address },
    });
    // Only an invite that was actually created uses the 20/h budget (a rejected one, or an outsider's, never does).
    await consume(limits.inviteOrg, orgId);
    return m!.id;
  }).catch((err: unknown) => {
    if (isUniqueViolation(err, "organization_memberships_one_open_invite") || isUniqueViolation(err, "organization_memberships_one_open")) {
      throw createHttpError("This wallet already has an open invitation or membership.", { code: "INVITE_EXISTS" });
    }
    throw err;
  });
  await notifyMember("invited", { email: body.email }, { orgId, role: body.role }, `membership-invited/${mid}`);
  return listMembers(ctx, orgId);
}

export async function cancelInvite(ctx: OwnerCtx, orgId: string, mid: string): Promise<ListMembersResponse> {
  await db.transaction(async (tx) => {
    const { membership: actor } = await requirePermission(tx, ctx.userId, orgId, "members.manage", true);
    const m = await lockMembership(tx, mid, eq(organizationMemberships.organizationId, orgId));
    guardRoles(actor, m.role);
    if (!INVITE_OPEN.includes(m.status)) throw invalid(`A membership in ${m.status} cannot be cancelled.`);
    await moveMembership(tx, m, "REVOKED", { actorType: "org", actorUserId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, kind: "cancelled", action: "membership.invite_cancelled" });
  });
  return listMembers(ctx, orgId);
}

export async function changeRole(ctx: OwnerCtx, orgId: string, mid: string, body: ChangeRoleRequest): Promise<ListMembersResponse> {
  await db.transaction(async (tx) => {
    const { membership: actor } = await requirePermission(tx, ctx.userId, orgId, "members.manage", true);
    const m = await lockMembership(tx, mid, eq(organizationMemberships.organizationId, orgId));
    guardRoles(actor, m.role, m.requestedRole ?? m.role, body.role); // a pending ADMIN promotion is an ADMIN change in flight
    if (m.status !== "ACTIVE") throw invalid("Only an active member's role can be changed.");
    if (m.role === body.role) throw invalid("The member already has this role.");
    // Moving into a reviewed role needs the member's own approved verification first; until ops approve it the current role's permissions apply.
    const upgrade = isReviewed(body.role) && !isReviewed(m.role)
      && !(await hasApprovedVerification(tx, m.id));
    await tx.update(organizationMemberships).set(
      upgrade ? { requestedRole: body.role, updatedAt: sql`now()` } : { role: body.role, requestedRole: null, updatedAt: sql`now()` },
    ).where(eq(organizationMemberships.id, m.id));
    if (upgrade) await openMemberVerification(tx, m.id);
    else await closeOpenVerification(tx, m.id);
    await endIneligibleAssignments(tx, m.id, ctx.meta.requestId, ctx.userId);
    await tx.insert(membershipEvents).values({
      membershipId: m.id, organizationId: orgId, actorType: "org", actorUserId: ctx.userId, kind: upgrade ? "role_requested" : "role_changed",
      fromStatus: m.status, toStatus: m.status, fromRole: m.role, toRole: body.role, requestId: ctx.meta.requestId,
    });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: upgrade ? "membership.role_requested" : "membership.role_changed", entityType: "organization_membership", entityId: m.id,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { organizationId: orgId, from: m.role, to: body.role },
    });
  });
  await notifyReassignmentRequired(ctx.meta.requestId);
  return listMembers(ctx, orgId);
}

/**
 * OWNER removes anyone (except the OWNER); an ADMIN removes non-admins and can only request the removal of another ADMIN.
 * A pending membership (documents, review, changes required) is withdrawn the same way; its open verification is closed. Nobody removes themselves: that is leaving.
 */
export async function removeMember(ctx: OwnerCtx, orgId: string, mid: string): Promise<ListMembersResponse> {
  const removed = await db.transaction(async (tx) => {
    const { membership: actor } = await requirePermission(tx, ctx.userId, orgId, "members.manage", true);
    const m = await lockMembership(tx, mid, eq(organizationMemberships.organizationId, orgId));
    if (m.role === "OWNER") guardRoles(actor, "OWNER");
    if (m.userId === ctx.userId) throw invalid("Use Leave organization.");
    if (m.status !== "ACTIVE" && !WITHDRAWABLE.includes(m.status)) throw invalid("Only an active or pending member can be removed.");
    const request = m.status === "ACTIVE" && m.role === "ADMIN" && !ROLE_PERMISSIONS[actor.role].includes("members.manage_admins");
    if (!request) guardRoles(actor, m.role, m.requestedRole ?? m.role);
    await moveMembership(tx, m, request ? "REMOVAL_REQUESTED" : "REVOKED", {
      actorType: "org", actorUserId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, kind: request ? "removal_requested" : "removed",
      action: request ? "membership.removal_requested" : "membership.removed", set: request ? { removalRequestedByUserId: ctx.userId } : undefined,
    });
    return request ? null : m;
  });
  await notifyReassignmentRequired(ctx.meta.requestId);
  if (removed) await notifyMember("removed", { userId: removed.userId! }, { orgId }, `membership-removed/${removed.id}`);
  return listMembers(ctx, orgId);
}

/** The OWNER answers an ADMIN's removal request: confirm revokes, cancel restores the member. */
export async function decideRemoval(ctx: OwnerCtx, orgId: string, mid: string, decision: "confirm" | "cancel"): Promise<ListMembersResponse> {
  const revoked = await db.transaction(async (tx) => {
    await requirePermission(tx, ctx.userId, orgId, "members.manage_admins", true);
    const m = await lockMembership(tx, mid, eq(organizationMemberships.organizationId, orgId));
    if (m.status !== "REMOVAL_REQUESTED") throw invalid("There is no removal request for this member.");
    const confirm = decision === "confirm";
    await moveMembership(tx, m, confirm ? "REVOKED" : "ACTIVE", {
      actorType: "org", actorUserId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, kind: confirm ? "removed" : "removal_cancelled",
      action: confirm ? "membership.removed" : "membership.removal_cancelled", set: confirm ? undefined : { removalRequestedByUserId: null },
    });
    return confirm ? m : null;
  });
  await notifyReassignmentRequired(ctx.meta.requestId);
  if (revoked) await notifyMember("removed", { userId: revoked.userId! }, { orgId }, `membership-removed/${revoked.id}`);
  return listMembers(ctx, orgId);
}

export async function listMyInvitations(ctx: OwnerCtx): Promise<ListInvitationsResponse> {
  await db.transaction((tx) => expireInvites(tx, eq(organizationMemberships.userId, ctx.userId), ctx.meta.requestId));
  const rows = await db.select({ id: organizationMemberships.id, orgId: organizations.id, name: orgDisplayName, role: organizationMemberships.role, expiresAt: organizationMemberships.inviteExpiresAt })
    .from(organizationMemberships).innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, ctx.userId), eq(organizationMemberships.status, "INVITED"), gt(organizationMemberships.inviteExpiresAt, sql`now()`)))
    .orderBy(organizationMemberships.joinedAt, organizationMemberships.id);
  return { invitations: rows.map((r) => ({ membershipId: r.id, organization: { id: r.orgId, displayName: r.name }, role: r.role, expiresAt: r.expiresAt!.toISOString() })) };
}

export async function acceptInvitation(ctx: OwnerCtx, mid: string): Promise<MyMembership> {
  const done = await db.transaction(async (tx) => {
    const m = await lockMembership(tx, mid, eq(organizationMemberships.userId, ctx.userId));
    if (await expireInvites(tx, eq(organizationMemberships.id, mid), ctx.meta.requestId) > 0) return null;
    if (m.status !== "INVITED") throw invalid(`A membership in ${m.status} cannot be accepted.`);
    const pending = isReviewed(m.role); // a new invitation is a new membership: earlier approvals do not carry over
    if (pending) await openMemberVerification(tx, m.id);
    await moveMembership(tx, m, pending ? "PENDING_DOCUMENTS" : "ACTIVE", {
      actorType: "member", actorUserId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, kind: "accepted", action: "membership.accepted",
    });
    return m;
  });
  if (!done) throw invalid("This invitation has expired.");
  if (done.invitedByUserId) await notifyMember("accepted", { userId: done.invitedByUserId }, { orgId: done.organizationId, role: done.role }, `membership-accepted/${done.id}`);
  return myMembershipView((await db.select().from(organizationMemberships).where(eq(organizationMemberships.id, mid)))[0]!);
}

export async function declineInvitation(ctx: OwnerCtx, mid: string): Promise<MyMembership> {
  await db.transaction(async (tx) => {
    const m = await lockMembership(tx, mid, eq(organizationMemberships.userId, ctx.userId));
    if (!DECLINABLE.includes(m.status)) throw invalid(`A membership in ${m.status} cannot be declined.`);
    await moveMembership(tx, m, "REJECTED", { actorType: "member", actorUserId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, kind: "declined", action: "membership.declined" });
  });
  return myMembershipView((await db.select().from(organizationMemberships).where(eq(organizationMemberships.id, mid)))[0]!);
}

export async function leaveOrganization(ctx: OwnerCtx, mid: string): Promise<MyMembership> {
  await db.transaction(async (tx) => {
    const m = await lockMembership(tx, mid, eq(organizationMemberships.userId, ctx.userId));
    if (m.role === "OWNER") throw ownerImmovable();
    if (m.status !== "ACTIVE" && m.status !== "REMOVAL_REQUESTED") throw invalid("Only an active member can leave.");
    await moveMembership(tx, m, "REVOKED", { actorType: "member", actorUserId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, kind: "left", action: "membership.left" });
  });
  await notifyReassignmentRequired(ctx.meta.requestId);
  return myMembershipView((await db.select().from(organizationMemberships).where(eq(organizationMemberships.id, mid)))[0]!);
}

/** The public name and title are opt-in; they show on the public profile once the membership is ACTIVE. `null` clears a value. */
export async function updateMembershipProfile(ctx: OwnerCtx, mid: string, body: MembershipProfileRequest): Promise<MyMembership> {
  return db.transaction(async (tx) => {
    const m = await lockMembership(tx, mid, eq(organizationMemberships.userId, ctx.userId));
    if (TERMINAL.includes(m.status)) throw invalid("This membership has ended.");
    const [updated] = await tx.update(organizationMemberships).set({
      ...(body.publicDisplayName !== undefined ? { publicDisplayName: body.publicDisplayName } : {}),
      ...(body.publicTitle !== undefined ? { publicTitle: body.publicTitle } : {}),
      updatedAt: sql`now()`,
    }).where(eq(organizationMemberships.id, m.id)).returning();
    await tx.insert(membershipEvents).values({
      membershipId: m.id, organizationId: m.organizationId, actorType: "member", actorUserId: ctx.userId, kind: "profile_updated", fromStatus: m.status, toStatus: m.status,
      fromRole: m.role, toRole: m.role, requestId: ctx.meta.requestId,
    });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "membership.profile_updated", entityType: "organization_membership", entityId: m.id,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { organizationId: m.organizationId },
    });
    return myMembershipView(updated!);
  });
}

/** Links open invites for a wallet the user just proved. Runs inside the Spec 1 finalize transaction. */
export async function linkInvitesIfProven(tx: Tx, i: { userId: string; chain: Chain; address: string; method: VerificationMethod; requestId: string }): Promise<void> {
  const invites = await tx.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.status, "PENDING_WALLET_VERIFICATION"),
    eq(organizationMemberships.invitedWalletFamily, familyOf(i.chain)),
    eq(organizationMemberships.invitedWalletAddress, i.address),
    gt(organizationMemberships.inviteExpiresAt, sql`now()`),
    i.method === "erc1271" || i.method === "erc6492" ? eq(organizationMemberships.invitedWalletChain, i.chain) : sql`true`,
  )).orderBy(organizationMemberships.id).for("update");
  for (const m of invites) {
    // A savepoint per invite: an invite for this organization created concurrently for the same user (a unique conflict) rolls back only this one and leaves it
    // pending for the next sign-in, instead of failing the whole sign-in.
    try {
      await tx.transaction(async (sp) => {
        const [open] = await sp.select({ id: organizationMemberships.id }).from(organizationMemberships).where(and(
          eq(organizationMemberships.organizationId, m.organizationId), eq(organizationMemberships.userId, i.userId),
          notInArray(organizationMemberships.status, ["REJECTED", "REVOKED"])));
        const to = open ? "REVOKED" : "INVITED";
        await sp.update(organizationMemberships).set({ status: to, userId: open ? null : i.userId, updatedAt: sql`now()` }).where(eq(organizationMemberships.id, m.id));
        await sp.insert(membershipEvents).values({ membershipId: m.id, organizationId: m.organizationId, actorType: "system", kind: open ? "cancelled" : "linked", fromStatus: m.status, toStatus: to, reason: open ? "duplicate" : null, requestId: i.requestId });
        await writeAudit(sp, { actorType: "system", action: open ? "membership.invite_revoked" : "membership.linked", entityType: "organization_membership", entityId: m.id, requestId: i.requestId, metadata: { userId: i.userId } });
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      logger.warn("invite link skipped: a conflicting membership was created concurrently", { membershipId: m.id });
    }
  }
}

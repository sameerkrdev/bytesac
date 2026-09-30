import createHttpError from "http-errors";
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  db, investmentWallets, memberVerificationDocuments, memberVerifications, membershipEvents, organizationDocuments, organizationMemberships, organizations, walletAddresses,
  type DbOrTx,
} from "@repo/db";
import {
  type DecideMemberVerificationRequest, type DocumentView, type ListMemberReviewQuery, type ListMemberReviewResponse, type MemberReviewDetail, type MemberVerificationStatus, type MemberVerificationView,
  type MembershipStatus, type PresignDocumentRequest, type PresignDocumentResponse, type TransferOwnershipRequest, type UpdateMemberVerificationRequest,
} from "@repo/validator";
import { consume, limits } from "../middleware/rate-limit";
import { cursorSchema, type OpsCtx } from "./applications";
import { writeAudit } from "./audit";
import { hasApprovedVerification, moveMembership, notifyMember, orgDisplayName } from "./members";
import { PAGE_SIZE, assertNotMember, downloadUrl } from "./organization-review";
import { mergeDetails, missingFromTemplate, presignUpload, resolveTemplate, storeUpload, type OwnerCtx } from "./organizations";

const EDITABLE = ["draft", "changes_required"] as const;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const notFound = () => createHttpError("Membership not found", { code: "NOT_FOUND" });
const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });

/** The member's template: the `member` subject with the organization's jurisdiction. */
async function memberTemplate(conn: DbOrTx, orgId: string) {
  const [org] = await conn.select({ jurisdiction: organizations.jurisdiction }).from(organizations).where(eq(organizations.id, orgId));
  return resolveTemplate(conn, "member", org!.jurisdiction);
}

/** Active (not unlinked) documents of a verification, as metadata: the storage key is never selected. */
async function verificationDocuments(conn: DbOrTx, verificationId: string): Promise<DocumentView[]> {
  const rows = await conn.select({
    id: organizationDocuments.id, documentType: organizationDocuments.documentType, contentType: organizationDocuments.contentType,
    sizeBytes: organizationDocuments.sizeBytes, status: organizationDocuments.status, uploadedAt: organizationDocuments.uploadedAt,
  }).from(memberVerificationDocuments)
    .innerJoin(organizationDocuments, eq(organizationDocuments.id, memberVerificationDocuments.documentId))
    .where(and(eq(memberVerificationDocuments.verificationId, verificationId), isNull(memberVerificationDocuments.removedAt)))
    .orderBy(organizationDocuments.createdAt, organizationDocuments.id);
  return rows.map((r) => ({ ...r, uploadedAt: iso(r.uploadedAt) }));
}

const latestVerification = async (conn: DbOrTx, membershipId: string) => (await conn.select().from(memberVerifications)
  .where(eq(memberVerifications.membershipId, membershipId)).orderBy(desc(memberVerifications.createdAt), desc(memberVerifications.id)).limit(1))[0];

/**
 * The caller's own membership and its verification while the member may still change it (draft or changes_required). 404 for anyone else's membership;
 * `lock` takes both rows FOR UPDATE (inside a transaction).
 */
async function lockEditableVerification(conn: DbOrTx, ctx: OwnerCtx, mid: string, lock = false) {
  const mq = conn.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, mid), eq(organizationMemberships.userId, ctx.userId)));
  const [m] = await (lock ? mq.for("update") : mq);
  if (!m) throw notFound();
  const vq = conn.select().from(memberVerifications).where(and(eq(memberVerifications.membershipId, mid), inArray(memberVerifications.status, [...EDITABLE])));
  const [v] = await (lock ? vq.for("update") : vq);
  if (!v || !["PENDING_DOCUMENTS", "CHANGES_REQUIRED", "ACTIVE"].includes(m.status)) throw invalid("This verification can't be edited right now.");
  return { m, v };
}

export async function getMemberVerification(ctx: OwnerCtx, mid: string): Promise<MemberVerificationView> {
  const [m] = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, mid), eq(organizationMemberships.userId, ctx.userId)));
  const v = m && await latestVerification(db, m.id);
  if (!m || !v) throw notFound();
  const [org] = await db.select({ name: orgDisplayName }).from(organizations).where(eq(organizations.id, m.organizationId));
  const template = await memberTemplate(db, m.organizationId);
  const documents = await verificationDocuments(db, v.id);
  const [message] = await db.select({ message: membershipEvents.messageToMember }).from(membershipEvents)
    .where(and(eq(membershipEvents.membershipId, m.id), isNotNull(membershipEvents.messageToMember))).orderBy(desc(membershipEvents.createdAt), desc(membershipEvents.id)).limit(1);
  return {
    membershipId: m.id, membershipStatus: m.status, role: m.role, requestedRole: m.requestedRole, organization: { id: m.organizationId, displayName: org?.name ?? null },
    status: v.status, details: v.details, documents, template: { requiredFields: template.requiredFields, requiredDocuments: template.requiredDocuments },
    missing: missingFromTemplate(template, v.details, new Set(documents.filter((d) => d.status === "uploaded").map((d) => d.documentType))),
    submittedAt: iso(v.submittedAt), latestMessageToMember: message?.message ?? null,
  };
}

export async function updateMemberVerification(ctx: OwnerCtx, mid: string, body: UpdateMemberVerificationRequest): Promise<MemberVerificationView> {
  await db.transaction(async (tx) => {
    const { m, v } = await lockEditableVerification(tx, ctx, mid, true);
    const template = await memberTemplate(tx, m.organizationId);
    const unknown = Object.keys(body.details).filter((key) => !template.requiredFields.includes(key));
    if (unknown.length > 0) throw createHttpError("These fields are not part of the member verification.", { code: "VALIDATION_FAILED", details: { fields: unknown } });
    await tx.update(memberVerifications).set({ details: mergeDetails(v.details, body.details), updatedAt: sql`now()` }).where(eq(memberVerifications.id, v.id));
  });
  return getMemberVerification(ctx, mid);
}

export async function presignMemberDocument(ctx: OwnerCtx, mid: string, body: PresignDocumentRequest): Promise<PresignDocumentResponse> {
  const { m } = await lockEditableVerification(db, ctx, mid);
  await consume(limits.memberDocumentPresign, mid);
  return presignUpload({ organizationId: m.organizationId, membershipId: mid, key: (documentId) => `incoming/members/${mid}/${documentId}`, userId: ctx.userId, body });
}

export async function confirmMemberDocument(ctx: OwnerCtx, mid: string, docId: string): Promise<MemberVerificationView> {
  await lockEditableVerification(db, ctx, mid);
  const [doc] = await db.select().from(organizationDocuments).where(and(eq(organizationDocuments.id, docId), eq(organizationDocuments.membershipId, mid)));
  if (!doc) throw createHttpError("Document not found", { code: "NOT_FOUND" });
  if (doc.status !== "pending_upload") throw invalid("This document was already processed.");
  await storeUpload(doc, `documents/members/${mid}/${doc.id}`, async (tx) => {
    const { v } = await lockEditableVerification(tx, ctx, mid, true);
    // A new document replaces the verification's link of the same type.
    await tx.update(memberVerificationDocuments).set({ removedAt: sql`now()` }).where(and(
      eq(memberVerificationDocuments.verificationId, v.id), isNull(memberVerificationDocuments.removedAt),
      inArray(memberVerificationDocuments.documentId, tx.select({ id: organizationDocuments.id }).from(organizationDocuments)
        .where(and(eq(organizationDocuments.membershipId, mid), eq(organizationDocuments.documentType, doc.documentType)))),
    ));
    await tx.insert(memberVerificationDocuments).values({ verificationId: v.id, documentId: doc.id });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "member_document.uploaded", entityType: "organization_document", entityId: doc.id,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { membershipId: mid, documentType: doc.documentType },
    });
  });
  return getMemberVerification(ctx, mid);
}

/** Unlinks the document from the editable verification only; the document row and object stay. */
export async function unlinkMemberDocument(ctx: OwnerCtx, mid: string, docId: string): Promise<MemberVerificationView> {
  await db.transaction(async (tx) => {
    const { v } = await lockEditableVerification(tx, ctx, mid, true);
    const [unlinked] = await tx.update(memberVerificationDocuments).set({ removedAt: sql`now()` }).where(and(
      eq(memberVerificationDocuments.verificationId, v.id), eq(memberVerificationDocuments.documentId, docId), isNull(memberVerificationDocuments.removedAt),
    )).returning({ id: memberVerificationDocuments.id });
    if (!unlinked) throw createHttpError("Document not found", { code: "NOT_FOUND" });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "member_document.unlinked", entityType: "organization_document", entityId: docId,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { membershipId: mid },
    });
  });
  return getMemberVerification(ctx, mid);
}

/** PENDING_DOCUMENTS or CHANGES_REQUIRED -> UNDER_REVIEW. A role upgrade (ACTIVE with a requested role) stays ACTIVE and keeps its current permissions. */
export async function submitMemberVerification(ctx: OwnerCtx, mid: string): Promise<MemberVerificationView> {
  await db.transaction(async (tx) => {
    const { m, v } = await lockEditableVerification(tx, ctx, mid, true);
    if (m.status === "ACTIVE" && !m.requestedRole) throw invalid("There is no role upgrade awaiting verification.");
    const template = await memberTemplate(tx, m.organizationId);
    const uploaded = new Set((await verificationDocuments(tx, v.id)).filter((d) => d.status === "uploaded").map((d) => d.documentType));
    const missing = missingFromTemplate(template, v.details, uploaded);
    if (missing.fields.length > 0 || missing.documents.length > 0) {
      throw createHttpError(422, "Complete the missing items before submitting.", { code: "REQUIREMENTS_INCOMPLETE", details: { missing } });
    }
    await tx.update(memberVerifications).set({ status: "in_review", submittedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(memberVerifications.id, v.id));
    if (m.status === "ACTIVE") {
      await tx.insert(membershipEvents).values({
        membershipId: m.id, organizationId: m.organizationId, actorType: "member", actorUserId: ctx.userId, kind: "verification_submitted", fromStatus: m.status, toStatus: m.status,
        fromRole: m.role, toRole: m.role, requestId: ctx.meta.requestId,
      });
      await writeAudit(tx, {
        actorType: "user", actorUserId: ctx.userId, action: "membership.verification_submitted", entityType: "organization_membership", entityId: m.id,
        requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { organizationId: m.organizationId },
      });
    } else {
      await moveMembership(tx, m, "UNDER_REVIEW", {
        actorType: "member", actorUserId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, kind: "verification_submitted", action: "membership.verification_submitted",
      });
    }
  });
  return getMemberVerification(ctx, mid);
}

// ---------------------------------------------------------------------------------------------------------------------
// Ops review
// ---------------------------------------------------------------------------------------------------------------------

const latestStatus = sql<MemberVerificationStatus | null>`(select v.status from app.member_verifications v where v.membership_id = ${organizationMemberships.id} order by v.created_at desc, v.id desc limit 1)`;

/** Default queue: memberships under review plus active members whose role upgrade is in review. */
export async function listMembersForReview(q: ListMemberReviewQuery): Promise<ListMemberReviewResponse> {
  const upgradeInReview = sql`exists (select 1 from app.member_verifications v where v.membership_id = ${organizationMemberships.id} and v.status = 'in_review')`;
  const conditions = [q.status
    ? eq(organizationMemberships.status, q.status)
    : or(eq(organizationMemberships.status, "UNDER_REVIEW"), and(eq(organizationMemberships.status, "ACTIVE"), isNotNull(organizationMemberships.requestedRole), upgradeInReview))];
  if (q.cursor) {
    const parsed = cursorSchema.safeParse(Buffer.from(q.cursor, "base64url").toString().split("|"));
    if (!parsed.success) throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    conditions.push(sql`(${organizationMemberships.updatedAt}, ${organizationMemberships.id}) < (${parsed.data[0]}::timestamptz, ${parsed.data[1]}::uuid)`);
  }
  const rows = await db.select({
    m: organizationMemberships, name: orgDisplayName, verificationStatus: latestStatus,
    submittedAt: sql<Date | null>`(select v.submitted_at from app.member_verifications v where v.membership_id = ${organizationMemberships.id} order by v.created_at desc, v.id desc limit 1)`,
    cursorTs: sql<string>`${organizationMemberships.updatedAt}::text`,
  }).from(organizationMemberships).innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(...conditions)).orderBy(desc(organizationMemberships.updatedAt), desc(organizationMemberships.id)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.m.id, organization: { id: r.m.organizationId, displayName: r.name }, publicDisplayName: r.m.publicDisplayName, role: r.m.role, requestedRole: r.m.requestedRole, status: r.m.status,
      verificationStatus: r.verificationStatus, submittedAt: r.submittedAt ? new Date(r.submittedAt).toISOString() : null, updatedAt: r.m.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(`${last.cursorTs}|${last.m.id}`).toString("base64url") : null,
  };
}

export async function getMemberForReview(mid: string): Promise<MemberReviewDetail> {
  const [row] = await db.select({ m: organizationMemberships, org: organizations, name: orgDisplayName }).from(organizationMemberships)
    .innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId)).where(eq(organizationMemberships.id, mid));
  if (!row) throw notFound();
  const { m } = row;
  const v = await latestVerification(db, m.id);
  const events = await db.select().from(membershipEvents).where(eq(membershipEvents.membershipId, mid)).orderBy(membershipEvents.createdAt, membershipEvents.id);
  const addresses = m.userId ? await db.select({ chain: walletAddresses.chain, address: walletAddresses.address }).from(walletAddresses)
    .innerJoin(investmentWallets, eq(investmentWallets.id, walletAddresses.investmentWalletId))
    .where(and(eq(investmentWallets.userId, m.userId), eq(investmentWallets.status, "active"))).orderBy(walletAddresses.createdAt) : [];
  return {
    id: m.id, organization: { id: m.organizationId, displayName: row.name, status: row.org.status }, userId: m.userId, addresses, role: m.role, requestedRole: m.requestedRole, status: m.status,
    verification: v ? { id: v.id, status: v.status, details: v.details, submittedAt: iso(v.submittedAt), documents: await verificationDocuments(db, v.id) } : null,
    events: events.map((e) => ({
      id: e.id, actorType: e.actorType, actorUserId: e.actorUserId, kind: e.kind, fromStatus: e.fromStatus, toStatus: e.toStatus, fromRole: e.fromRole, toRole: e.toRole,
      decision: e.decision, messageToMember: e.messageToMember, internalNote: e.internalNote, reason: e.reason, createdAt: e.createdAt.toISOString(),
    })),
  };
}

const DECISION_STATUS = { approved: "ACTIVE", changes_required: "CHANGES_REQUIRED", rejected: "REJECTED" } as const satisfies Record<string, MembershipStatus>;
const DECISION_EMAIL = { approved: "verification_approved", changes_required: "verification_changes_required", rejected: "verification_rejected" } as const;

/** Ops decision on the member's verification, under the membership lock. An upgrade (ACTIVE with a requested role) keeps its status: approval switches the role, rejection clears the request. */
export async function decideMemberVerification(ctx: OpsCtx, mid: string, i: DecideMemberVerificationRequest): Promise<MemberReviewDetail> {
  const { m, key } = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(organizationMemberships).where(eq(organizationMemberships.id, mid)).for("update");
    if (!m) throw notFound();
    await assertNotMember(tx, ctx.userId, m.organizationId);
    const upgrade = m.status === "ACTIVE" && m.requestedRole !== null;
    if (m.status !== "UNDER_REVIEW" && !upgrade) throw invalid(`A membership in ${m.status} is not awaiting a decision.`);
    const [v] = await tx.select().from(memberVerifications).where(and(eq(memberVerifications.membershipId, mid), eq(memberVerifications.status, "in_review"))).for("update");
    if (!v) throw invalid("There is no verification in review.");
    await tx.update(memberVerifications).set({
      status: i.decision, updatedAt: sql`now()`, ...(i.decision === "changes_required" ? {} : { decidedAt: sql`now()`, decidedByUserId: ctx.userId }),
    }).where(eq(memberVerifications.id, v.id));
    const event = { actorType: "ops", actorUserId: ctx.userId, requestId: ctx.meta.requestId, kind: "verification_decided", decision: i.decision, messageToMember: i.messageToMember, internalNote: i.internalNote } as const;
    if (upgrade) {
      const role = i.decision === "approved" ? m.requestedRole! : m.role;
      await tx.update(organizationMemberships).set({ ...(i.decision === "changes_required" ? {} : { role, requestedRole: null, decidedByUserId: ctx.userId }), updatedAt: sql`now()` })
        .where(eq(organizationMemberships.id, m.id));
      await tx.insert(membershipEvents).values({ ...event, membershipId: m.id, organizationId: m.organizationId, fromStatus: m.status, toStatus: m.status, fromRole: m.role, toRole: role });
      await writeAudit(tx, {
        actorType: "user", actorUserId: ctx.userId, action: "membership.verification_decided", entityType: "organization_membership", entityId: m.id,
        requestId: ctx.meta.requestId, metadata: { organizationId: m.organizationId, decision: i.decision },
      });
    } else {
      await moveMembership(tx, m, DECISION_STATUS[i.decision], { ...event, action: "membership.verification_decided", set: i.decision === "approved" ? { decidedByUserId: ctx.userId } : undefined });
    }
    // One email per submission and decision: a resubmission gets a new submitted_at.
    return { m, key: `member-verification/${v.id}/${i.decision}/${v.submittedAt?.getTime()}` };
  });
  await notifyMember(DECISION_EMAIL[i.decision], { userId: m.userId! }, { orgId: m.organizationId, message: i.messageToMember }, key);
  return getMemberForReview(mid);
}

/** Short-lived attachment link to a member's stored file. Reviewers who belong to the organization cannot download it. */
export async function memberDocumentDownloadUrl(ctx: OpsCtx, mid: string, docId: string): Promise<string> {
  const [m] = await db.select({ organizationId: organizationMemberships.organizationId }).from(organizationMemberships).where(eq(organizationMemberships.id, mid));
  if (!m) throw notFound();
  await assertNotMember(db, ctx.userId, m.organizationId);
  const [doc] = await db.select().from(organizationDocuments).where(and(eq(organizationDocuments.id, docId), eq(organizationDocuments.membershipId, mid), eq(organizationDocuments.status, "uploaded")));
  if (!doc) throw createHttpError("Document not found", { code: "NOT_FOUND" });
  return downloadUrl(ctx, doc, "member_document.downloaded", { organizationId: m.organizationId, membershipId: mid });
}

// ---------------------------------------------------------------------------------------------------------------------
// Ownership transfer (ops_admin only; the route enforces the role)
// ---------------------------------------------------------------------------------------------------------------------

/** The current OWNER becomes ADMIN and the target OWNER in one transaction under the organization lock; the old owner is updated first to respect the one-OWNER unique index. */
export async function transferOwnership(ctx: OpsCtx, orgId: string, i: TransferOwnershipRequest): Promise<void> {
  const notices = await db.transaction(async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId)).for("update");
    if (!org) throw createHttpError("Organization not found", { code: "NOT_FOUND" });
    await assertNotMember(tx, ctx.userId, orgId);
    const [owner] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.role, "OWNER"), eq(organizationMemberships.status, "ACTIVE"))).for("update");
    const [target] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, i.targetMembershipId), eq(organizationMemberships.organizationId, orgId))).for("update");
    if (!owner || !target || target.id === owner.id || target.status !== "ACTIVE") throw invalid("Pick an active member of this organization.");
    if (!(await hasApprovedVerification(tx, orgId, target.userId!))) throw invalid("This member must complete verification first.");
    await tx.update(organizationMemberships).set({ role: "ADMIN", updatedAt: sql`now()` }).where(eq(organizationMemberships.id, owner.id));
    await tx.update(organizationMemberships).set({ role: "OWNER", requestedRole: null, updatedAt: sql`now()` }).where(eq(organizationMemberships.id, target.id));
    const events = await tx.insert(membershipEvents).values([owner, target].map((m, n) => ({
      membershipId: m.id, organizationId: orgId, actorType: "ops" as const, actorUserId: ctx.userId, kind: "ownership_transferred" as const, fromStatus: m.status, toStatus: m.status,
      fromRole: m.role, toRole: n === 0 ? "ADMIN" as const : "OWNER" as const, reason: i.reason, requestId: ctx.meta.requestId,
    }))).returning({ id: membershipEvents.id, membershipId: membershipEvents.membershipId });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization.ownership_transferred", entityType: "organization", entityId: orgId, requestId: ctx.meta.requestId,
      metadata: { reason: i.reason, from: owner.id, to: target.id },
    });
    return [{ m: owner, role: "ADMIN" }, { m: target, role: "OWNER" }].map((n) => ({ userId: n.m.userId!, role: n.role, key: events.find((e) => e.membershipId === n.m.id)!.id }));
  });
  for (const n of notices) await notifyMember("ownership_transferred", { userId: n.userId }, { orgId, role: n.role }, `ownership-transferred/${n.key}`);
}

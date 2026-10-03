import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import createHttpError from "http-errors";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import {
  db, investmentWallets, organizationDocuments, organizationEvents, organizationMemberships, organizationPayoutWallets, organizationVersionDocuments,
  organizationVersions, organizations, walletAddresses, type DbOrTx, type Tx,
} from "@repo/db";
import {
  ORGANIZATION_TRANSITIONS,
  type DocumentContentType, type ListOrganizationsQuery, type ListOrganizationsResponse, type OrganizationNoteRequest,
  type OrganizationReviewDetail, type OrganizationStatus, type PayoutWalletDecisionRequest, type TransitionOrganizationRequest, type VersionDecisionRequest,
} from "@repo/validator";
import { R2_BUCKET, r2 } from "@/providers/r2";
import type { OrganizationEmailKind } from "@/providers/resend";
import { cursorSchema, type OpsCtx } from "./applications";
import { writeAudit } from "./audit";
import { notifyOwner, resolveTemplate, versionView } from "./organizations";

export const PAGE_SIZE = 25;
const DOWNLOAD_TTL_SEC = 300;
const EXTENSIONS: Record<DocumentContentType, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const STATUS_EMAILS: Partial<Record<OrganizationStatus, OrganizationEmailKind>> = { CHANGES_REQUIRED: "changes_required", VERIFIED: "verified", REJECTED: "rejected" };
const iso = (d: Date | null) => d?.toISOString() ?? null;
const notFound = () => createHttpError("Organization not found", { code: "NOT_FOUND" });
const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });

/** Ops users who belong to an organization (in any role or status) cannot act on it. */
export async function assertNotMember(conn: DbOrTx, userId: string, orgId: string): Promise<void> {
  const [m] = await conn.select({ id: organizationMemberships.id }).from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.userId, userId)));
  if (m) throw createHttpError("You can't review your own organization.", { code: "FORBIDDEN" });
}

/** Locks the organization row, then applies the self-review block under that lock. */
async function lockOrg(tx: Tx, ctx: OpsCtx, id: string) {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, id)).for("update");
  if (!org) throw notFound();
  await assertNotMember(tx, ctx.userId, id);
  return org;
}

export async function getOrganizationForReview(id: string): Promise<OrganizationReviewDetail> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id));
  if (!org) throw notFound();
  const versions = await db.select().from(organizationVersions).where(eq(organizationVersions.organizationId, id)).orderBy(organizationVersions.versionNumber);
  const documents = await db.select().from(organizationDocuments).where(and(eq(organizationDocuments.organizationId, id), isNull(organizationDocuments.membershipId))).orderBy(organizationDocuments.createdAt, organizationDocuments.id);
  const links = versions.length === 0 ? [] : await db.select({ versionId: organizationVersionDocuments.versionId, documentId: organizationVersionDocuments.documentId }).from(organizationVersionDocuments)
    .where(and(inArray(organizationVersionDocuments.versionId, versions.map((v) => v.id)), isNull(organizationVersionDocuments.removedAt)));
  const wallets = await db.select().from(organizationPayoutWallets).where(eq(organizationPayoutWallets.organizationId, id)).orderBy(organizationPayoutWallets.createdAt, organizationPayoutWallets.id);
  const events = await db.select().from(organizationEvents).where(eq(organizationEvents.organizationId, id)).orderBy(organizationEvents.createdAt, organizationEvents.id);
  const [owner] = await db.select({ userId: organizationMemberships.userId }).from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, id), eq(organizationMemberships.role, "OWNER"), eq(organizationMemberships.status, "ACTIVE")));
  const addresses = owner ? await db.select({ chain: walletAddresses.chain, address: walletAddresses.address }).from(walletAddresses)
    .innerJoin(investmentWallets, eq(investmentWallets.id, walletAddresses.investmentWalletId))
    .where(and(eq(investmentWallets.userId, owner.userId!), eq(investmentWallets.status, "active"))).orderBy(walletAddresses.createdAt) : [];
  const template = await resolveTemplate(db, org.type, org.jurisdiction);
  const members = await db.select({
    id: organizationMemberships.id, role: organizationMemberships.role, status: organizationMemberships.status, publicDisplayName: organizationMemberships.publicDisplayName,
    // Same rule as transferOwnership (hasApprovedVerification); drizzle leaves a column of a single-table select unqualified, so the outer column is written out.
    verificationApproved: sql<boolean>`exists (select 1 from app.member_verifications mv where mv.membership_id = "app"."organization_memberships"."id" and mv.status = 'approved')`,
  }).from(organizationMemberships)
    .where(and(eq(organizationMemberships.organizationId, id), notInArray(organizationMemberships.status, ["REJECTED", "REVOKED"])))
    .orderBy(organizationMemberships.joinedAt, organizationMemberships.id);
  return {
    id: org.id, type: org.type, status: org.status, jurisdiction: org.jurisdiction, currentVersionId: org.currentVersionId, submittedAt: iso(org.submittedAt),
    verifiedAt: iso(org.verifiedAt), decidedByUserId: org.decidedByUserId, createdAt: org.createdAt.toISOString(),
    owner: { userId: owner?.userId ?? null, addresses },
    versions: await Promise.all(versions.map((v) => versionView(db, v))),
    documents: documents.map((d) => ({
      id: d.id, documentType: d.documentType, contentType: d.contentType, sizeBytes: d.sizeBytes, status: d.status, uploadedAt: iso(d.uploadedAt),
      versionIds: links.filter((l) => l.documentId === d.id).map((l) => l.versionId),
    })),
    payoutWallets: wallets.map((w) => ({
      id: w.id, chain: w.chain, address: w.address, status: w.status, verifiedAt: iso(w.verifiedAt), activatedAt: iso(w.activatedAt), deactivatedAt: iso(w.deactivatedAt),
      createdAt: w.createdAt.toISOString(), requestedByUserId: w.requestedByUserId, decidedByUserId: w.decidedByUserId,
    })),
    events: events.map((e) => ({
      id: e.id, actorType: e.actorType, actorUserId: e.actorUserId, kind: e.kind, fromStatus: e.fromStatus, toStatus: e.toStatus, versionId: e.versionId,
      payoutWalletId: e.payoutWalletId, decision: e.decision, internalNote: e.internalNote, messageToOwner: e.messageToOwner, createdAt: e.createdAt.toISOString(),
    })),
    template: { requiredFields: template.requiredFields, requiredDocuments: template.requiredDocuments },
    members,
  };
}

/** Correlated lookup of a value from the organization's latest version. `expr` is a fixed literal below, never user input. */
const latest = (expr: string) => sql`(select ${sql.raw(expr)} from app.organization_versions v where v.organization_id = ${organizations.id} order by v.version_number desc limit 1)`;
const hasVersionInReview = sql`exists (select 1 from app.organization_versions v where v.organization_id = ${organizations.id} and v.status = 'in_review')`;
const hasPendingReplacement = sql`exists (select 1 from app.organization_payout_wallets w where w.organization_id = ${organizations.id} and w.status = 'REPLACEMENT_PENDING')`;

export async function listOrganizationsForReview(q: ListOrganizationsQuery): Promise<ListOrganizationsResponse> {
  const displayName = latest("v.public_profile->>'displayName'");
  const legalName = latest("coalesce(v.private_details->>'legalName', v.private_details->>'legalCompanyName')");
  const queue = q.queue ?? "organizations";
  const conditions = [
    queue === "organizations" ? sql`${organizations.status} <> 'DRAFT'`
      : queue === "change_requests" ? sql`${organizations.status} = 'VERIFIED' and ${hasVersionInReview}`
        : hasPendingReplacement,
  ];
  if (q.status) conditions.push(eq(organizations.status, q.status));
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(sql`(${displayName} ilike ${like} or ${legalName} ilike ${like})`);
  }
  if (q.cursor) {
    const parsed = cursorSchema.safeParse(Buffer.from(q.cursor, "base64url").toString().split("|"));
    if (!parsed.success) throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    conditions.push(sql`(${organizations.updatedAt}, ${organizations.id}) < (${parsed.data[0]}::timestamptz, ${parsed.data[1]}::uuid)`);
  }
  const rows = await db.select({ org: organizations, displayName: sql<string | null>`${displayName}`, legalName: sql<string | null>`${legalName}`, cursorTs: sql<string>`${organizations.updatedAt}::text` })
    .from(organizations).where(and(...conditions)).orderBy(desc(organizations.updatedAt), desc(organizations.id)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.org.id, type: r.org.type, status: r.org.status, jurisdiction: r.org.jurisdiction, displayName: r.displayName, legalName: r.legalName,
      submittedAt: iso(r.org.submittedAt), updatedAt: r.org.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(`${last.cursorTs}|${last.org.id}`).toString("base64url") : null,
  };
}

export async function transitionOrganization(ctx: OpsCtx, id: string, i: TransitionOrganizationRequest): Promise<OrganizationReviewDetail> {
  const eventId = await db.transaction(async (tx) => {
    const org = await lockOrg(tx, ctx, id);
    if (!ORGANIZATION_TRANSITIONS[org.status].includes(i.to)) throw invalid(`An organization in ${org.status} cannot move to ${i.to}.`);
    let versionId: string | null = null;
    if (i.to === "CHANGES_REQUIRED" || i.to === "VERIFIED" || i.to === "REJECTED") {
      const [version] = await tx.select().from(organizationVersions).where(and(eq(organizationVersions.organizationId, id), eq(organizationVersions.status, "in_review")));
      if (!version) throw invalid("There is no version in review.");
      versionId = version.id;
      const decided = i.to !== "CHANGES_REQUIRED";
      await tx.update(organizationVersions).set({
        status: i.to === "VERIFIED" ? "approved" : i.to === "REJECTED" ? "rejected" : "changes_required", updatedAt: sql`now()`,
        ...(decided ? { decidedAt: sql`now()`, decidedByUserId: ctx.userId } : {}),
      }).where(eq(organizationVersions.id, version.id));
    }
    await tx.update(organizations).set({
      status: i.to, updatedAt: sql`now()`,
      ...(i.to === "VERIFIED" ? { currentVersionId: versionId, verifiedAt: sql`now()`, decidedByUserId: ctx.userId } : {}),
      ...(i.to === "REJECTED" ? { decidedByUserId: ctx.userId } : {}),
    }).where(eq(organizations.id, id));
    const [event] = await tx.insert(organizationEvents).values({
      organizationId: id, actorType: "ops", actorUserId: ctx.userId, kind: "status_changed", fromStatus: org.status, toStatus: i.to, versionId,
      internalNote: i.internalNote, messageToOwner: i.messageToOwner, requestId: ctx.meta.requestId,
    }).returning({ id: organizationEvents.id });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization.status_changed", entityType: "organization", entityId: id,
      requestId: ctx.meta.requestId, metadata: { from: org.status, to: i.to },
    });
    return event!.id;
  });
  const kind = STATUS_EMAILS[i.to];
  if (kind) await notifyOwner(id, kind, { message: i.messageToOwner }, `organization-status/${eventId}`);
  return getOrganizationForReview(id);
}

/** Decision on a change request (a version in review on a verified organization). */
export async function decideVersion(ctx: OpsCtx, id: string, versionId: string, i: VersionDecisionRequest): Promise<OrganizationReviewDetail> {
  const eventId = await db.transaction(async (tx) => {
    const org = await lockOrg(tx, ctx, id);
    if (org.status !== "VERIFIED") throw invalid("Only a verified organization has change requests.");
    const [version] = await tx.select().from(organizationVersions).where(and(eq(organizationVersions.id, versionId), eq(organizationVersions.organizationId, id))).for("update");
    if (!version) throw createHttpError("Version not found", { code: "NOT_FOUND" });
    if (version.status !== "in_review" || version.id === org.currentVersionId) throw invalid("This version is not awaiting a decision.");

    await tx.update(organizationVersions).set({
      status: i.decision, updatedAt: sql`now()`, ...(i.decision === "changes_required" ? {} : { decidedAt: sql`now()`, decidedByUserId: ctx.userId }),
    }).where(eq(organizationVersions.id, version.id));
    if (i.decision === "approved") {
      // The previous public version is superseded in the same transaction that switches the pointer.
      if (org.currentVersionId) await tx.update(organizationVersions).set({ status: "superseded", updatedAt: sql`now()` }).where(eq(organizationVersions.id, org.currentVersionId));
      await tx.update(organizations).set({ currentVersionId: version.id, updatedAt: sql`now()` }).where(eq(organizations.id, id));
    } else {
      await tx.update(organizations).set({ updatedAt: sql`now()` }).where(eq(organizations.id, id));
    }
    const [event] = await tx.insert(organizationEvents).values({
      organizationId: id, actorType: "ops", actorUserId: ctx.userId, kind: "version_decided", versionId: version.id,
      decision: i.decision, internalNote: i.internalNote, messageToOwner: i.messageToOwner, requestId: ctx.meta.requestId,
    }).returning({ id: organizationEvents.id });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization_version.decided", entityType: "organization", entityId: id,
      requestId: ctx.meta.requestId, metadata: { versionId: version.id, decision: i.decision },
    });
    return event!.id;
  });
  await notifyOwner(id, "change_request_decided", { decision: i.decision, message: i.messageToOwner }, `version-decision/${eventId}`);
  return getOrganizationForReview(id);
}

/** Decision on a payout wallet replacement. The old wallet is revoked before the new one is activated (one VERIFIED per organization). */
export async function decidePayoutWallet(ctx: OpsCtx, id: string, walletId: string, i: PayoutWalletDecisionRequest): Promise<OrganizationReviewDetail> {
  const eventId = await db.transaction(async (tx) => {
    await lockOrg(tx, ctx, id);
    const [wallet] = await tx.select().from(organizationPayoutWallets)
      .where(and(eq(organizationPayoutWallets.id, walletId), eq(organizationPayoutWallets.organizationId, id))).for("update");
    if (!wallet) throw createHttpError("Payout wallet not found", { code: "NOT_FOUND" });
    if (wallet.status !== "REPLACEMENT_PENDING") throw invalid("This payout wallet change is not awaiting a decision.");
    if (i.decision === "approved") {
      await tx.update(organizationPayoutWallets).set({ status: "REVOKED", deactivatedAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(organizationPayoutWallets.organizationId, id), eq(organizationPayoutWallets.status, "VERIFIED")));
      await tx.update(organizationPayoutWallets).set({ status: "VERIFIED", activatedAt: sql`now()`, decidedByUserId: ctx.userId, updatedAt: sql`now()` }).where(eq(organizationPayoutWallets.id, wallet.id));
    } else {
      await tx.update(organizationPayoutWallets).set({ status: "REVOKED", decidedByUserId: ctx.userId, updatedAt: sql`now()` }).where(eq(organizationPayoutWallets.id, wallet.id));
    }
    const [event] = await tx.insert(organizationEvents).values({
      organizationId: id, actorType: "ops", actorUserId: ctx.userId, kind: "payout_wallet_changed", payoutWalletId: wallet.id,
      decision: i.decision, internalNote: i.internalNote, requestId: ctx.meta.requestId,
    }).returning({ id: organizationEvents.id });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "payout_wallet.replacement_decided", entityType: "organization", entityId: id,
      requestId: ctx.meta.requestId, metadata: { walletId: wallet.id, decision: i.decision },
    });
    return event!.id;
  });
  await notifyOwner(id, "payout_replacement_decided", { decision: i.decision }, `payout-decision/${eventId}`);
  return getOrganizationForReview(id);
}

export async function addOrganizationNote(ctx: OpsCtx, id: string, note: OrganizationNoteRequest["internalNote"]): Promise<OrganizationReviewDetail> {
  await db.transaction(async (tx) => {
    await lockOrg(tx, ctx, id);
    await tx.insert(organizationEvents).values({ organizationId: id, actorType: "ops", actorUserId: ctx.userId, kind: "note", internalNote: note, requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "organization.note_added", entityType: "organization", entityId: id, requestId: ctx.meta.requestId });
  });
  return getOrganizationForReview(id);
}

/** Short-lived attachment link to the stored file, audited as `action`. Callers have already checked access (reviewers who belong to the organization cannot download). */
export async function downloadUrl(ctx: OpsCtx, doc: typeof organizationDocuments.$inferSelect, action: string, metadata: Record<string, unknown>): Promise<string> {
  const url = await getSignedUrl(r2, new GetObjectCommand({
    Bucket: R2_BUCKET, Key: doc.r2Key, ResponseContentDisposition: `attachment; filename="${doc.documentType}.${EXTENSIONS[doc.contentType as DocumentContentType]}"`,
  }), { expiresIn: DOWNLOAD_TTL_SEC });
  await writeAudit(db, { actorType: "user", actorUserId: ctx.userId, action, entityType: "organization_document", entityId: doc.id, requestId: ctx.meta.requestId, metadata });
  return url;
}

/** Organization documents only: a member's documents download through the member review route. */
export async function documentDownloadUrl(ctx: OpsCtx, id: string, docId: string): Promise<string> {
  await assertNotMember(db, ctx.userId, id);
  const [doc] = await db.select().from(organizationDocuments).where(and(
    eq(organizationDocuments.id, docId), eq(organizationDocuments.organizationId, id), eq(organizationDocuments.status, "uploaded"), isNull(organizationDocuments.membershipId),
  ));
  if (!doc) throw createHttpError("Document not found", { code: "NOT_FOUND" });
  return downloadUrl(ctx, doc, "organization_document.downloaded", { organizationId: id });
}

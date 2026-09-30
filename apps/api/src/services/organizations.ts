import { randomUUID } from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import createHttpError from "http-errors";
import { and, desc, eq, inArray, isNotNull, isNull, max, or, sql } from "drizzle-orm";
import { logger } from "@repo/logger";
import {
  contacts, db, isUniqueViolation, membershipEvents, organizationDocuments, organizationEvents, organizationMemberships, organizationPayoutWallets, organizationVersionDocuments,
  organizationVersions, organizations, userPermissions, verificationRequirementTemplates, type DbOrTx, type Tx,
} from "@repo/db";
import {
  DOCUMENT_TYPE_KEYS, ORGANIZATION_FIELDS, ROLE_PERMISSIONS, membershipRoleSchema,
  type CreateOrganizationRequest, type DocumentContentType, type DocumentView, type ListMyOrganizationsResponse, type MissingRequirements,
  type OrganizationDetail, type OrganizationFieldKey, type PresignDocumentRequest, type PresignDocumentResponse,
  type PublicOrganization, type TemplateSubject, type UpdateDraftRequest, type VersionView,
} from "@repo/validator";
import { consume, limits } from "../middleware/rate-limit";
import type { RequestMeta } from "../middleware/request-context";
import { R2_BUCKET, r2 } from "../providers/r2";
import { sendOrganizationEmail, type OrganizationEmailData, type OrganizationEmailKind } from "../providers/resend";
import { writeAudit } from "./audit";
import { notFound, requirePermission } from "./members";

export interface OwnerCtx { userId: string; sessionId: string; meta: RequestMeta }
export type OrganizationRow = typeof organizations.$inferSelect;
export type VersionRow = typeof organizationVersions.$inferSelect;

const PRESIGN_TTL_SEC = 300;
const EDITABLE = ["draft", "changes_required"] as const;
const OPEN = ["draft", "in_review", "changes_required"] as const;
const WORKSPACE_STATUSES = ["PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED", "ACTIVE", "REMOVAL_REQUESTED"] as const;
const MAGIC: Record<DocumentContentType, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46, 0x2d],
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

const notEditable = () => createHttpError("This organization can't be edited right now.", { code: "INVALID_TRANSITION" });
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** The version the owner may change (draft or changes_required); throws 409 when there is none. */
export async function editableVersion(conn: DbOrTx, orgId: string): Promise<VersionRow> {
  const [v] = await conn.select().from(organizationVersions).where(and(eq(organizationVersions.organizationId, orgId), inArray(organizationVersions.status, EDITABLE)));
  if (!v) throw notEditable();
  return v;
}

/** Locks the organization, then returns it with its editable version: every writer of a version takes this lock, so a submit can't race an edit. */
async function lockEditable(tx: DbOrTx, userId: string, orgId: string) {
  const { org } = await requirePermission(tx, userId, orgId, "org.edit", true);
  return { org, version: await editableVersion(tx, orgId) };
}

export async function resolveTemplate(conn: DbOrTx, subject: TemplateSubject, jurisdiction: string | null) {
  const [t] = await conn.select().from(verificationRequirementTemplates)
    .where(and(eq(verificationRequirementTemplates.subject, subject), isNull(verificationRequirementTemplates.retiredAt),
      jurisdiction ? or(eq(verificationRequirementTemplates.jurisdiction, jurisdiction), isNull(verificationRequirementTemplates.jurisdiction)) : isNull(verificationRequirementTemplates.jurisdiction)))
    .orderBy(sql`${verificationRequirementTemplates.jurisdiction} is null`) // jurisdiction-specific first
    .limit(1);
  if (!t) throw createHttpError(500, "No verification template configured", { code: "INTERNAL" });
  return t;
}

/** What a template still needs: fields whose value fails the catalog schema and document types nobody uploaded. A template naming an unknown field or document type is a configuration error (500). */
export function missingFromTemplate(template: { requiredFields: string[]; requiredDocuments: string[] }, values: Record<string, unknown>, uploadedTypes: Set<string>) {
  const fields = template.requiredFields.filter((key) => {
    if (!Object.hasOwn(ORGANIZATION_FIELDS, key)) throw createHttpError(500, "Verification template names an unknown field", { code: "INTERNAL" });
    return !ORGANIZATION_FIELDS[key as OrganizationFieldKey].schema.safeParse(values[key]).success;
  });
  const documents = template.requiredDocuments.filter((type) => {
    if (!(DOCUMENT_TYPE_KEYS as readonly string[]).includes(type)) throw createHttpError(500, "Verification template names an unknown document type", { code: "INTERNAL" });
    return !uploadedTypes.has(type);
  });
  return { fields, documents };
}

/** Merges `next` over `old`; a null value removes the key. */
export const mergeDetails = (old: Record<string, unknown>, next: Record<string, unknown> = {}) => Object.fromEntries(Object.entries({ ...old, ...next }).filter(([, v]) => v !== null));

/** What still blocks a submit of `version`. A template naming an unknown field or document type is a configuration error (500). */
export async function missingRequirements(conn: DbOrTx, org: OrganizationRow, version: VersionRow): Promise<MissingRequirements> {
  const template = await resolveTemplate(conn, org.type, org.jurisdiction);
  const values: Record<string, unknown> = { ...version.publicProfile, ...version.privateDetails };
  const uploaded = new Set((await linkedDocuments(conn, version.id)).filter((d) => d.status === "uploaded").map((d) => d.documentType));
  const { fields, documents } = missingFromTemplate(template, values, uploaded);
  const [verified] = await conn.select({ id: organizationPayoutWallets.id }).from(organizationPayoutWallets)
    .where(and(eq(organizationPayoutWallets.organizationId, org.id), eq(organizationPayoutWallets.status, "VERIFIED")));
  return { fields, documents, payoutWallet: !verified };
}

/** Active (not unlinked) documents of a version, as metadata: the storage key is never selected. */
async function linkedDocuments(conn: DbOrTx, versionId: string): Promise<Array<DocumentView>> {
  const rows = await conn.select({
    id: organizationDocuments.id, documentType: organizationDocuments.documentType, contentType: organizationDocuments.contentType,
    sizeBytes: organizationDocuments.sizeBytes, status: organizationDocuments.status, uploadedAt: organizationDocuments.uploadedAt,
  }).from(organizationVersionDocuments)
    .innerJoin(organizationDocuments, eq(organizationDocuments.id, organizationVersionDocuments.documentId))
    .where(and(eq(organizationVersionDocuments.versionId, versionId), isNull(organizationVersionDocuments.removedAt)))
    .orderBy(organizationDocuments.createdAt, organizationDocuments.id);
  return rows.map((r) => ({ ...r, uploadedAt: iso(r.uploadedAt) }));
}

export async function versionView(conn: DbOrTx, v: VersionRow): Promise<VersionView> {
  return {
    id: v.id, versionNumber: v.versionNumber, status: v.status, publicProfile: v.publicProfile, privateDetails: v.privateDetails,
    submittedAt: iso(v.submittedAt), documents: await linkedDocuments(conn, v.id),
  };
}

export async function createOrganization(ctx: OwnerCtx, body: CreateOrganizationRequest): Promise<OrganizationDetail> {
  const [permission] = await db.select({ id: userPermissions.id }).from(userPermissions)
    .where(and(eq(userPermissions.userId, ctx.userId), eq(userPermissions.permission, "create_manager_organization"), isNull(userPermissions.revokedAt)));
  if (!permission) throw createHttpError("You need manager approval before creating an organization.", { code: "FORBIDDEN" });
  const orgId = await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ type: body.type, jurisdiction: body.jurisdiction, createdByUserId: ctx.userId }).returning({ id: organizations.id });
    await tx.insert(organizationVersions).values({ organizationId: org!.id, versionNumber: 1, createdByUserId: ctx.userId });
    const [owner] = await tx.insert(organizationMemberships).values({ organizationId: org!.id, userId: ctx.userId, role: "OWNER", status: "ACTIVE", activatedAt: sql`now()` }).returning({ id: organizationMemberships.id });
    await tx.insert(membershipEvents).values({ membershipId: owner!.id, organizationId: org!.id, actorType: "member", actorUserId: ctx.userId, kind: "accepted", fromStatus: null, toStatus: "ACTIVE", toRole: "OWNER", requestId: ctx.meta.requestId });
    await tx.insert(organizationEvents).values({ organizationId: org!.id, actorType: "owner", actorUserId: ctx.userId, kind: "status_changed", fromStatus: null, toStatus: "DRAFT", requestId: ctx.meta.requestId });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization.created", entityType: "organization", entityId: org!.id,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { type: body.type, jurisdiction: body.jurisdiction },
    });
    return org!.id;
  }).catch((err: unknown) => {
    if (isUniqueViolation(err, "organizations_one_open_per_user")) throw createHttpError("You already have an organization in progress.", { code: "ORGANIZATION_EXISTS" });
    throw err;
  });
  return getOrganizationForMember(ctx, orgId);
}

/** The caller's open memberships that belong to a workspace: a pending invite is not one (see listMyInvitations). */
export async function listMyOrganizations(userId: string): Promise<ListMyOrganizationsResponse> {
  const rows = await db.select({
    id: organizations.id, type: organizations.type, status: organizations.status, jurisdiction: organizations.jurisdiction, role: organizationMemberships.role,
    displayName: sql<string | null>`(select v.public_profile->>'displayName' from app.organization_versions v where v.organization_id = ${organizations.id} order by v.version_number desc limit 1)`,
    membershipId: organizationMemberships.id, membershipStatus: organizationMemberships.status,
  }).from(organizationMemberships).innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, userId), inArray(organizationMemberships.status, WORKSPACE_STATUSES))).orderBy(organizations.createdAt, organizations.id);
  return { organizations: rows as ListMyOrganizationsResponse["organizations"] };
}

/** Workspace view for any active member (`org.read`): private details included, documents as metadata only. */
export async function getOrganizationForMember(ctx: OwnerCtx, id: string): Promise<OrganizationDetail> {
  const { org, membership } = await requirePermission(db, ctx.userId, id, "org.read");
  const [open] = await db.select().from(organizationVersions).where(and(eq(organizationVersions.organizationId, id), inArray(organizationVersions.status, OPEN)));
  const [current] = org.currentVersionId ? await db.select().from(organizationVersions).where(eq(organizationVersions.id, org.currentVersionId)) : [];
  const wallets = await db.select().from(organizationPayoutWallets).where(eq(organizationPayoutWallets.organizationId, id)).orderBy(organizationPayoutWallets.createdAt, organizationPayoutWallets.id);
  const template = await resolveTemplate(db, org.type, org.jurisdiction);
  const [message] = await db.select({ message: organizationEvents.messageToOwner }).from(organizationEvents)
    .where(and(eq(organizationEvents.organizationId, id), sql`${organizationEvents.messageToOwner} is not null`))
    .orderBy(desc(organizationEvents.createdAt), desc(organizationEvents.id)).limit(1);
  return {
    id: org.id, type: org.type, status: org.status, jurisdiction: org.jurisdiction, submittedAt: iso(org.submittedAt), verifiedAt: iso(org.verifiedAt),
    openVersion: open ? await versionView(db, open) : null,
    currentVersion: current ? await versionView(db, current) : null,
    payoutWallets: wallets.map((w) => ({
      id: w.id, chain: w.chain, address: w.address, status: w.status, verifiedAt: iso(w.verifiedAt), activatedAt: iso(w.activatedAt),
      deactivatedAt: iso(w.deactivatedAt), createdAt: w.createdAt.toISOString(),
    })),
    template: { requiredFields: template.requiredFields, requiredDocuments: template.requiredDocuments },
    missing: open ? await missingRequirements(db, org, open) : null,
    latestMessageToOwner: message?.message ?? null,
    myRole: membership.role,
    myPermissions: [...ROLE_PERMISSIONS[membership.role]],
  };
}

export async function updateDraft(ctx: OwnerCtx, id: string, body: UpdateDraftRequest): Promise<OrganizationDetail> {
  await db.transaction(async (tx) => {
    const { version } = await lockEditable(tx, ctx.userId, id);
    await tx.update(organizationVersions).set({
      publicProfile: mergeDetails(version.publicProfile, body.publicProfile), privateDetails: mergeDetails(version.privateDetails, body.privateDetails), updatedAt: sql`now()`,
    }).where(eq(organizationVersions.id, version.id));
  });
  return getOrganizationForMember(ctx, id);
}

/** Records a pending upload and signs the browser's PUT to `incoming/`. Shared by organization and member documents: `membershipId` marks the latter. */
export async function presignUpload(i: { organizationId: string; membershipId?: string; key: (documentId: string) => string; userId: string; body: PresignDocumentRequest }): Promise<PresignDocumentResponse> {
  const documentId = randomUUID();
  const key = i.key(documentId);
  await db.insert(organizationDocuments).values({
    id: documentId, organizationId: i.organizationId, membershipId: i.membershipId, documentType: i.body.documentType, r2Key: key, contentType: i.body.contentType,
    sizeBytes: i.body.sizeBytes, uploadedByUserId: i.userId,
  });
  const uploadUrl = await getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: i.body.contentType, ContentLength: i.body.sizeBytes }), {
    expiresIn: PRESIGN_TTL_SEC, signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { documentId, uploadUrl, headers: { "Content-Type": i.body.contentType } };
}

export async function presignDocument(ctx: OwnerCtx, id: string, body: PresignDocumentRequest): Promise<PresignDocumentResponse> {
  await requirePermission(db, ctx.userId, id, "org.edit");
  await editableVersion(db, id);
  await consume(limits.documentPresignOrg, id);
  return presignUpload({ organizationId: id, key: (documentId) => `incoming/${id}/${documentId}`, userId: ctx.userId, body });
}

/**
 * Checks the uploaded object, copies it to `finalKey` and, in one transaction, marks the document uploaded and runs `link` (the caller's linking, events and audit).
 * The object is untrusted: size and type must match what was declared, and the leading bytes must match the type.
 */
export async function storeUpload(doc: typeof organizationDocuments.$inferSelect, finalKey: string, link: (tx: Tx) => Promise<void>): Promise<void> {
  const head = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2Key })).catch(() => null);
  const first = head && head.ContentLength === doc.sizeBytes && head.ContentType === doc.contentType
    ? Buffer.from(await (await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2Key, Range: "bytes=0-7" }))).Body!.transformToByteArray())
    : null;
  const ok = first !== null && MAGIC[doc.contentType as DocumentContentType].every((b, i) => first[i] === b);
  if (!ok) {
    await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2Key })).catch(() => undefined);
    await db.update(organizationDocuments).set({ status: "rejected_file" }).where(and(eq(organizationDocuments.id, doc.id), eq(organizationDocuments.status, "pending_upload")));
    throw createHttpError(422, "This file doesn't match its type or size. Upload a PDF, JPEG or PNG up to 10 MB.", { code: "DOCUMENT_REJECTED" });
  }
  await r2.send(new CopyObjectCommand({ Bucket: R2_BUCKET, CopySource: `${R2_BUCKET}/${doc.r2Key}`, Key: finalKey }));
  await db.transaction(async (tx) => {
    const done = await tx.update(organizationDocuments).set({ status: "uploaded", r2Key: finalKey, uploadedAt: sql`now()` })
      .where(and(eq(organizationDocuments.id, doc.id), eq(organizationDocuments.status, "pending_upload"))).returning({ id: organizationDocuments.id });
    if (done.length === 0) throw createHttpError("This document was already processed.", { code: "INVALID_TRANSITION" });
    await link(tx);
  });
  // Best effort: the bucket lifecycle rule clears leftovers in incoming/.
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: doc.r2Key })).catch(() => undefined);
}

export async function confirmDocument(ctx: OwnerCtx, id: string, docId: string): Promise<OrganizationDetail> {
  await requirePermission(db, ctx.userId, id, "org.edit");
  const [doc] = await db.select().from(organizationDocuments).where(and(eq(organizationDocuments.id, docId), eq(organizationDocuments.organizationId, id), isNull(organizationDocuments.membershipId)));
  if (!doc) throw createHttpError("Document not found", { code: "NOT_FOUND" });
  if (doc.status !== "pending_upload") throw createHttpError("This document was already processed.", { code: "INVALID_TRANSITION" });
  await editableVersion(db, id);
  await storeUpload(doc, `documents/${id}/${doc.id}`, async (tx) => {
    const { version } = await lockEditable(tx, ctx.userId, id);
    // A new document replaces the version's link of the same type.
    await tx.update(organizationVersionDocuments).set({ removedAt: sql`now()` }).where(and(
      eq(organizationVersionDocuments.versionId, version.id), isNull(organizationVersionDocuments.removedAt),
      inArray(organizationVersionDocuments.documentId, tx.select({ id: organizationDocuments.id }).from(organizationDocuments)
        .where(and(eq(organizationDocuments.organizationId, id), eq(organizationDocuments.documentType, doc.documentType)))),
    ));
    await tx.insert(organizationVersionDocuments).values({ versionId: version.id, documentId: doc.id });
    await tx.insert(organizationEvents).values({ organizationId: id, actorType: "owner", actorUserId: ctx.userId, kind: "document_uploaded", versionId: version.id, requestId: ctx.meta.requestId });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization_document.uploaded", entityType: "organization_document", entityId: doc.id,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { organizationId: id, documentType: doc.documentType },
    });
  });
  return getOrganizationForMember(ctx, id);
}

/** Unlinks the document from the editable version only; the document row and object stay. */
export async function unlinkDocument(ctx: OwnerCtx, id: string, docId: string): Promise<OrganizationDetail> {
  await db.transaction(async (tx) => {
    const { version } = await lockEditable(tx, ctx.userId, id);
    const [unlinked] = await tx.update(organizationVersionDocuments).set({ removedAt: sql`now()` }).where(and(
      eq(organizationVersionDocuments.versionId, version.id), eq(organizationVersionDocuments.documentId, docId), isNull(organizationVersionDocuments.removedAt),
    )).returning({ id: organizationVersionDocuments.id });
    if (!unlinked) throw createHttpError("Document not found", { code: "NOT_FOUND" });
    await tx.insert(organizationEvents).values({
      organizationId: id, actorType: "owner", actorUserId: ctx.userId, kind: "document_unlinked", versionId: version.id, requestId: ctx.meta.requestId,
    });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization_document.unlinked", entityType: "organization_document", entityId: docId,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { organizationId: id, versionId: version.id },
    });
  });
  return getOrganizationForMember(ctx, id);
}

/** Emails the owner's verified email contact; with none the notice is skipped (logged). Never throws: a committed state change is not undone by a notice problem. */
export async function notifyOwner(orgId: string, kind: OrganizationEmailKind, data: OrganizationEmailData, idempotencyKey: string): Promise<void> {
  try {
    const [owner] = await db.select({ email: contacts.value }).from(organizationMemberships)
      .innerJoin(contacts, eq(contacts.userId, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.organizationId, orgId), eq(organizationMemberships.role, "OWNER"), eq(organizationMemberships.status, "ACTIVE"), eq(contacts.type, "email"), eq(contacts.status, "verified")));
    if (!owner) {
      logger.info("organization email skipped: owner has no verified email", { kind });
      return;
    }
    await sendOrganizationEmail(kind, owner.email, data, idempotencyKey);
  } catch (err) {
    logger.warn("organization email failed", { kind, error: err instanceof Error ? err.name : "unknown" });
  }
}

const incomplete = (missing: MissingRequirements) => createHttpError(422, "Complete the missing items before submitting.", { code: "REQUIREMENTS_INCOMPLETE", details: { missing } });

/** DRAFT -> SUBMITTED or CHANGES_REQUIRED -> RESUBMITTED. Needs every template field and document and a verified payout wallet. */
export async function submitOrganization(ctx: OwnerCtx, id: string): Promise<OrganizationDetail> {
  await db.transaction(async (tx) => {
    const { org } = await requirePermission(tx, ctx.userId, id, "org.edit", true);
    const to = org.status === "DRAFT" ? "SUBMITTED" : org.status === "CHANGES_REQUIRED" ? "RESUBMITTED" : null;
    if (!to) throw createHttpError(`An organization in ${org.status} cannot be submitted.`, { code: "INVALID_TRANSITION" });
    const version = await editableVersion(tx, id);
    const missing = await missingRequirements(tx, org, version);
    if (missing.fields.length > 0 || missing.documents.length > 0 || missing.payoutWallet) throw incomplete(missing);
    await tx.update(organizations).set({ status: to, submittedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizations.id, id));
    await tx.update(organizationVersions).set({ status: "in_review", submittedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationVersions.id, version.id));
    await tx.insert(organizationEvents).values({ organizationId: id, actorType: "owner", actorUserId: ctx.userId, kind: "status_changed", fromStatus: org.status, toStatus: to, versionId: version.id, requestId: ctx.meta.requestId });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization.status_changed", entityType: "organization", entityId: id,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { from: org.status, to },
    });
  });
  return getOrganizationForMember(ctx, id);
}

/** Opens a new draft version (a copy of the approved one) on a verified organization. */
export async function createChangeRequest(ctx: OwnerCtx, id: string): Promise<OrganizationDetail> {
  await db.transaction(async (tx) => {
    const { org } = await requirePermission(tx, ctx.userId, id, "org.edit", true);
    if (org.status !== "VERIFIED" || !org.currentVersionId) throw createHttpError("Only a verified organization can request changes.", { code: "INVALID_TRANSITION" });
    const [open] = await tx.select({ id: organizationVersions.id }).from(organizationVersions).where(and(eq(organizationVersions.organizationId, id), inArray(organizationVersions.status, OPEN)));
    if (open) throw createHttpError("A change request is already open.", { code: "INVALID_TRANSITION" });
    const [current] = await tx.select().from(organizationVersions).where(eq(organizationVersions.id, org.currentVersionId));
    const [latest] = await tx.select({ n: max(organizationVersions.versionNumber) }).from(organizationVersions).where(eq(organizationVersions.organizationId, id));
    const [draft] = await tx.insert(organizationVersions).values({
      organizationId: id, versionNumber: latest!.n! + 1, publicProfile: current!.publicProfile, privateDetails: current!.privateDetails, createdByUserId: ctx.userId,
    }).returning({ id: organizationVersions.id, versionNumber: organizationVersions.versionNumber });
    const links = await tx.select({ documentId: organizationVersionDocuments.documentId }).from(organizationVersionDocuments)
      .where(and(eq(organizationVersionDocuments.versionId, current!.id), isNull(organizationVersionDocuments.removedAt)));
    if (links.length > 0) await tx.insert(organizationVersionDocuments).values(links.map((l) => ({ versionId: draft!.id, documentId: l.documentId })));
    await tx.insert(organizationEvents).values({ organizationId: id, actorType: "owner", actorUserId: ctx.userId, kind: "version_created", versionId: draft!.id, requestId: ctx.meta.requestId });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization_version.created", entityType: "organization", entityId: id,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { versionId: draft!.id, versionNumber: draft!.versionNumber },
    });
  }).catch((err: unknown) => {
    if (isUniqueViolation(err, "organization_versions_one_open")) throw createHttpError("A change request is already open.", { code: "INVALID_TRANSITION" });
    throw err;
  });
  return getOrganizationForMember(ctx, id);
}

/** Sends the open change-request version (draft or changes_required) to review. The payout wallet is not part of it. */
export async function submitChangeRequest(ctx: OwnerCtx, id: string): Promise<OrganizationDetail> {
  await db.transaction(async (tx) => {
    const { org } = await requirePermission(tx, ctx.userId, id, "org.edit", true);
    if (org.status !== "VERIFIED") throw createHttpError("Only a verified organization has change requests.", { code: "INVALID_TRANSITION" });
    const version = await editableVersion(tx, id);
    const missing = await missingRequirements(tx, org, version);
    if (missing.fields.length > 0 || missing.documents.length > 0) throw incomplete({ ...missing, payoutWallet: false });
    await tx.update(organizationVersions).set({ status: "in_review", submittedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(organizationVersions.id, version.id));
    await tx.insert(organizationEvents).values({ organizationId: id, actorType: "owner", actorUserId: ctx.userId, kind: "version_submitted", versionId: version.id, requestId: ctx.meta.requestId });
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: "organization_version.submitted", entityType: "organization", entityId: id,
      requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { versionId: version.id, versionNumber: version.versionNumber },
    });
  });
  return getOrganizationForMember(ctx, id);
}

/** Public view: only a VERIFIED organization, and only the catalog fields marked public from its current approved version. */
export async function getPublicOrganization(id: string): Promise<PublicOrganization> {
  const [row] = await db.select({ org: organizations, version: organizationVersions }).from(organizations)
    .innerJoin(organizationVersions, eq(organizationVersions.id, organizations.currentVersionId))
    .where(and(eq(organizations.id, id), eq(organizations.status, "VERIFIED")));
  if (!row?.org.verifiedAt) throw notFound();
  const profile = Object.fromEntries(Object.entries(row.version.publicProfile)
    .filter(([key]) => Object.hasOwn(ORGANIZATION_FIELDS, key) && ORGANIZATION_FIELDS[key as OrganizationFieldKey].visibility === "public"));
  // Opted-in names only (never ids, wallets or emails): current = ACTIVE, former = REVOKED after having been ACTIVE.
  const members = await db.select().from(organizationMemberships).where(and(
    eq(organizationMemberships.organizationId, id), isNotNull(organizationMemberships.publicDisplayName),
    or(eq(organizationMemberships.status, "ACTIVE"), and(eq(organizationMemberships.status, "REVOKED"), isNotNull(organizationMemberships.activatedAt))),
  ));
  const rank = (role: (typeof members)[number]["role"]) => membershipRoleSchema.options.indexOf(role);
  const person = (m: (typeof members)[number]) => ({ displayName: m.publicDisplayName!, title: m.publicTitle, role: m.role });
  return {
    id: row.org.id, type: row.org.type, jurisdiction: row.org.jurisdiction, verifiedAt: row.org.verifiedAt.toISOString(), profile,
    team: {
      current: members.filter((m) => m.status === "ACTIVE").sort((a, b) => rank(a.role) - rank(b.role) || a.publicDisplayName!.localeCompare(b.publicDisplayName!)).map(person),
      former: members.filter((m) => m.status === "REVOKED").sort((a, b) => (b.leftAt ?? b.updatedAt).getTime() - (a.leftAt ?? a.updatedAt).getTime())
        .map((m) => ({ ...person(m), from: m.activatedAt!.toISOString(), to: (m.leftAt ?? m.updatedAt).toISOString() })),
    },
  };
}

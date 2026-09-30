import createHttpError from "http-errors";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import {
  basketAssignments, basketEvents, basketReviews, basketSlugAliases, basketVersionDisclosures, basketVersions, baskets, db, disclosureTemplates, organizations, type Tx,
} from "@repo/db";
import {
  BASKET_TRANSITIONS, BASKET_VERSION_TRANSITIONS, validateBasketVersion,
  type BasketApprovalRequest, type BasketDetail, type BasketReasonRequest, type BasketReviewDecisionRequest, type BasketStatus, type BasketVersionStatus,
  type CreateDisclosureTemplateRequest, type DisclosureTemplateView, type ListDisclosureTemplatesResponse, type ListOpsBasketsQuery, type OpsBasketDetail, type OpsBasketListResponse,
} from "@repo/validator";
import { orgDisplayName } from "./members";
import { cursorSchema, type OpsCtx } from "./applications";
import { writeAudit } from "./audit";
import {
  assignmentViews, contentHash, currentAssets, currentDisclosures, eventViews, getBasketForMember, loadValidationInput, newSlug, notifyBasket, notifyReassignmentRequired, READ_ONLY, requireReassignmentIfLeaderless, openVersionOf, requireBasketAction, versionDiff,
  versionView,
} from "./baskets";
import { PAGE_SIZE, assertNotMember } from "./organization-review";
import type { OwnerCtx } from "./organizations";
import { activeRoles } from "./platform-roles";

type BasketRow = typeof baskets.$inferSelect;
type VersionRow = typeof basketVersions.$inferSelect;
type EventKind = typeof basketEvents.$inferInsert.kind;

const iso = (d: Date | null) => d?.toISOString() ?? null;
const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });
const notFound = (what: string) => createHttpError(`${what} not found`, { code: "NOT_FOUND" });

/** Applies one BASKET_VERSION_TRANSITIONS edge. The caller holds the basket lock. */
async function moveVersion(tx: Tx, v: VersionRow, to: BasketVersionStatus, set: PgUpdateSetSource<typeof basketVersions> = {}): Promise<void> {
  if (!BASKET_VERSION_TRANSITIONS[v.status].includes(to)) throw invalid(`A version in ${v.status} cannot move to ${to}.`);
  await tx.update(basketVersions).set({ ...set, status: to, updatedAt: sql`now()` }).where(eq(basketVersions.id, v.id));
}

interface BasketMove {
  kind: EventKind; actorType: "member" | "ops"; userId: string; sessionId?: string; requestId: string; action: string; reason?: string; versionId?: string;
  set?: PgUpdateSetSource<typeof baskets>; metadata?: Record<string, unknown>;
  /** Only publishing an ACTIVE basket and a platform pause of a PAUSED one keep the status; every other move must be a BASKET_TRANSITIONS edge. */
  keepStatus?: boolean;
}

/** Applies one BASKET_TRANSITIONS edge: the change, its event and its audit entry. Returns the event id. The caller holds the basket lock. */
async function moveBasket(tx: Tx, b: BasketRow, to: BasketStatus, i: BasketMove): Promise<string> {
  if (!(i.keepStatus && b.status === to) && !BASKET_TRANSITIONS[b.status].includes(to)) throw invalid(`A basket in ${b.status} cannot move to ${to}.`);
  await tx.update(baskets).set({ ...i.set, status: to, updatedAt: sql`now()` }).where(eq(baskets.id, b.id));
  const [e] = await tx.insert(basketEvents).values({
    basketId: b.id, versionId: i.versionId, kind: i.kind, fromStatus: b.status, toStatus: to, actorType: i.actorType, actorUserId: i.userId, reason: i.reason, requestId: i.requestId,
  }).returning({ id: basketEvents.id });
  await writeAudit(tx, {
    actorType: "user", actorUserId: i.userId, action: i.action, entityType: "basket", entityId: b.id, requestId: i.requestId, sessionId: i.sessionId,
    metadata: { from: b.status, to, reason: i.reason, ...i.metadata },
  });
  return e!.id;
}

/** Pins the templates that apply to the version's assets as a new pin revision (old pins stay). With `onlyIfChanged`, the current pins are kept when the same set applies. Returns whether a revision was written. */
async function pinDisclosures(tx: Tx, v: VersionRow, onlyIfChanged: boolean): Promise<boolean> {
  const types = (await currentAssets(tx, v)).map((a) => a.assetType);
  const stable = types.includes("STABLECOIN");
  const rwa = types.some((t) => t.startsWith("TOKENIZED_"));
  const wanted = (await tx.select({ id: disclosureTemplates.id, condition: disclosureTemplates.condition }).from(disclosureTemplates).where(eq(disclosureTemplates.status, "active")))
    .filter((t) => t.condition === "always" || (t.condition === "has_stablecoin" && stable) || (t.condition === "has_rwa" && rwa)).map((t) => t.id).sort();
  if (onlyIfChanged && wanted.join() === (await currentDisclosures(tx, v)).map((d) => d.templateId).sort().join()) return false;
  const revision = v.disclosuresRevision + 1;
  if (wanted.length > 0) await tx.insert(basketVersionDisclosures).values(wanted.map((templateId) => ({ versionId: v.id, revision, templateId })));
  await tx.update(basketVersions).set({ disclosuresRevision: revision, updatedAt: sql`now()` }).where(eq(basketVersions.id, v.id));
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// Manager: submit, withdraw, publish
// ---------------------------------------------------------------------------------------------------------------------

export async function submitVersion(ctx: OwnerCtx, bid: string): Promise<BasketDetail> {
  const eventId = await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "submit", true);
    if (basket.status !== "DRAFT" && basket.status !== "ACTIVE") throw invalid("This basket can't take new versions right now.");
    const v = await openVersionOf(tx, bid, true);
    if (!v || (v.status !== "draft" && v.status !== "changes_required")) throw invalid("There is no draft to submit.");
    const { issues } = validateBasketVersion(await loadValidationInput(tx, v.id));
    if (issues.length > 0) throw createHttpError(422, "Fix the listed issues before submitting.", { code: "BASKET_VALIDATION_FAILED", details: { issues } });
    await pinDisclosures(tx, v, false);
    await moveVersion(tx, v, "in_review", { contentHash: await contentHash(tx, v.id), submittedByUserId: ctx.userId, submittedAt: sql`now()` });
    await tx.update(baskets).set({ updatedAt: sql`now()` }).where(eq(baskets.id, bid));
    const [e] = await tx.insert(basketEvents).values({ basketId: bid, versionId: v.id, kind: "submitted", fromStatus: v.status, toStatus: "in_review", actorType: "member", actorUserId: ctx.userId, requestId: ctx.meta.requestId }).returning({ id: basketEvents.id });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.version_submitted", entityType: "basket", entityId: bid, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { versionId: v.id } });
    return e!.id;
  });
  await notifyBasket(bid, "submitted", {}, eventId);
  return getBasketForMember(ctx, bid);
}

/** Back to draft, allowed only while no reviewer has acted (an escalation flag does not count). */
export async function withdrawVersion(ctx: OwnerCtx, bid: string): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "submit", true);
    if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
    const v = await openVersionOf(tx, bid, true);
    if (v?.status !== "in_review") throw invalid("There is no submission to withdraw.");
    const [decided] = await tx.select({ id: basketReviews.id }).from(basketReviews).where(and(eq(basketReviews.versionId, v.id), sql`${basketReviews.decision} <> 'escalated'`, sql`${basketReviews.createdAt} >= (select submitted_at from app.basket_versions where id = ${v.id})`)).limit(1);
    if (decided) throw invalid("This submission has already been reviewed.");
    await moveVersion(tx, v, "draft");
    await tx.insert(basketEvents).values({ basketId: bid, versionId: v.id, kind: "withdrawn", fromStatus: "in_review", toStatus: "draft", actorType: "member", actorUserId: ctx.userId, requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.version_withdrawn", entityType: "basket", entityId: bid, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { versionId: v.id } });
  });
  return getBasketForMember(ctx, bid);
}

/** Publishes the approved version. Idempotent: an already published current version returns as is. The content must still match what ops approved; a disclosure change since submit only re-pins. */
export async function publishVersion(ctx: OwnerCtx, bid: string): Promise<BasketDetail> {
  const eventId = await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "publish", true);
    const [v] = await tx.select().from(basketVersions).where(and(eq(basketVersions.basketId, bid), inArray(basketVersions.status, ["approved", "published"]))).orderBy(desc(basketVersions.versionNumber)).limit(1);
    if (v?.status === "published" && basket.currentVersionId === v.id) return null;
    if (!v || v.status !== "approved") throw invalid("There is no approved version to publish.");
    if (basket.status !== "DRAFT" && basket.status !== "ACTIVE") throw invalid("This basket can't publish right now.");
    // Registry, organization and lead state can change after approval; the hash does not cover them.
    const { issues } = validateBasketVersion(await loadValidationInput(tx, v.id));
    if (issues.length > 0) throw createHttpError(422, "Fix the listed issues before publishing.", { code: "BASKET_VALIDATION_FAILED", details: { issues } });
    // Compared before any re-pin: pins change the hash by template ids only, so a mismatch here is a content change.
    if ((await contentHash(tx, v.id)) !== v.approvedHash) throw invalid("This version changed after approval.");
    const repinned = await pinDisclosures(tx, v, true);
    const previous = basket.currentVersionId ? (await tx.select({ name: basketVersions.name }).from(basketVersions).where(eq(basketVersions.id, basket.currentVersionId)))[0] : undefined;
    // A renamed version gets a new slug (the old one stays as an alias once it has been public); before the first publish the slug was never public.
    const slug = previous?.name === v.name ? basket.slug : newSlug(v.name);
    if (previous && slug !== basket.slug) await tx.insert(basketSlugAliases).values({ slug: basket.slug, basketId: bid });
    if (basket.currentVersionId) await tx.update(basketVersions).set({ status: "superseded", updatedAt: sql`now()` }).where(eq(basketVersions.id, basket.currentVersionId));
    const hash = await contentHash(tx, v.id);
    await moveVersion(tx, v, "published", { contentHash: hash, publishedByUserId: ctx.userId, publishedAt: sql`now()` });
    if (repinned) await tx.insert(basketEvents).values({ basketId: bid, versionId: v.id, kind: "disclosures_repinned", actorType: "member", actorUserId: ctx.userId, requestId: ctx.meta.requestId });
    return moveBasket(tx, basket, basket.status === "DRAFT" ? "ACTIVE" : basket.status, {
      keepStatus: true, kind: "published", actorType: "member", userId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, action: "basket.version_published", versionId: v.id,
      set: { currentVersionId: v.id, slug }, metadata: { versionId: v.id, hash, repinned },
    });
  });
  if (eventId) await notifyBasket(bid, "published", {}, eventId);
  return getBasketForMember(ctx, bid);
}

// ---------------------------------------------------------------------------------------------------------------------
// Manager lifecycle
// ---------------------------------------------------------------------------------------------------------------------

const managerMove = (ctx: OwnerCtx) => ({ actorType: "member", userId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId }) as const;

export async function pauseBasket(ctx: OwnerCtx, bid: string, reason: BasketReasonRequest["reason"]): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "lifecycle", true);
    if (basket.status !== "ACTIVE") throw invalid("Only an active basket can be paused.");
    await moveBasket(tx, basket, "PAUSED", { ...managerMove(ctx), kind: "paused", action: "basket.paused", reason, set: { pauseKind: "manager", pauseReason: reason } });
  });
  return getBasketForMember(ctx, bid);
}

export async function resumeBasket(ctx: OwnerCtx, bid: string): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "lifecycle", true);
    if (basket.status !== "PAUSED") throw invalid("Only a paused basket can be resumed.");
    if (basket.pauseKind === "platform") throw createHttpError("Only the Bytesac team can lift this pause.", { code: "FORBIDDEN" });
    await moveBasket(tx, basket, "ACTIVE", { ...managerMove(ctx), kind: "resumed", action: "basket.resumed", set: { pauseKind: null, pauseReason: null } });
  });
  return getBasketForMember(ctx, bid);
}

export async function requestRetirement(ctx: OwnerCtx, bid: string, reason: BasketReasonRequest["reason"]): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "lifecycle", true);
    if (basket.status !== "ACTIVE" && basket.status !== "PAUSED") throw invalid("Only an active or paused basket can be retired.");
    await moveBasket(tx, basket, "RETIREMENT_PENDING", { ...managerMove(ctx), kind: "retirement_requested", action: "basket.retirement_requested", reason, set: { previousStatus: basket.status } });
  });
  return getBasketForMember(ctx, bid);
}

// ---------------------------------------------------------------------------------------------------------------------
// Ops: queues, detail, decisions
// ---------------------------------------------------------------------------------------------------------------------

/** Locks the basket row, then applies the self-review block under that lock. */
async function lockBasket(tx: Tx, ctx: OpsCtx, bid: string): Promise<BasketRow> {
  const [b] = await tx.select().from(baskets).where(eq(baskets.id, bid)).for("update");
  if (!b) throw notFound("Basket");
  await assertNotMember(tx, ctx.userId, b.organizationId);
  return b;
}

const opsMove = (ctx: OpsCtx) => ({ actorType: "ops", userId: ctx.userId, requestId: ctx.meta.requestId }) as const;
const latest = (col: string) => sql`(select v.${sql.raw(col)} from app.basket_versions v where v.basket_id = ${baskets.id} order by v.version_number desc limit 1)`;
const LIVE = sql`${baskets.status} not in ('RETIRED', 'REJECTED')`;
// Only reviews of the current submission count: an earlier round's escalation does not carry over.
const inReview = (escalated: boolean) => sql`${LIVE} and exists (select 1 from app.basket_versions v where v.basket_id = ${baskets.id} and v.status = 'in_review'
  and ${escalated ? sql`exists` : sql`not exists`} (select 1 from app.basket_reviews r where r.version_id = v.id and r.decision = 'escalated' and r.created_at >= v.submitted_at))`;
const QUEUES = {
  review: inReview(false),
  escalated: inReview(true),
  leads: sql`${LIVE} and exists (select 1 from app.basket_assignments a where a.basket_id = ${baskets.id} and a.role = 'lead' and a.status = 'PENDING_APPROVAL')`,
  retirements: sql`${baskets.status} = 'RETIREMENT_PENDING'`,
};

export async function listBasketsForOps(q: ListOpsBasketsQuery): Promise<OpsBasketListResponse> {
  const conditions = [QUEUES[q.queue]];
  if (q.cursor) {
    const parsed = cursorSchema.safeParse(Buffer.from(q.cursor, "base64url").toString().split("|"));
    if (!parsed.success) throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    conditions.push(sql`(${baskets.updatedAt}, ${baskets.id}) < (${parsed.data[0]}::timestamptz, ${parsed.data[1]}::uuid)`);
  }
  const rows = await db.select({
    b: baskets, orgName: orgDisplayName, name: sql<string>`${latest("name")}`, versionNumber: sql<number>`${latest("version_number")}`,
    versionStatus: sql<BasketVersionStatus>`${latest("status")}`, cursorTs: sql<string>`${baskets.updatedAt}::text`,
  }).from(baskets).innerJoin(organizations, eq(organizations.id, baskets.organizationId)).where(and(...conditions)).orderBy(desc(baskets.updatedAt), desc(baskets.id)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      id: r.b.id, name: r.name, organizationId: r.b.organizationId, organizationName: r.orgName, status: r.b.status, latestVersionNumber: r.versionNumber, latestVersionStatus: r.versionStatus,
      updatedAt: r.b.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(`${last.cursorTs}|${last.b.id}`).toString("base64url") : null,
  };
}

export async function getBasketForOps(bid: string): Promise<OpsBasketDetail> {
  const [row] = await db.select({ b: baskets, orgName: orgDisplayName, orgStatus: organizations.status }).from(baskets).innerJoin(organizations, eq(organizations.id, baskets.organizationId)).where(eq(baskets.id, bid));
  if (!row) throw notFound("Basket");
  const { b } = row;
  const versions = await db.select().from(basketVersions).where(eq(basketVersions.basketId, bid)).orderBy(desc(basketVersions.versionNumber));
  const open = await openVersionOf(db, bid);
  const published = versions.find((v) => v.id === b.currentVersionId);
  const publishedView = published ? await versionView(db, published) : null;
  const reviews = await db.select().from(basketReviews).where(eq(basketReviews.basketId, bid)).orderBy(basketReviews.createdAt, basketReviews.id);
  return {
    id: b.id, organizationId: b.organizationId, slug: b.slug, status: b.status, previousStatus: b.previousStatus, pauseKind: b.pauseKind, pauseReason: b.pauseReason,
    createdAt: b.createdAt.toISOString(), updatedAt: b.updatedAt.toISOString(),
    organization: { id: b.organizationId, displayName: row.orgName, status: row.orgStatus },
    versions: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, status: v.status, name: v.name, rationale: v.rationale, publishedAt: iso(v.publishedAt), createdAt: v.createdAt.toISOString() })),
    openVersion: open ? await versionView(db, open) : null,
    publishedVersion: publishedView,
    assignments: await assignmentViews(db, bid, null),
    reviews: reviews.map((r) => ({
      id: r.id, versionId: r.versionId, decision: r.decision, checklist: r.checklist, sectionComments: r.sectionComments, messageToManager: r.messageToManager, createdAt: r.createdAt.toISOString(),
      reviewerUserId: r.reviewerUserId, internalNote: r.internalNote, reviewedHash: r.reviewedHash,
    })),
    events: await eventViews(db, bid),
    validation: open ? validateBasketVersion(await loadValidationInput(db, open.id)) : null,
    diff: open ? await versionDiff(db, open) : null,
    hasAssetWarning: publishedView?.assets.some((a) => a.instrumentStatus === "PAUSED" || a.instrumentStatus === "DEPRECATED") ?? false,
  };
}

/** A reviewer records changes required, a rejection or an escalation; only an ops_admin approves, and only a submission whose content still matches its stored hash. */
export async function decideVersion(ctx: OpsCtx, bid: string, vid: string, i: BasketReviewDecisionRequest): Promise<OpsBasketDetail> {
  const { eventId, message } = await db.transaction(async (tx) => {
    const basket = await lockBasket(tx, ctx, bid);
    if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
    if (i.decision === "approved" && !(await activeRoles(tx, ctx.userId)).includes("ops_admin")) throw createHttpError("Only an ops admin can approve a version.", { code: "FORBIDDEN" });
    const [v] = await tx.select().from(basketVersions).where(and(eq(basketVersions.id, vid), eq(basketVersions.basketId, bid))).for("update");
    if (!v) throw notFound("Version");
    if (v.status !== "in_review" || !v.contentHash) throw invalid("This version is not awaiting a decision.");
    if (i.decision === "approved" && (await contentHash(tx, v.id)) !== v.contentHash) throw invalid("The submission changed; ask the manager to resubmit.");
    await tx.insert(basketReviews).values({
      versionId: v.id, basketId: bid, reviewerUserId: ctx.userId, decision: i.decision, checklist: i.checklist, sectionComments: i.sectionComments ?? [],
      messageToManager: i.messageToManager, internalNote: i.internalNote, reviewedHash: v.contentHash,
    });
    const to = { changes_required: "changes_required", approved: "approved", rejected: "rejected", escalated: v.status }[i.decision] as BasketVersionStatus;
    if (i.decision !== "escalated") {
      await moveVersion(tx, v, to, i.decision === "approved" ? { approvedHash: v.contentHash, approvedByUserId: ctx.userId, approvedAt: sql`now()` } : {});
    }
    let eventId: string;
    if (i.decision === "rejected" && v.versionNumber === 1 && !basket.currentVersionId) {
      eventId = await moveBasket(tx, basket, "REJECTED", { ...opsMove(ctx), kind: "rejected", action: "basket.rejected", reason: i.messageToManager, versionId: v.id });
    } else {
      const [e] = await tx.insert(basketEvents).values({
        basketId: bid, versionId: v.id, kind: i.decision === "approved" ? "approved" : i.decision === "rejected" ? "rejected" : "reviewed", fromStatus: v.status, toStatus: to,
        actorType: "ops", actorUserId: ctx.userId, reason: i.messageToManager, requestId: ctx.meta.requestId,
      }).returning({ id: basketEvents.id });
      eventId = e!.id;
    }
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket_version.decided", entityType: "basket", entityId: bid, requestId: ctx.meta.requestId, metadata: { versionId: v.id, decision: i.decision } });
    return { eventId, message: i.messageToManager };
  });
  if (i.decision !== "escalated") await notifyBasket(bid, i.decision, { message }, eventId);
  return getBasketForOps(bid);
}

/** Approves or rejects a PENDING_APPROVAL lead (ops_admin). Approval ends the previous lead and, for a basket awaiting a new lead, restores its previous status. */
export async function decideLead(ctx: OpsCtx, bid: string, aid: string, i: BasketApprovalRequest): Promise<OpsBasketDetail> {
  const eventId = await db.transaction(async (tx) => {
    const basket = await lockBasket(tx, ctx, bid);
    if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
    const [a] = await tx.select().from(basketAssignments).where(and(eq(basketAssignments.id, aid), eq(basketAssignments.basketId, bid))).for("update");
    if (!a) throw notFound("Assignment");
    if (a.role !== "lead" || a.status !== "PENDING_APPROVAL") throw invalid("This assignment is not awaiting approval.");
    const approved = i.decision === "approved";
    if (approved) {
      const replaced = await tx.update(basketAssignments).set({ status: "ENDED", endedAt: sql`now()`, endReason: "replaced", updatedAt: sql`now()` })
        .where(and(eq(basketAssignments.basketId, bid), eq(basketAssignments.role, "lead"), eq(basketAssignments.status, "ACTIVE"))).returning({ id: basketAssignments.id });
      for (const r of replaced) await tx.insert(basketEvents).values({ basketId: bid, assignmentId: r.id, kind: "assignment_ended", actorType: "ops", actorUserId: ctx.userId, reason: "replaced", requestId: ctx.meta.requestId });
    }
    await tx.update(basketAssignments).set(
      approved ? { status: "ACTIVE", startedAt: sql`now()`, decidedByUserId: ctx.userId, updatedAt: sql`now()` }
        : { status: "REJECTED", endedAt: sql`now()`, endReason: i.reason ?? null, decidedByUserId: ctx.userId, updatedAt: sql`now()` },
    ).where(eq(basketAssignments.id, a.id));
    const [e] = await tx.insert(basketEvents).values({
      basketId: bid, assignmentId: a.id, kind: "lead_decided", toStatus: approved ? "ACTIVE" : "REJECTED", actorType: "ops", actorUserId: ctx.userId, reason: i.reason, requestId: ctx.meta.requestId,
    }).returning({ id: basketEvents.id });
    if (approved && basket.status === "REASSIGNMENT_REQUIRED") {
      await moveBasket(tx, basket, basket.previousStatus ?? "ACTIVE", { ...opsMove(ctx), kind: "resumed", action: "basket.reassignment_resolved", set: { previousStatus: null } });
    }
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.lead_decided", entityType: "basket_assignment", entityId: a.id, requestId: ctx.meta.requestId, metadata: { basketId: bid, decision: i.decision } });
    return e!.id;
  });
  await notifyBasket(bid, i.decision === "approved" ? "lead_approved" : "lead_rejected", { message: i.reason }, eventId);
  return getBasketForOps(bid);
}

/** Platform pause (ops_reviewer). Also turns a manager pause into a platform pause, which a manager can no longer lift. */
export async function platformPause(ctx: OpsCtx, bid: string, reason: BasketReasonRequest["reason"]): Promise<OpsBasketDetail> {
  const eventId = await db.transaction(async (tx) => {
    const basket = await lockBasket(tx, ctx, bid);
    if (basket.status !== "ACTIVE" && basket.status !== "PAUSED") throw invalid("Only an active or paused basket can be paused.");
    if (basket.status === "PAUSED" && basket.pauseKind === "platform") throw invalid("This basket is already paused by the platform.");
    return moveBasket(tx, basket, "PAUSED", { ...opsMove(ctx), keepStatus: true, kind: "paused", action: "basket.platform_paused", reason, set: { pauseKind: "platform", pauseReason: reason } });
  });
  await notifyBasket(bid, "platform_paused", { message: reason }, eventId);
  return getBasketForOps(bid);
}

export async function platformResume(ctx: OpsCtx, bid: string): Promise<OpsBasketDetail> {
  const eventId = await db.transaction(async (tx) => {
    const basket = await lockBasket(tx, ctx, bid);
    if (basket.status !== "PAUSED") throw invalid("Only a paused basket can be resumed.");
    return moveBasket(tx, basket, "ACTIVE", { ...opsMove(ctx), kind: "resumed", action: "basket.platform_resumed", set: { pauseKind: null, pauseReason: null } });
  });
  await notifyBasket(bid, "platform_resumed", {}, eventId);
  return getBasketForOps(bid);
}

export async function platformRetire(ctx: OpsCtx, bid: string, reason: BasketReasonRequest["reason"]): Promise<OpsBasketDetail> {
  const eventId = await db.transaction(async (tx) => moveBasket(tx, await lockBasket(tx, ctx, bid), "RETIRED", { ...opsMove(ctx), kind: "retired", action: "basket.retired", reason, set: { pauseKind: null, pauseReason: null, previousStatus: null } }));
  await notifyBasket(bid, "retired", { message: reason }, eventId);
  return getBasketForOps(bid);
}

/** Approval retires the basket; a decline restores the status it had when retirement was requested. */
export async function decideRetirement(ctx: OpsCtx, bid: string, i: BasketApprovalRequest): Promise<OpsBasketDetail> {
  const eventId = await db.transaction(async (tx) => {
    const basket = await lockBasket(tx, ctx, bid);
    if (basket.status !== "RETIREMENT_PENDING") throw invalid("There is no retirement request to decide.");
    const id = await moveBasket(tx, basket, i.decision === "approved" ? "RETIRED" : basket.previousStatus ?? "ACTIVE", {
      ...opsMove(ctx), kind: "retirement_decided", action: "basket.retirement_decided", reason: i.reason, set: { previousStatus: null }, metadata: { decision: i.decision },
    });
    // The lead may have left while the request was pending; a declined request must not restore a lead-less basket.
    if (i.decision !== "approved") await requireReassignmentIfLeaderless(tx, bid, ctx.userId, ctx.meta.requestId);
    return id;
  });
  await notifyReassignmentRequired(ctx.meta.requestId);
  await notifyBasket(bid, "retirement_decided", { decision: i.decision, message: i.reason }, eventId);
  return getBasketForOps(bid);
}

// ---------------------------------------------------------------------------------------------------------------------
// Disclosure templates (ops_admin)
// ---------------------------------------------------------------------------------------------------------------------

export async function listDisclosureTemplates(): Promise<ListDisclosureTemplatesResponse> {
  const rows = await db.select().from(disclosureTemplates).orderBy(disclosureTemplates.key, desc(disclosureTemplates.version));
  const keys = [...new Set(rows.map((r) => r.key))];
  return { groups: keys.map((key) => ({ key, templates: rows.filter((r) => r.key === key).map((t): DisclosureTemplateView => ({ id: t.id, key: t.key, version: t.version, title: t.title, body: t.body, condition: t.condition, status: t.status, createdAt: t.createdAt.toISOString(), retiredAt: iso(t.retiredAt) })) })) };
}

/** The next version of `key` (1 for a new key); the previous active version is retired in the same transaction. Pinned versions keep the text they were pinned with. */
export async function createDisclosureTemplate(ctx: OpsCtx, i: CreateDisclosureTemplateRequest): Promise<ListDisclosureTemplatesResponse> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`disclosure:${i.key}`}))`);
    const [last] = await tx.select({ version: disclosureTemplates.version }).from(disclosureTemplates).where(eq(disclosureTemplates.key, i.key)).orderBy(desc(disclosureTemplates.version)).limit(1);
    await tx.update(disclosureTemplates).set({ status: "retired", retiredAt: sql`now()` }).where(and(eq(disclosureTemplates.key, i.key), eq(disclosureTemplates.status, "active")));
    const [t] = await tx.insert(disclosureTemplates).values({ ...i, version: (last?.version ?? 0) + 1, createdByUserId: ctx.userId }).returning({ id: disclosureTemplates.id, version: disclosureTemplates.version });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "disclosure_template.created", entityType: "disclosure_template", entityId: t!.id, requestId: ctx.meta.requestId, metadata: { key: i.key, version: t!.version } });
  });
  return listDisclosureTemplates();
}

export async function retireDisclosureTemplate(ctx: OpsCtx, id: string): Promise<ListDisclosureTemplatesResponse> {
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(disclosureTemplates).where(eq(disclosureTemplates.id, id)).for("update");
    if (!t) throw notFound("Template");
    if (t.status !== "active") throw invalid("This template is already retired.");
    await tx.update(disclosureTemplates).set({ status: "retired", retiredAt: sql`now()` }).where(eq(disclosureTemplates.id, id));
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "disclosure_template.retired", entityType: "disclosure_template", entityId: id, requestId: ctx.meta.requestId, metadata: { key: t.key, version: t.version } });
  });
  return listDisclosureTemplates();
}

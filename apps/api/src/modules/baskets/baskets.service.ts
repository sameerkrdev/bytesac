import { createHash, randomBytes } from "node:crypto";
import createHttpError from "http-errors";
import { and, asc, desc, eq, inArray, lt, max, sql } from "drizzle-orm";
import {
  basketAssignments, basketEvents, basketReviews, contacts, basketVersionAssets, basketVersionDisclosures, basketVersions, baskets, db, disclosureTemplates,
  executionRoutes, instrumentDeployments, instruments, isUniqueViolation, organizationMemberships, organizations, priceReferences, type DbOrTx, type Tx,
} from "@repo/db";
import {
  ASSIGNMENT_FLAGS, CO_MANAGER_DEFAULT_FLAGS, LEAD_FLAGS, ROLE_PERMISSIONS, basketConstraintsSchema, basketFeesSchema, canonicalJson, diffBasketVersions, rwaProblem, validateBasketVersion,
  type AssignmentFlag, type BasketAssignmentView, type BasketDetail, type BasketEventView, type BasketDiff, type BasketDiffInput, type BasketPreview, type BasketStatus, type BasketValidation, type BasketValidationInput,
  type BasketVersionView, type CreateAssignmentRequest, type CreateBasketRequest, type EndAssignmentRequest, type ListBasketsQuery, type ListBasketsResponse,
  type ListBasketVersionsResponse, type SaveBasketDraftRequest, type UpdateAssignmentRequest,
} from "@repo/validator";
import { logger } from "@repo/logger";
import { enqueue } from "@/config/queues";
import { sendBasketEmail, type BasketEmailData, type BasketEmailKind } from "@/providers/resend";
import { writeAudit } from "@/modules/audit/audit.service";
import { isRwa } from "@/modules/eligibility/eligibility.service";
import { requirePermission, type MembershipRow } from "@/modules/members/access.service";
import type { OrganizationRow, OwnerCtx } from "@/modules/organizations/organizations.service";

type BasketRow = typeof baskets.$inferSelect;
type VersionRow = typeof basketVersions.$inferSelect;
type AssignmentRow = typeof basketAssignments.$inferSelect;

/** A version with one of these statuses is the basket's single open version. */
const OPEN_VERSION_STATUSES = ["draft", "in_review", "changes_required", "approved"] as const;
const EDITABLE: readonly string[] = ["draft", "changes_required"];
export const READ_ONLY: readonly BasketStatus[] = ["RETIRED", "REJECTED"];
const iso = (d: Date | null) => d?.toISOString() ?? null;
const invalid = (message: string) => createHttpError(message, { code: "INVALID_TRANSITION" });
const forbidden = () => createHttpError("You don't have access to this basket.", { code: "FORBIDDEN" });
const notFound = (what: string) => createHttpError(`${what} not found`, { code: "NOT_FOUND" });

/** Loads the basket and checks the acting user may perform `action` (spec §7). OWNER/ADMIN act on every basket; others need an ACTIVE assignment with the flag, on an ACTIVE membership that still holds baskets.manage. "read" = any ACTIVE member with org.read. */
export async function requireBasketAction(conn: DbOrTx, userId: string, basketId: string, action: AssignmentFlag | "read", lock = false): Promise<{ basket: BasketRow; org: OrganizationRow; membership: MembershipRow }> {
  const q = conn.select().from(baskets).where(eq(baskets.id, basketId));
  const [basket] = lock ? await q.for("update") : await q;
  if (!basket) throw createHttpError(404, "Basket not found", { code: "NOT_FOUND" });
  const { org, membership } = await requirePermission(conn, userId, basket.organizationId, "org.read");
  if (action === "read" || membership.role === "OWNER" || membership.role === "ADMIN") return { basket, org, membership };
  if (!ROLE_PERMISSIONS[membership.role].includes("baskets.manage")) throw forbidden();
  const [assignment] = await conn.select({ permissions: basketAssignments.permissions }).from(basketAssignments)
    .where(and(eq(basketAssignments.basketId, basketId), eq(basketAssignments.membershipId, membership.id), eq(basketAssignments.status, "ACTIVE")));
  if (!assignment?.permissions.includes(action)) throw forbidden();
  return { basket, org, membership };
}

/** Assets of the version's current revision with their registry status; `hasActiveDeployment` is true when at least one deployment is ACTIVE. */
export async function currentAssets(conn: DbOrTx, v: Pick<VersionRow, "id" | "assetsRevision">) {
  return conn.select({
    instrumentId: basketVersionAssets.instrumentId, name: instruments.name, symbol: instruments.symbol, assetType: instruments.assetType, instrumentStatus: instruments.status,
    targetWeightBps: basketVersionAssets.targetWeightBps, minWeightBps: basketVersionAssets.minWeightBps, maxWeightBps: basketVersionAssets.maxWeightBps, rationale: basketVersionAssets.rationale,
    hasActiveDeployment: sql<boolean>`exists (select 1 from app.instrument_deployments d where d.instrument_id = ${instruments.id} and d.status = 'ACTIVE')`,
  }).from(basketVersionAssets).innerJoin(instruments, eq(instruments.id, basketVersionAssets.instrumentId))
    .where(and(eq(basketVersionAssets.versionId, v.id), eq(basketVersionAssets.revision, v.assetsRevision)))
    .orderBy(desc(basketVersionAssets.targetWeightBps), asc(basketVersionAssets.instrumentId));
}

/** Disclosure templates pinned at the version's current pin revision. */
export async function currentDisclosures(conn: DbOrTx, v: Pick<VersionRow, "id" | "disclosuresRevision">) {
  return conn.select({ templateId: disclosureTemplates.id, key: disclosureTemplates.key, title: disclosureTemplates.title, body: disclosureTemplates.body })
    .from(basketVersionDisclosures).innerJoin(disclosureTemplates, eq(disclosureTemplates.id, basketVersionDisclosures.templateId))
    .where(and(eq(basketVersionDisclosures.versionId, v.id), eq(basketVersionDisclosures.revision, v.disclosuresRevision))).orderBy(disclosureTemplates.key);
}

export async function versionView(conn: DbOrTx, v: VersionRow): Promise<BasketVersionView> {
  const assets = await currentAssets(conn, v);
  return {
    id: v.id, versionNumber: v.versionNumber, status: v.status, name: v.name, shortDescription: v.shortDescription, longDescription: v.longDescription, category: v.category, tags: v.tags,
    objective: v.objective, thesis: v.thesis, methodology: v.methodology, intendedInvestor: v.intendedInvestor, horizon: v.horizon, keyAssumptions: v.keyAssumptions,
    knownLimitations: v.knownLimitations, strategyRisks: v.strategyRisks, liquidityNotes: v.liquidityNotes, conflictsOfInterest: v.conflictsOfInterest,
    constraints: basketConstraintsSchema.parse(v.constraints), rebalance: v.rebalance, fees: basketFeesSchema.parse(v.fees),
    minimumInvestmentUsdc: v.minimumInvestmentUsdc, minimumIncrementUsdc: v.minimumIncrementUsdc, rationale: v.rationale, contentHash: v.contentHash,
    submittedAt: iso(v.submittedAt), approvedAt: iso(v.approvedAt), publishedAt: iso(v.publishedAt), createdAt: v.createdAt.toISOString(), updatedAt: v.updatedAt.toISOString(), revision: v.revision,
    assets,
    disclosures: await currentDisclosures(conn, v),
  };
}

/** The pure validator's input for a version, loaded from the database (also used by submit and publish). */
export async function loadValidationInput(conn: DbOrTx, versionId: string): Promise<BasketValidationInput> {
  const [row] = await conn.select({ v: basketVersions, orgStatus: organizations.status }).from(basketVersions)
    .innerJoin(baskets, eq(baskets.id, basketVersions.basketId)).innerJoin(organizations, eq(organizations.id, baskets.organizationId)).where(eq(basketVersions.id, versionId));
  if (!row) throw notFound("Version");
  const { v } = row;
  const [lead] = await conn.select({ id: basketAssignments.id }).from(basketAssignments)
    .where(and(eq(basketAssignments.basketId, v.basketId), eq(basketAssignments.role, "lead"), eq(basketAssignments.status, "ACTIVE")));
  const assets = await currentAssets(conn, v);
  // Spec 11 section 8: a tokenized asset that can't be bought for structural reasons is a warning (a market price reference stands in for a fresh price here).
  const rwaIds = assets.filter((a) => isRwa(a.assetType)).map((a) => a.instrumentId);
  const routed = rwaIds.length === 0 ? [] : await conn.select({ instrumentId: instrumentDeployments.instrumentId, permissioned: instrumentDeployments.permissioned, method: executionRoutes.method }).from(instrumentDeployments)
    .innerJoin(executionRoutes, and(eq(executionRoutes.deploymentId, instrumentDeployments.id), eq(executionRoutes.status, "ACTIVE")))
    .where(and(inArray(instrumentDeployments.instrumentId, rwaIds), eq(instrumentDeployments.status, "ACTIVE")));
  const priced = new Set(rwaIds.length === 0 ? [] : (await conn.select({ id: priceReferences.instrumentId }).from(priceReferences)
    .where(and(inArray(priceReferences.instrumentId, rwaIds), eq(priceReferences.kind, "market"), eq(priceReferences.status, "ACTIVE")))).map((r) => r.id));
  return {
    version: {
      name: v.name, shortDescription: v.shortDescription, strategyRisks: v.strategyRisks, thesis: v.thesis, methodology: v.methodology, rationale: v.rationale,
      constraints: basketConstraintsSchema.parse(v.constraints), fees: basketFeesSchema.parse(v.fees), minimumInvestmentUsdc: v.minimumInvestmentUsdc, minimumIncrementUsdc: v.minimumIncrementUsdc,
    },
    assets: assets.map((a) => {
      const options = routed.filter((r) => r.instrumentId === a.instrumentId);
      return {
        instrumentId: a.instrumentId, targetWeightBps: a.targetWeightBps, minWeightBps: a.minWeightBps, maxWeightBps: a.maxWeightBps,
        instrument: { status: a.instrumentStatus, assetType: a.assetType, hasActiveDeployment: a.hasActiveDeployment, rwaProblem: isRwa(a.assetType) && options.length ? rwaProblem(options, priced.has(a.instrumentId)) : null },
      };
    }),
    versionNumber: v.versionNumber, hasActiveLead: lead !== undefined, orgVerified: row.orgStatus === "VERIFIED",
  };
}

/** sha256 of the canonical JSON of the version content, its current allocation (by instrument id) and its currently pinned template ids. */
export async function contentHash(conn: DbOrTx, versionId: string): Promise<string> {
  const [v] = await conn.select().from(basketVersions).where(eq(basketVersions.id, versionId));
  if (!v) throw notFound("Version");
  const assets = await currentAssets(conn, v);
  const pins = await currentDisclosures(conn, v);
  const canonical = {
    category: v.category, conflictsOfInterest: v.conflictsOfInterest, constraints: v.constraints, fees: v.fees, horizon: v.horizon, intendedInvestor: v.intendedInvestor,
    keyAssumptions: v.keyAssumptions, knownLimitations: v.knownLimitations, liquidityNotes: v.liquidityNotes, longDescription: v.longDescription, methodology: v.methodology,
    minimumIncrementUsdc: v.minimumIncrementUsdc, minimumInvestmentUsdc: v.minimumInvestmentUsdc, name: v.name, objective: v.objective, rationale: v.rationale, rebalance: v.rebalance,
    shortDescription: v.shortDescription, strategyRisks: v.strategyRisks, tags: v.tags, thesis: v.thesis,
    assets: assets.map((a) => [a.instrumentId, a.targetWeightBps, a.minWeightBps, a.maxWeightBps, a.rationale]).sort((x, y) => (x[0]! < y[0]! ? -1 : 1)),
    disclosureTemplateIds: pins.map((p) => p.templateId).sort(),
  };
  return createHash("sha256").update(canonicalJson(canonical)).digest("hex");
}

/** The comparison input of a version: its content terms and current allocation. */
async function diffInput(conn: DbOrTx, v: VersionRow): Promise<BasketDiffInput> {
  return {
    version: { constraints: basketConstraintsSchema.parse(v.constraints), rebalance: v.rebalance, fees: basketFeesSchema.parse(v.fees), minimumInvestmentUsdc: v.minimumInvestmentUsdc, minimumIncrementUsdc: v.minimumIncrementUsdc },
    assets: await currentAssets(conn, v),
  };
}

/** Diff of a version against the latest earlier published (or superseded) version of the same basket. */
export async function versionDiff(conn: DbOrTx, v: VersionRow): Promise<BasketDiff> {
  const [previous] = await conn.select().from(basketVersions).where(and(
    eq(basketVersions.basketId, v.basketId), inArray(basketVersions.status, ["published", "superseded"]), lt(basketVersions.versionNumber, v.versionNumber),
  )).orderBy(desc(basketVersions.versionNumber)).limit(1);
  return diffBasketVersions(previous ? await diffInput(conn, previous) : null, await diffInput(conn, v));
}

// ---------------------------------------------------------------------------------------------------------------------
// Create, read, list
// ---------------------------------------------------------------------------------------------------------------------

const DEFAULT_FEES = { entry: { type: "percent", bps: 0 }, management: { type: "percent", bps: 0 }, rebalance: { type: "percent", bps: 0 }, subscription: null } as const;

/** Name lowercased with non-alphanumerics as `-` (≤80), plus `-` and 6 random base36 characters. */
export const newSlug = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "basket"}-${Array.from(randomBytes(6), (b) => (b % 36).toString(36)).join("")}`;

export async function createBasket(ctx: OwnerCtx, orgId: string, body: CreateBasketRequest): Promise<BasketDetail> {
  const create = () => db.transaction(async (tx) => {
    const { org, membership } = await requirePermission(tx, ctx.userId, orgId, "baskets.manage", true);
    if (org.status !== "VERIFIED") throw invalid("Your organization must be verified to create baskets.");
    const [basket] = await tx.insert(baskets).values({ organizationId: orgId, slug: newSlug(body.name), createdByUserId: ctx.userId }).returning();
    const [version] = await tx.insert(basketVersions).values({
      basketId: basket!.id, versionNumber: 1, name: body.name, category: body.category, fees: DEFAULT_FEES, createdByUserId: ctx.userId,
    }).returning({ id: basketVersions.id });
    const [lead] = await tx.insert(basketAssignments).values({
      basketId: basket!.id, organizationId: orgId, membershipId: membership.id, userId: ctx.userId, role: "lead", permissions: [...LEAD_FLAGS], status: "ACTIVE",
      assignedByUserId: ctx.userId, startedAt: sql`now()`,
    }).returning({ id: basketAssignments.id });
    await tx.insert(basketEvents).values({ basketId: basket!.id, versionId: version!.id, assignmentId: lead!.id, kind: "created", toStatus: "DRAFT", actorType: "member", actorUserId: ctx.userId, requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.created", entityType: "basket", entityId: basket!.id, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { organizationId: orgId } });
    return basket!.id;
  });
  // A slug collision (1 in 36^6) aborts the transaction: one retry with a fresh suffix.
  const bid = await create().catch((err: unknown) => (isUniqueViolation(err, "baskets_slug_unique") ? create() : Promise.reject(err as Error)));
  return getBasketForMember(ctx, bid);
}

// ponytail: no pagination, an organization holds few baskets; add a cursor (see organization-review) if lists grow past a few hundred.
export async function listOrgBaskets(ctx: OwnerCtx, orgId: string, q: ListBasketsQuery): Promise<ListBasketsResponse> {
  await requirePermission(db, ctx.userId, orgId, "org.read");
  const rows = await db.select().from(baskets).where(and(eq(baskets.organizationId, orgId), q.status ? eq(baskets.status, q.status) : undefined)).orderBy(desc(baskets.updatedAt), desc(baskets.id));
  const versions = rows.length === 0 ? [] : await db.select({
    basketId: basketVersions.basketId, id: basketVersions.id, versionNumber: basketVersions.versionNumber, status: basketVersions.status, name: basketVersions.name, category: basketVersions.category,
  }).from(basketVersions).where(inArray(basketVersions.basketId, rows.map((b) => b.id))).orderBy(desc(basketVersions.versionNumber));
  return {
    baskets: rows.map((b) => {
      const latest = versions.find((v) => v.basketId === b.id)!;
      const open = OPEN_VERSION_STATUSES.includes(latest.status as (typeof OPEN_VERSION_STATUSES)[number]);
      return {
        id: b.id, slug: b.slug, name: latest.name, category: latest.category, status: b.status, updatedAt: b.updatedAt.toISOString(),
        currentVersionNumber: versions.find((v) => v.id === b.currentVersionId)?.versionNumber ?? null, openVersionStatus: open ? latest.status : null,
      };
    }),
  };
}

export const openVersionOf = async (conn: DbOrTx, basketId: string, lock = false): Promise<VersionRow | undefined> => {
  const q = conn.select().from(basketVersions).where(and(eq(basketVersions.basketId, basketId), inArray(basketVersions.status, [...OPEN_VERSION_STATUSES])));
  return (lock ? await q.for("update") : await q)[0];
};

/** Private view for any active member of the organization: never includes a reviewer's internal note. */
/** Every assignment of the basket (history included) with its public display name; `selfUserId` marks the caller's own. */
export async function assignmentViews(conn: DbOrTx, bid: string, selfUserId: string | null): Promise<BasketAssignmentView[]> {
  const rows = await conn.select({ a: basketAssignments, displayName: organizationMemberships.publicDisplayName }).from(basketAssignments)
    .innerJoin(organizationMemberships, eq(organizationMemberships.id, basketAssignments.membershipId)).where(eq(basketAssignments.basketId, bid)).orderBy(basketAssignments.createdAt, basketAssignments.id);
  return rows.map(({ a, displayName }) => ({
    id: a.id, membershipId: a.membershipId, displayName, role: a.role, permissions: a.permissions as AssignmentFlag[], status: a.status, startedAt: iso(a.startedAt), endedAt: iso(a.endedAt),
    endReason: a.endReason, isSelf: a.userId === selfUserId,
  }));
}

/** The basket's history, oldest first; actors appear as a type only, never as a user id. */
export async function eventViews(conn: DbOrTx, bid: string): Promise<BasketEventView[]> {
  const events = await conn.select().from(basketEvents).where(eq(basketEvents.basketId, bid)).orderBy(basketEvents.createdAt, basketEvents.id);
  return events.map((e) => ({ id: e.id, kind: e.kind, versionId: e.versionId, fromStatus: e.fromStatus, toStatus: e.toStatus, actorType: e.actorType, reason: e.reason, createdAt: e.createdAt.toISOString() }));
}

export async function getBasketForMember(ctx: OwnerCtx, bid: string): Promise<BasketDetail> {
  const { basket, membership } = await requireBasketAction(db, ctx.userId, bid, "read");
  const open = await openVersionOf(db, bid);
  const [published] = basket.currentVersionId ? await db.select().from(basketVersions).where(eq(basketVersions.id, basket.currentVersionId)) : [];
  const [mine] = await db.select({ permissions: basketAssignments.permissions, role: basketAssignments.role }).from(basketAssignments)
    .where(and(eq(basketAssignments.basketId, bid), eq(basketAssignments.membershipId, membership.id), eq(basketAssignments.status, "ACTIVE")));
  const isAdmin = membership.role === "OWNER" || membership.role === "ADMIN";
  const reviews = await db.select({
    id: basketReviews.id, versionId: basketReviews.versionId, decision: basketReviews.decision, checklist: basketReviews.checklist, sectionComments: basketReviews.sectionComments,
    messageToManager: basketReviews.messageToManager, createdAt: basketReviews.createdAt,
  }).from(basketReviews).where(eq(basketReviews.basketId, bid)).orderBy(basketReviews.createdAt, basketReviews.id);
  const publishedView = published ? await versionView(db, published) : null;
  return {
    id: basket.id, organizationId: basket.organizationId, slug: basket.slug, status: basket.status, previousStatus: basket.previousStatus, pauseKind: basket.pauseKind, pauseReason: basket.pauseReason,
    createdAt: basket.createdAt.toISOString(), updatedAt: basket.updatedAt.toISOString(),
    myPermissions: isAdmin ? [...ASSIGNMENT_FLAGS] : ROLE_PERMISSIONS[membership.role].includes("baskets.manage") ? (mine?.permissions ?? []) as AssignmentFlag[] : [],
    canControlLead: isAdmin || mine?.role === "lead",
    openVersion: open ? await versionView(db, open) : null,
    publishedVersion: publishedView,
    assignments: await assignmentViews(db, bid, ctx.userId),
    reviews: reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    events: await eventViews(db, bid),
    validation: open ? validateBasketVersion(await loadValidationInput(db, open.id)) : null,
    hasAssetWarning: publishedView?.assets.some((a) => a.instrumentStatus === "PAUSED" || a.instrumentStatus === "DEPRECATED") ?? false,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Draft editing and versions
// ---------------------------------------------------------------------------------------------------------------------

/** Saves the open version under the version row lock. A stale `expectedRevision` (or, when it is absent, `expectedUpdatedAt`) is a 409 and nothing is written. Replaced assets are a new revision: the old rows stay. */
export async function saveDraft(ctx: OwnerCtx, bid: string, body: SaveBasketDraftRequest): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "edit", true);
    if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
    const v = await openVersionOf(tx, bid, true);
    if (!v) throw invalid("There is no open version to edit.");
    if (!EDITABLE.includes(v.status)) throw invalid("This version is frozen; it can't be edited now.");
    const stale = body.expectedRevision !== undefined ? body.expectedRevision !== v.revision : body.expectedUpdatedAt !== v.updatedAt.toISOString();
    if (stale) throw createHttpError("This draft changed since you opened it.", { code: "VERSION_CONFLICT" });
    const { assets, expectedUpdatedAt: _updatedAt, expectedRevision: _revision, ...fields } = body;
    if (assets) {
      const known = assets.length === 0 ? [] : await tx.select({ id: instruments.id }).from(instruments).where(inArray(instruments.id, assets.map((a) => a.instrumentId)));
      if (known.length !== assets.length) throw createHttpError("One of the assets does not exist.", { code: "VALIDATION_FAILED" });
      if (assets.length > 0) {
        await tx.insert(basketVersionAssets).values(assets.map((a) => ({
          versionId: v.id, revision: v.assetsRevision + 1, instrumentId: a.instrumentId, targetWeightBps: a.targetWeightBps, minWeightBps: a.minWeightBps ?? null, maxWeightBps: a.maxWeightBps ?? null, rationale: a.rationale ?? null,
        })));
      }
    }
    await tx.update(basketVersions).set({ ...fields, ...(assets ? { assetsRevision: v.assetsRevision + 1 } : {}), revision: sql`${basketVersions.revision} + 1`, updatedAt: sql`now()` }).where(eq(basketVersions.id, v.id));
    await tx.update(baskets).set({ updatedAt: sql`now()` }).where(eq(baskets.id, bid));
    await tx.insert(basketEvents).values({ basketId: bid, versionId: v.id, kind: "draft_saved", actorType: "member", actorUserId: ctx.userId, requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.draft_saved", entityType: "basket", entityId: bid, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { versionId: v.id } });
  });
  return getBasketForMember(ctx, bid);
}

export async function validateOpenVersion(ctx: OwnerCtx, bid: string): Promise<BasketValidation> {
  await requireBasketAction(db, ctx.userId, bid, "read");
  const open = await openVersionOf(db, bid);
  if (!open) throw invalid("There is no open version to validate.");
  return validateBasketVersion(await loadValidationInput(db, open.id));
}

export async function previewOpenVersion(ctx: OwnerCtx, bid: string): Promise<BasketPreview> {
  await requireBasketAction(db, ctx.userId, bid, "read");
  const open = await openVersionOf(db, bid);
  if (!open) throw invalid("There is no open version to preview.");
  return { version: await versionView(db, open), validation: validateBasketVersion(await loadValidationInput(db, open.id)) };
}

/** Clones the published version (content and current allocation) into the next draft; the rationale starts empty. Disclosures are pinned at submit. */
export async function createNextVersion(ctx: OwnerCtx, bid: string): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "edit", true);
    if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
    if (!basket.currentVersionId) throw invalid("Publish a version before drafting the next one.");
    if (await openVersionOf(tx, bid)) throw invalid("This basket already has an open version.");
    const [published] = await tx.select().from(basketVersions).where(eq(basketVersions.id, basket.currentVersionId));
    const [{ latest }] = await tx.select({ latest: max(basketVersions.versionNumber) }).from(basketVersions).where(eq(basketVersions.basketId, bid)) as [{ latest: number }];
    const assets = await currentAssets(tx, published!);
    const [next] = await tx.insert(basketVersions).values({
      basketId: bid, versionNumber: latest + 1, name: published!.name, shortDescription: published!.shortDescription, longDescription: published!.longDescription, category: published!.category,
      tags: published!.tags, objective: published!.objective, thesis: published!.thesis, methodology: published!.methodology, intendedInvestor: published!.intendedInvestor,
      horizon: published!.horizon, keyAssumptions: published!.keyAssumptions, knownLimitations: published!.knownLimitations, strategyRisks: published!.strategyRisks,
      liquidityNotes: published!.liquidityNotes, conflictsOfInterest: published!.conflictsOfInterest, constraints: published!.constraints, rebalance: published!.rebalance,
      fees: published!.fees, minimumInvestmentUsdc: published!.minimumInvestmentUsdc, minimumIncrementUsdc: published!.minimumIncrementUsdc, assetsRevision: 1, createdByUserId: ctx.userId,
    }).returning({ id: basketVersions.id });
    if (assets.length > 0) await tx.insert(basketVersionAssets).values(assets.map((a) => ({
      versionId: next!.id, revision: 1, instrumentId: a.instrumentId, targetWeightBps: a.targetWeightBps, minWeightBps: a.minWeightBps, maxWeightBps: a.maxWeightBps, rationale: a.rationale,
    })));
    await tx.update(baskets).set({ updatedAt: sql`now()` }).where(eq(baskets.id, bid));
    await tx.insert(basketEvents).values({ basketId: bid, versionId: next!.id, kind: "created", toStatus: "draft", actorType: "member", actorUserId: ctx.userId, reason: "new_version", requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.version_created", entityType: "basket", entityId: bid, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { versionId: next!.id } });
  });
  return getBasketForMember(ctx, bid);
}

export async function listVersions(ctx: OwnerCtx, bid: string): Promise<ListBasketVersionsResponse> {
  await requireBasketAction(db, ctx.userId, bid, "read");
  const rows = await db.select().from(basketVersions).where(eq(basketVersions.basketId, bid)).orderBy(desc(basketVersions.versionNumber));
  return { versions: rows.map((v) => ({ id: v.id, versionNumber: v.versionNumber, status: v.status, name: v.name, rationale: v.rationale, publishedAt: iso(v.publishedAt), createdAt: v.createdAt.toISOString() })) };
}

export async function getVersionDiff(ctx: OwnerCtx, bid: string, vid: string): Promise<BasketDiff> {
  await requireBasketAction(db, ctx.userId, bid, "read");
  const [v] = await db.select().from(basketVersions).where(and(eq(basketVersions.id, vid), eq(basketVersions.basketId, bid)));
  if (!v) throw notFound("Version");
  return versionDiff(db, v);
}

// ---------------------------------------------------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------------------------------------------------

/** A published ACTIVE or PAUSED basket that lost its last ACTIVE lead needs a new one. Returns whether it moved to REASSIGNMENT_REQUIRED. The caller holds the basket lock. */
export async function requireReassignmentIfLeaderless(tx: Tx, basketId: string, actorUserId: string | null, requestId: string): Promise<boolean> {
  const [b] = await tx.select().from(baskets).where(eq(baskets.id, basketId));
  const [lead] = await tx.select({ id: basketAssignments.id }).from(basketAssignments)
    .where(and(eq(basketAssignments.basketId, basketId), eq(basketAssignments.role, "lead"), eq(basketAssignments.status, "ACTIVE")));
  if (!b || lead || (b.status !== "ACTIVE" && b.status !== "PAUSED")) return false;
  await tx.update(baskets).set({ status: "REASSIGNMENT_REQUIRED", previousStatus: b.status, updatedAt: sql`now()` }).where(eq(baskets.id, b.id));
  await tx.insert(basketEvents).values({ basketId: b.id, kind: "reassignment_required", fromStatus: b.status, toStatus: "REASSIGNMENT_REQUIRED", actorType: "system", actorUserId, requestId });
  return true;
}

/** Adding, replacing or ending a lead is for OWNER/ADMIN or the current ACTIVE lead only (ADR-011). */
async function requireLeadAuthority(tx: Tx, bid: string, membership: MembershipRow): Promise<void> {
  if (membership.role === "OWNER" || membership.role === "ADMIN") return;
  const [lead] = await tx.select({ id: basketAssignments.id }).from(basketAssignments)
    .where(and(eq(basketAssignments.basketId, bid), eq(basketAssignments.role, "lead"), eq(basketAssignments.status, "ACTIVE"), eq(basketAssignments.membershipId, membership.id)));
  if (!lead) throw forbidden();
}

export async function addAssignment(ctx: OwnerCtx, bid: string, body: CreateAssignmentRequest): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket, membership } = await requireBasketAction(tx, ctx.userId, bid, "assign", true);
    if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
    if (body.role === "lead") await requireLeadAuthority(tx, bid, membership);
    const [target] = await tx.select().from(organizationMemberships).where(and(eq(organizationMemberships.id, body.membershipId), eq(organizationMemberships.organizationId, basket.organizationId)));
    if (!target) throw notFound("Membership");
    if (target.status !== "ACTIVE" || !target.userId || !ROLE_PERMISSIONS[target.role].includes("baskets.manage")) throw invalid("This member can't manage baskets.");
    const [open] = await tx.select({ id: basketAssignments.id }).from(basketAssignments)
      .where(and(eq(basketAssignments.basketId, bid), eq(basketAssignments.userId, target.userId), inArray(basketAssignments.status, ["ACTIVE", "PENDING_APPROVAL"])));
    if (open) throw invalid("This member is already assigned.");
    const lead = body.role === "lead";
    // Changing the lead of a published basket waits for ops (the current lead stays); before publication it takes effect at once.
    const pending = lead && basket.currentVersionId !== null;
    if (lead && pending) {
      const [waiting] = await tx.select({ id: basketAssignments.id }).from(basketAssignments).where(and(eq(basketAssignments.basketId, bid), eq(basketAssignments.role, "lead"), eq(basketAssignments.status, "PENDING_APPROVAL")));
      if (waiting) throw invalid("A new lead is already waiting for approval.");
    }
    if (lead && !pending) {
      const replaced = await tx.update(basketAssignments).set({ status: "ENDED", endedAt: sql`now()`, endReason: "replaced", updatedAt: sql`now()` })
        .where(and(eq(basketAssignments.basketId, bid), eq(basketAssignments.role, "lead"), eq(basketAssignments.status, "ACTIVE"))).returning({ id: basketAssignments.id });
      for (const r of replaced) await tx.insert(basketEvents).values({ basketId: bid, assignmentId: r.id, kind: "assignment_ended", actorType: "member", actorUserId: ctx.userId, reason: "replaced", requestId: ctx.meta.requestId });
    }
    const [a] = await tx.insert(basketAssignments).values({
      basketId: bid, organizationId: basket.organizationId, membershipId: target.id, userId: target.userId, role: body.role,
      permissions: lead ? [...LEAD_FLAGS] : [...(body.permissions ?? CO_MANAGER_DEFAULT_FLAGS)], status: pending ? "PENDING_APPROVAL" : "ACTIVE", assignedByUserId: ctx.userId,
      ...(pending ? {} : { startedAt: sql`now()` }),
    }).returning({ id: basketAssignments.id });
    await tx.insert(basketEvents).values({ basketId: bid, assignmentId: a!.id, kind: "assignment_added", toStatus: pending ? "PENDING_APPROVAL" : "ACTIVE", actorType: "member", actorUserId: ctx.userId, requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.assignment_added", entityType: "basket_assignment", entityId: a!.id, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { basketId: bid, role: body.role } });
  });
  await enqueue("search-index-refresh", { basketId: bid });
  return getBasketForMember(ctx, bid);
}

/** Locks the basket and the assignment (which must still be open) for an update. */
const openAssignment = async (tx: Tx, bid: string, aid: string): Promise<AssignmentRow> => {
  const [a] = await tx.select().from(basketAssignments).where(and(eq(basketAssignments.id, aid), eq(basketAssignments.basketId, bid))).for("update");
  if (!a) throw notFound("Assignment");
  if (a.status !== "ACTIVE" && a.status !== "PENDING_APPROVAL") throw invalid("This assignment is no longer open.");
  return a;
};

export async function updateAssignment(ctx: OwnerCtx, bid: string, aid: string, body: UpdateAssignmentRequest): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket } = await requireBasketAction(tx, ctx.userId, bid, "assign", true);
    if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
    const a = await openAssignment(tx, bid, aid);
    if (a.userId === ctx.userId) throw forbidden();
    if (a.role === "lead") throw invalid("A lead's permissions can't be changed.");
    await tx.update(basketAssignments).set({ permissions: body.permissions, updatedAt: sql`now()` }).where(eq(basketAssignments.id, a.id));
    await tx.insert(basketEvents).values({ basketId: bid, assignmentId: a.id, kind: "assignment_changed", actorType: "member", actorUserId: ctx.userId, requestId: ctx.meta.requestId });
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.assignment_changed", entityType: "basket_assignment", entityId: a.id, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { basketId: bid, permissions: body.permissions } });
  });
  return getBasketForMember(ctx, bid);
}

/** `assign` holders end co-manager assignments and anyone may leave their own co-manager one; a lead is ended only by OWNER/ADMIN or the current lead, never by themselves. Ending the last ACTIVE lead of a live basket moves it to REASSIGNMENT_REQUIRED. */
export async function endAssignment(ctx: OwnerCtx, bid: string, aid: string, body: EndAssignmentRequest): Promise<BasketDetail> {
  await db.transaction(async (tx) => {
    const { basket, membership } = await requireBasketAction(tx, ctx.userId, bid, "read", true);
    if (READ_ONLY.includes(basket.status)) throw invalid("This basket is read-only.");
    const a = await openAssignment(tx, bid, aid);
    if (a.role === "lead") {
      if (a.userId === ctx.userId) throw forbidden();
      await requireBasketAction(tx, ctx.userId, bid, "assign");
      await requireLeadAuthority(tx, bid, membership);
    } else if (a.userId !== ctx.userId) await requireBasketAction(tx, ctx.userId, bid, "assign");
    await tx.update(basketAssignments).set({ status: "ENDED", endedAt: sql`now()`, endReason: body.reason, updatedAt: sql`now()` }).where(eq(basketAssignments.id, a.id));
    await tx.insert(basketEvents).values({ basketId: bid, assignmentId: a.id, kind: "assignment_ended", actorType: "member", actorUserId: ctx.userId, reason: body.reason, requestId: ctx.meta.requestId });
    await requireReassignmentIfLeaderless(tx, bid, ctx.userId, ctx.meta.requestId);
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "basket.assignment_ended", entityType: "basket_assignment", entityId: a.id, requestId: ctx.meta.requestId, sessionId: ctx.sessionId, metadata: { basketId: bid } });
  });
  await notifyReassignmentRequired(ctx.meta.requestId);
  await enqueue("search-index-refresh", { basketId: bid });
  return getBasketForMember(ctx, bid);
}

/** Ends basket assignments of a membership that can no longer manage baskets (not ACTIVE, or role without baskets.manage). Idempotent; call after any membership status/role write, inside that transaction. Returns the baskets that now need a new lead (the caller emails after commit). */
export async function endIneligibleAssignments(tx: Tx, membershipId: string, requestId: string, actorUserId: string | null): Promise<string[]> {
  const [m] = await tx.select({ status: organizationMemberships.status, role: organizationMemberships.role }).from(organizationMemberships).where(eq(organizationMemberships.id, membershipId));
  if (m && m.status === "ACTIVE" && ROLE_PERMISSIONS[m.role].includes("baskets.manage")) return [];
  const open = await tx.select({ id: basketAssignments.id, basketId: basketAssignments.basketId }).from(basketAssignments)
    .where(and(eq(basketAssignments.membershipId, membershipId), inArray(basketAssignments.status, ["ACTIVE", "PENDING_APPROVAL"]))).orderBy(basketAssignments.basketId);
  const reassign: string[] = [];
  for (const a of open) {
    // Same lock order as every basket writer: the basket row first, then its assignments.
    await tx.select({ id: baskets.id }).from(baskets).where(eq(baskets.id, a.basketId)).for("update");
    const [ended] = await tx.update(basketAssignments).set({ status: "ENDED", endedAt: sql`now()`, endReason: "membership_changed", updatedAt: sql`now()` })
      .where(and(eq(basketAssignments.id, a.id), inArray(basketAssignments.status, ["ACTIVE", "PENDING_APPROVAL"]))).returning({ id: basketAssignments.id });
    if (!ended) continue;
    await tx.insert(basketEvents).values({ basketId: a.basketId, assignmentId: a.id, kind: "assignment_ended", actorType: "system", actorUserId, reason: "membership_changed", requestId });
    if (await requireReassignmentIfLeaderless(tx, a.basketId, actorUserId, requestId)) reassign.push(a.basketId);
    await writeAudit(tx, { actorType: actorUserId ? "user" : "system", actorUserId, action: "basket.assignment_ended", entityType: "basket_assignment", entityId: a.id, requestId, metadata: { basketId: a.basketId } });
  }
  return reassign;
}

/** Emails the basket's active lead(s) and the organization's OWNER (verified email contacts only); a basket email is per event and recipient. Never throws: a committed change is not undone by a notice problem. */
export async function notifyBasket(basketId: string, kind: BasketEmailKind, data: Omit<BasketEmailData, "basketName">, eventId: string): Promise<void> {
  try {
    const [b] = await db.select({ orgId: baskets.organizationId, name: sql<string>`(select v.name from app.basket_versions v where v.basket_id = ${baskets.id} order by v.version_number desc limit 1)` }).from(baskets).where(eq(baskets.id, basketId));
    if (!b) return;
    const recipients = await db.select({ id: contacts.id, email: contacts.value }).from(contacts).where(and(
      eq(contacts.type, "email"), eq(contacts.status, "verified"),
      sql`(exists (select 1 from app.basket_assignments a where a.basket_id = ${basketId} and a.user_id = ${contacts.userId} and a.role = 'lead' and a.status = 'ACTIVE')
        or exists (select 1 from app.organization_memberships m where m.organization_id = ${b.orgId} and m.user_id = ${contacts.userId} and m.role = 'OWNER' and m.status = 'ACTIVE'))`,
    ));
    if (recipients.length === 0) logger.info("basket email skipped: no verified email", { kind });
    for (const r of recipients) await sendBasketEmail(kind, r.email, { ...data, basketName: b.name }, `basket/${eventId}/${r.id}`);
  } catch (err) {
    logger.warn("basket email failed", { kind, error: err instanceof Error ? err.name : "unknown" });
  }
}

/** After commit: emails for the baskets that one request moved to REASSIGNMENT_REQUIRED (the hook runs inside several membership transactions). */
export async function notifyReassignmentRequired(requestId: string): Promise<void> {
  try {
    const events = await db.select({ id: basketEvents.id, basketId: basketEvents.basketId }).from(basketEvents).where(and(eq(basketEvents.kind, "reassignment_required"), eq(basketEvents.requestId, requestId)));
    for (const e of events) {
      await enqueue("search-index-refresh", { basketId: e.basketId });
      await notifyBasket(e.basketId, "reassignment_required", {}, e.id);
    }
  } catch (err) {
    logger.warn("basket email failed", { kind: "reassignment_required", error: err instanceof Error ? err.name : "unknown" });
  }
}

/** Statuses of a published basket that appear in lists; a RETIRED basket is still served by its link. */
export const LISTED_BASKET_STATUSES: readonly BasketStatus[] = ["ACTIVE", "PAUSED", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING"];

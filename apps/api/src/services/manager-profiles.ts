import createHttpError from "http-errors";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  basketAssignments, basketVersions, baskets, contacts, db, isUniqueViolation, managerProfiles, organizationMemberships, organizations,
} from "@repo/db";
import { logger } from "@repo/logger";
import {
  type HideManagerProfileRequest, type ListOpsManagerProfilesQuery, type ListOpsManagerProfilesResponse, type ManagerProfileRequest, type ManagerProfileView, type OwnManagerProfileResponse, type PublicManager,
} from "@repo/validator";
import { sendProfileEmail, type ProfileEmailKind } from "../providers/resend";
import { enqueue } from "../queues";
import { cursorSchema, type OpsCtx } from "./applications";
import { writeAudit } from "./audit";
import { orgDisplayName } from "./members";
import { PAGE_SIZE } from "./organization-review";
import { LISTED_BASKET_STATUSES } from "./public-baskets";

type ProfileRow = typeof managerProfiles.$inferSelect;
const iso = (d: Date | null) => d?.toISOString() ?? null;
const notFound = () => createHttpError("Profile not found", { code: "NOT_FOUND" });

const view = (p: ProfileRow): ManagerProfileView => ({
  handle: p.handle, displayName: p.displayName, headline: p.headline, bio: p.bio, experienceYears: p.experienceYears, background: p.background, qualifications: p.qualifications, links: p.links,
  status: p.status, hiddenReason: p.hiddenReason, publishedAt: iso(p.publishedAt), updatedAt: p.updatedAt.toISOString(),
});

/** The profile feeds the manager fields of every basket its owner actively manages. */
const refreshManagedBaskets = async (userId: string): Promise<void> => {
  const rows = await db.selectDistinct({ basketId: basketAssignments.basketId }).from(basketAssignments).where(and(eq(basketAssignments.userId, userId), eq(basketAssignments.status, "ACTIVE")));
  for (const r of rows) await enqueue("search-index-refresh", { basketId: r.basketId });
};

export async function getOwnProfile(userId: string): Promise<OwnManagerProfileResponse> {
  const [p] = await db.select().from(managerProfiles).where(eq(managerProfiles.userId, userId));
  return { profile: p ? view(p) : null };
}

/** Creates or replaces the caller's profile (new ones start as a draft; the status never changes here). A taken handle is 409 HANDLE_TAKEN. */
export async function saveOwnProfile(userId: string, body: ManagerProfileRequest): Promise<OwnManagerProfileResponse> {
  const fields = {
    handle: body.handle, displayName: body.displayName, headline: body.headline ?? null, bio: body.bio ?? null, experienceYears: body.experienceYears ?? null,
    background: body.background ?? null, qualifications: body.qualifications ?? [], links: body.links ?? [],
  };
  try {
    const [p] = await db.insert(managerProfiles).values({ userId, ...fields }).onConflictDoUpdate({ target: managerProfiles.userId, set: { ...fields, updatedAt: sql`now()` } }).returning();
    if (p!.status === "published") await refreshManagedBaskets(userId);
    return { profile: view(p!) };
  } catch (err) {
    throw isUniqueViolation(err) ? createHttpError("That handle is taken.", { code: "HANDLE_TAKEN" }) : err;
  }
}

/** Publish and unpublish are idempotent; a hidden profile can be neither (409). */
export async function setOwnProfilePublished(ctx: { userId: string; sessionId: string; requestId: string }, publish: boolean): Promise<OwnManagerProfileResponse> {
  const p = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(managerProfiles).where(eq(managerProfiles.userId, ctx.userId)).for("update");
    if (!row) throw notFound();
    if (row.status === "hidden") throw createHttpError("This profile was hidden by the Bytesac team.", { code: "INVALID_TRANSITION" });
    if ((row.status === "published") === publish) return row;
    const [updated] = await tx.update(managerProfiles).set({ status: publish ? "published" : "draft", publishedAt: publish ? sql`now()` : row.publishedAt, updatedAt: sql`now()` })
      .where(eq(managerProfiles.id, row.id)).returning();
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: publish ? "manager_profile.published" : "manager_profile.unpublished", entityType: "manager_profile", entityId: row.id, requestId: ctx.requestId, sessionId: ctx.sessionId });
    return updated!;
  });
  await refreshManagedBaskets(ctx.userId);
  return { profile: view(p) };
}

/** Published profiles only. Self-reported claims are labelled; `verified` comes only from an ACTIVE membership with an approved member verification, or ACTIVE ownership of a VERIFIED organization. */
export async function getPublicManager(handle: string): Promise<PublicManager> {
  const [p] = await db.select({
    profile: managerProfiles,
    // `manager_profiles.user_id` is written out: a single-table select renders column references unqualified, which would bind to the subquery.
    verified: sql<boolean>`(exists (select 1 from app.member_verifications mv join app.organization_memberships m on m.id = mv.membership_id where m.user_id = manager_profiles.user_id and m.status = 'ACTIVE' and mv.status = 'approved')
      or exists (select 1 from app.organization_memberships m join app.organizations o on o.id = m.organization_id where m.user_id = manager_profiles.user_id and m.role = 'OWNER' and m.status = 'ACTIVE' and o.status = 'VERIFIED'))`,
  }).from(managerProfiles).where(and(eq(managerProfiles.handle, handle), eq(managerProfiles.status, "published")));
  if (!p) throw notFound();
  const userId = p.profile.userId;
  const managed = await db.select({ slug: baskets.slug, name: basketVersions.name, status: baskets.status, role: basketAssignments.role, from: basketAssignments.startedAt, to: basketAssignments.endedAt })
    .from(basketAssignments).innerJoin(baskets, eq(baskets.id, basketAssignments.basketId)).innerJoin(basketVersions, eq(basketVersions.id, baskets.currentVersionId))
    .where(and(eq(basketAssignments.userId, userId), isNotNull(basketAssignments.startedAt), inArray(baskets.status, [...LISTED_BASKET_STATUSES, "RETIRED"]))).orderBy(desc(basketAssignments.startedAt), basketAssignments.id);
  // Only memberships that opted in to a public name appear, in VERIFIED organizations (the same rule as the organization's public team list).
  const memberships = await db.select({
    organizationId: organizations.id, organizationName: orgDisplayName, role: organizationMemberships.role, title: organizationMemberships.publicTitle, status: organizationMemberships.status,
    from: organizationMemberships.activatedAt, to: organizationMemberships.leftAt, updatedAt: organizationMemberships.updatedAt,
  }).from(organizationMemberships).innerJoin(organizations, eq(organizations.id, organizationMemberships.organizationId))
    .where(and(eq(organizationMemberships.userId, userId), isNotNull(organizationMemberships.publicDisplayName), eq(organizations.status, "VERIFIED"),
      or(eq(organizationMemberships.status, "ACTIVE"), and(eq(organizationMemberships.status, "REVOKED"), isNotNull(organizationMemberships.activatedAt)))))
    .orderBy(desc(organizationMemberships.activatedAt), organizationMemberships.id);
  return {
    ...view(p.profile), selfReported: ["experienceYears", "qualifications"], verified: p.verified,
    baskets: managed.map((m) => ({ slug: m.slug, name: m.name, status: m.status, role: m.role, from: m.from!.toISOString(), to: iso(m.to) })),
    organizations: memberships.map((m) => ({
      organizationId: m.organizationId, organizationName: m.organizationName, role: m.role, title: m.title, current: m.status === "ACTIVE", from: m.from!.toISOString(), to: m.status === "ACTIVE" ? null : (m.to ?? m.updatedAt).toISOString(),
    })),
  };
}

export async function listProfilesForOps(q: ListOpsManagerProfilesQuery): Promise<ListOpsManagerProfilesResponse> {
  const conditions = [q.status ? eq(managerProfiles.status, q.status) : undefined];
  if (q.cursor) {
    const parsed = cursorSchema.safeParse(Buffer.from(q.cursor, "base64url").toString().split("|"));
    if (!parsed.success) throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    conditions.push(sql`(${managerProfiles.updatedAt}, ${managerProfiles.id}) < (${parsed.data[0]}::timestamptz, ${parsed.data[1]}::uuid)`);
  }
  const rows = await db.select({ p: managerProfiles, cursorTs: sql<string>`${managerProfiles.updatedAt}::text` }).from(managerProfiles).where(and(...conditions))
    .orderBy(desc(managerProfiles.updatedAt), desc(managerProfiles.id)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map(({ p }) => ({ id: p.id, handle: p.handle, displayName: p.displayName, status: p.status, hiddenReason: p.hiddenReason, publishedAt: iso(p.publishedAt), updatedAt: p.updatedAt.toISOString() })),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(`${last.cursorTs}|${last.p.id}`).toString("base64url") : null,
  };
}

/**
 * Hide moves any non-hidden profile to `hidden` (the owner can no longer publish it); unhide returns it to `draft`, so the owner publishes again on purpose.
 * Audited; the owner is emailed after commit and the baskets they manage are re-indexed.
 */
async function moderate(ctx: OpsCtx, id: string, hide: boolean, reason?: string): Promise<ManagerProfileView> {
  const p = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(managerProfiles).where(eq(managerProfiles.id, id)).for("update");
    if (!row) throw notFound();
    if ((row.status === "hidden") === hide) throw createHttpError(hide ? "This profile is already hidden." : "This profile is not hidden.", { code: "INVALID_TRANSITION" });
    const [updated] = await tx.update(managerProfiles).set(hide
      ? { status: "hidden", hiddenReason: reason, hiddenByUserId: ctx.userId, updatedAt: sql`now()` }
      : { status: "draft", hiddenReason: null, hiddenByUserId: null, updatedAt: sql`now()` }).where(eq(managerProfiles.id, id)).returning();
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: hide ? "manager_profile.hidden" : "manager_profile.unhidden", entityType: "manager_profile", entityId: id, requestId: ctx.meta.requestId,
      metadata: { from: row.status, reason },
    });
    return updated!;
  });
  await refreshManagedBaskets(p.userId);
  try {
    const kind: ProfileEmailKind = hide ? "hidden" : "unhidden";
    const [email] = await db.select({ id: contacts.id, value: contacts.value }).from(contacts).where(and(eq(contacts.userId, p.userId), eq(contacts.type, "email"), eq(contacts.status, "verified")));
    if (email) await sendProfileEmail(kind, email.value, { message: reason }, `profile/${id}/${kind}/${p.updatedAt.getTime()}`);
  } catch (err) {
    logger.warn("profile email failed", { error: err instanceof Error ? err.name : "unknown" });
  }
  return view(p);
}

export const hideProfile = (ctx: OpsCtx, id: string, body: HideManagerProfileRequest) => moderate(ctx, id, true, body.reason);
export const unhideProfile = (ctx: OpsCtx, id: string) => moderate(ctx, id, false);

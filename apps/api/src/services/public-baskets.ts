import createHttpError from "http-errors";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import {
  assetTags, basketAssignments, basketPerformanceDays, basketSlugAliases, basketVersionAssets, basketVersions, baskets, db, instrumentTags, instruments, managerProfiles, organizationMemberships, organizations,
} from "@repo/db";
import { basketConstraintsSchema, basketFeesSchema, PERFORMANCE_LABEL, performanceMetrics, type BasketStatus, type PublicBasketListResponse, type PublicBasketResponse } from "@repo/validator";
import { cursorSchema } from "./applications";
import { currentDisclosures, versionDiff } from "./baskets";
import { orgDisplayName } from "./members";
import { PAGE_SIZE } from "./organization-review";
import { getPrices } from "./pricing";

/** Statuses of a published basket that appear in lists; a RETIRED basket is still served by its link. */
export const LISTED_BASKET_STATUSES: readonly BasketStatus[] = ["ACTIVE", "PAUSED", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING"];

export async function listPublicBaskets(q: { cursor?: string }): Promise<PublicBasketListResponse> {
  const conditions = [inArray(baskets.status, [...LISTED_BASKET_STATUSES]), isNotNull(baskets.currentVersionId)];
  if (q.cursor) {
    const parsed = cursorSchema.safeParse(Buffer.from(q.cursor, "base64url").toString().split("|"));
    if (!parsed.success) throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    conditions.push(sql`(${basketVersions.publishedAt}, ${baskets.id}) < (${parsed.data[0]}::timestamptz, ${parsed.data[1]}::uuid)`);
  }
  const rows = await db.select({
    id: baskets.id, slug: baskets.slug, status: baskets.status, name: basketVersions.name, shortDescription: basketVersions.shortDescription, category: basketVersions.category,
    minimumInvestmentUsdc: basketVersions.minimumInvestmentUsdc, publishedAt: basketVersions.publishedAt, organizationName: orgDisplayName, cursorTs: sql<string>`${basketVersions.publishedAt}::text`,
    assetCount: sql<number>`(select count(*)::int from app.basket_version_assets a where a.version_id = ${basketVersions.id} and a.revision = ${basketVersions.assetsRevision})`,
  }).from(baskets).innerJoin(basketVersions, eq(basketVersions.id, baskets.currentVersionId)).innerJoin(organizations, eq(organizations.id, baskets.organizationId))
    .where(and(...conditions)).orderBy(desc(basketVersions.publishedAt), desc(baskets.id)).limit(PAGE_SIZE + 1);
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    items: page.map((r) => ({
      slug: r.slug, name: r.name, shortDescription: r.shortDescription, organizationName: r.organizationName, category: r.category, assetCount: r.assetCount,
      minimumInvestmentUsdc: r.minimumInvestmentUsdc, status: r.status, publishedAt: r.publishedAt!.toISOString(),
    })),
    nextCursor: rows.length > PAGE_SIZE && last ? Buffer.from(`${last.cursorTs}|${last.id}`).toString("base64url") : null,
  };
}

/**
 * The current published version only, built from an explicit select list (no row is passed through). An old slug answers `{ redirectTo }`;
 * a basket that was never published, was rejected or does not exist is a 404. A RETIRED basket is served.
 */
export async function getPublicBasket(slug: string): Promise<PublicBasketResponse> {
  const notFound = () => createHttpError("Basket not found", { code: "NOT_FOUND" });
  const [b] = await db.select({ id: baskets.id, slug: baskets.slug, status: baskets.status, organizationId: baskets.organizationId, currentVersionId: baskets.currentVersionId, orgName: orgDisplayName })
    .from(baskets).innerJoin(organizations, eq(organizations.id, baskets.organizationId)).where(eq(baskets.slug, slug));
  if (!b) {
    const [alias] = await db.select({ slug: baskets.slug, currentVersionId: baskets.currentVersionId }).from(basketSlugAliases).innerJoin(baskets, eq(baskets.id, basketSlugAliases.basketId)).where(eq(basketSlugAliases.slug, slug));
    if (!alias?.currentVersionId) throw notFound();
    return { redirectTo: alias.slug };
  }
  if (!b.currentVersionId) throw notFound();
  const [v] = await db.select().from(basketVersions).where(eq(basketVersions.id, b.currentVersionId));
  const assets = await db.select({
    instrumentId: instruments.id, name: instruments.name, symbol: instruments.symbol, assetType: instruments.assetType, instrumentStatus: instruments.status, sector: instruments.sector,
    targetWeightBps: basketVersionAssets.targetWeightBps, minWeightBps: basketVersionAssets.minWeightBps, maxWeightBps: basketVersionAssets.maxWeightBps,
    chains: sql<string[]>`coalesce((select array_agg(distinct d.chain::text order by d.chain::text) from app.instrument_deployments d where d.instrument_id = ${instruments.id} and d.status = 'ACTIVE'), '{}')`,
  }).from(basketVersionAssets).innerJoin(instruments, eq(instruments.id, basketVersionAssets.instrumentId))
    .where(and(eq(basketVersionAssets.versionId, v!.id), eq(basketVersionAssets.revision, v!.assetsRevision))).orderBy(desc(basketVersionAssets.targetWeightBps), asc(instruments.id));
  const prices = await getPrices(assets.map((a) => a.instrumentId));
  const history = await db.select().from(basketVersions).where(and(eq(basketVersions.basketId, b.id), inArray(basketVersions.status, ["published", "superseded"]))).orderBy(desc(basketVersions.versionNumber));
  // Opted-in public names only; a member who did not opt in is "Team member". Assignments that never became ACTIVE are not history.
  // A published manager profile supplies the name and handle; a hidden or unpublished one falls back to the opt-in name.
  const managers = await db.select({ name: sql<string | null>`coalesce(${managerProfiles.displayName}, ${organizationMemberships.publicDisplayName})`, handle: managerProfiles.handle, role: basketAssignments.role, from: basketAssignments.startedAt, to: basketAssignments.endedAt })
    .from(basketAssignments).innerJoin(organizationMemberships, eq(organizationMemberships.id, basketAssignments.membershipId))
    .leftJoin(managerProfiles, and(eq(managerProfiles.userId, basketAssignments.userId), eq(managerProfiles.status, "published")))
    .where(and(eq(basketAssignments.basketId, b.id), isNotNull(basketAssignments.startedAt))).orderBy(basketAssignments.startedAt, basketAssignments.id);
  const days = await db.select({ day: basketPerformanceDays.day, indexGross: basketPerformanceDays.indexGross, indexNet: basketPerformanceDays.indexNet, holdings: basketPerformanceDays.holdings })
    .from(basketPerformanceDays).where(eq(basketPerformanceDays.basketId, b.id)).orderBy(asc(basketPerformanceDays.day));
  const metrics = performanceMetrics(days.map((d) => ({ day: d.day, indexGross: d.indexGross, indexNet: d.indexNet, gapRun: d.holdings.gapRun })), new Date().toISOString().slice(0, 10));
  const step = Math.ceil(days.length / 399) || 1;
  const series = days.filter((_, i) => i % step === 0 || i === days.length - 1).map((d) => ({ day: d.day, net: d.indexNet, gross: d.indexGross }));
  const sectors = new Map<string, number>();
  for (const a of assets) sectors.set(a.sector, (sectors.get(a.sector) ?? 0) + a.targetWeightBps);
  const tags = await db.selectDistinct({ key: assetTags.key, label: assetTags.label }).from(instrumentTags).innerJoin(assetTags, eq(assetTags.id, instrumentTags.tagId))
    .where(and(inArray(instrumentTags.instrumentId, assets.map((a) => a.instrumentId)), isNull(instrumentTags.removedAt), eq(assetTags.status, "active"))).orderBy(assetTags.key);
  return {
    performance: { available: metrics.available, dataDays: metrics.dataDays, series }, metrics, label: PERFORMANCE_LABEL, tags,
    sectors: [...sectors].map(([sector, bps]) => ({ sector: sector as (typeof assets)[number]["sector"], bps })),
    slug: b.slug, status: b.status, hasAssetWarning: assets.some((a) => a.instrumentStatus === "PAUSED" || a.instrumentStatus === "DEPRECATED"),
    organization: { id: b.organizationId, displayName: b.orgName },
    version: {
      versionNumber: v!.versionNumber, publishedAt: v!.publishedAt!.toISOString(), name: v!.name, shortDescription: v!.shortDescription, longDescription: v!.longDescription, category: v!.category, tags: v!.tags,
      objective: v!.objective, thesis: v!.thesis, methodology: v!.methodology, intendedInvestor: v!.intendedInvestor, horizon: v!.horizon, keyAssumptions: v!.keyAssumptions,
      knownLimitations: v!.knownLimitations, strategyRisks: v!.strategyRisks, liquidityNotes: v!.liquidityNotes, conflictsOfInterest: v!.conflictsOfInterest,
      constraints: basketConstraintsSchema.parse(v!.constraints), rebalance: v!.rebalance, fees: basketFeesSchema.parse(v!.fees), minimumInvestmentUsdc: v!.minimumInvestmentUsdc, minimumIncrementUsdc: v!.minimumIncrementUsdc,
    },
    allocation: assets.map(({ instrumentStatus: _status, sector: _sector, ...a }) => ({ ...a, prices: prices.filter((p) => p.instrumentId === a.instrumentId) })),
    disclosures: (await currentDisclosures(db, v!)).map((d) => ({ title: d.title, body: d.body })),
  // ponytail: one diff query set per published version on every page view; cache or precompute at publish if histories grow.
    versionHistory: await Promise.all(history.map(async (h) => ({ versionNumber: h.versionNumber, publishedAt: h.publishedAt!.toISOString(), rationale: h.rationale, diff: await versionDiff(db, h) }))),
    managers: managers.map((m) => ({ displayName: m.name ?? "Team member", handle: m.handle, role: m.role, from: m.from!.toISOString(), to: m.to?.toISOString() ?? null })),
  };
}

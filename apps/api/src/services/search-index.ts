import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  assetTags, basketAssignments, basketPerformanceDays, basketSearchIndex, basketVersionAssets, basketVersions, baskets, db, instrumentTags, instruments, managerProfiles, organizations,
} from "@repo/db";
import { basketFeesSchema, effectiveFeeBps, performanceMetrics } from "@repo/validator";
import { env } from "../env";
import { embedText } from "../providers/gemini";
import { enqueue } from "../queues";
import { orgDisplayName } from "./members";
import { LISTED_BASKET_STATUSES } from "./public-baskets";

const MAX_EMBEDDING_ATTEMPTS = 5;

/**
 * Rebuilds the derived search row of one basket from its current published version. A basket that is no longer listed keeps its row with the new
 * status (queries exclude it); one that was never published has no row. A new published version sets the embedding back to `pending`.
 */
export async function refreshSearchIndex(basketId: string): Promise<void> {
  const [b] = await db.select({ status: baskets.status, slug: baskets.slug, organizationId: baskets.organizationId, currentVersionId: baskets.currentVersionId, orgName: orgDisplayName })
    .from(baskets).innerJoin(organizations, eq(organizations.id, baskets.organizationId)).where(eq(baskets.id, basketId));
  if (!b?.currentVersionId) return;
  if (!LISTED_BASKET_STATUSES.includes(b.status)) {
    await db.update(basketSearchIndex).set({ status: b.status, updatedAt: sql`now()` }).where(eq(basketSearchIndex.basketId, basketId));
    return;
  }
  const [v] = await db.select().from(basketVersions).where(eq(basketVersions.id, b.currentVersionId));
  const [prior] = await db.select({ versionId: basketSearchIndex.currentVersionId }).from(basketSearchIndex).where(eq(basketSearchIndex.basketId, basketId));
  const assets = await db.select({ id: instruments.id, symbol: instruments.symbol, name: instruments.name, assetType: instruments.assetType, sector: instruments.sector, bps: basketVersionAssets.targetWeightBps })
    .from(basketVersionAssets).innerJoin(instruments, eq(instruments.id, basketVersionAssets.instrumentId))
    .where(and(eq(basketVersionAssets.versionId, v!.id), eq(basketVersionAssets.revision, v!.assetsRevision))).orderBy(desc(basketVersionAssets.targetWeightBps), asc(instruments.id));
  const tags = await db.selectDistinct({ key: assetTags.key }).from(instrumentTags).innerJoin(assetTags, eq(assetTags.id, instrumentTags.tagId))
    .where(and(inArray(instrumentTags.instrumentId, assets.map((a) => a.id)), isNull(instrumentTags.removedAt), eq(assetTags.status, "active")));
  const managers = await db.select({ handle: managerProfiles.handle, experienceYears: managerProfiles.experienceYears }).from(basketAssignments)
    .innerJoin(managerProfiles, and(eq(managerProfiles.userId, basketAssignments.userId), eq(managerProfiles.status, "published")))
    .where(and(eq(basketAssignments.basketId, basketId), eq(basketAssignments.status, "ACTIVE")));
  const days = await db.select().from(basketPerformanceDays).where(eq(basketPerformanceDays.basketId, basketId)).orderBy(asc(basketPerformanceDays.day));
  const metrics = performanceMetrics(days.map((d) => ({ day: d.day, indexGross: d.indexGross, indexNet: d.indexNet, gapRun: d.holdings.gapRun })), new Date().toISOString().slice(0, 10));
  const fees = basketFeesSchema.parse(v!.fees);
  const minimum = v!.minimumInvestmentUsdc!;
  const group = <K extends string>(key: (a: (typeof assets)[number]) => string, name: K) => {
    const sums = new Map<string, number>();
    for (const a of assets) sums.set(key(a), (sums.get(key(a)) ?? 0) + a.bps);
    return [...sums].map(([k, bps]) => ({ [name]: k, bps }) as { [P in K]: string } & { bps: number });
  };
  const row = {
    organizationId: b.organizationId, organizationName: b.orgName ?? "Organization", slug: b.slug, status: b.status, category: v!.category, name: v!.name, shortDescription: v!.shortDescription,
    exposures: { instruments: assets.map((a) => ({ id: a.id, symbol: a.symbol, bps: a.bps })), assetTypes: group((a) => a.assetType, "type"), sectors: group((a) => a.sector, "sector") },
    tags: tags.map((t) => t.key).sort(), maxWeightBps: Math.max(...assets.map((a) => a.bps)), minimumInvestmentUsdc: minimum,
    feeEntryBps: effectiveFeeBps(fees.entry, minimum), feeManagementBps: effectiveFeeBps(fees.management, minimum), feeRebalanceBps: effectiveFeeBps(fees.rebalance, minimum),
    feeSubscriptionBps: fees.subscription ? effectiveFeeBps(fees.subscription, minimum) : null, reviewFrequency: v!.rebalance.reviewFrequency, publishedAt: v!.publishedAt!, currentVersionId: v!.id,
    managerHandles: managers.map((m) => m.handle).sort(), managerMaxExperienceYears: managers.reduce<number | null>((max, m) => (m.experienceYears === null ? max : Math.max(max ?? 0, m.experienceYears)), null),
    metrics,
    searchText: sql<string>`setweight(to_tsvector('english', ${v!.name}::text), 'A') || setweight(to_tsvector('english', ${[v!.shortDescription, v!.category].filter(Boolean).join(" ")}::text), 'B')
      || setweight(to_tsvector('english', ${[v!.thesis, v!.methodology, ...assets.map((a) => a.name)].filter(Boolean).join(" ")}::text), 'C')`,
    updatedAt: sql<Date>`now()`,
  };
  await db.insert(basketSearchIndex).values({ basketId, ...row }).onConflictDoUpdate({
    target: basketSearchIndex.basketId,
    set: {
      ...row,
      embeddingStatus: sql`case when ${basketSearchIndex.currentVersionId} <> ${v!.id} then 'pending'::app.embedding_status else ${basketSearchIndex.embeddingStatus} end`,
      embeddingAttempts: sql`case when ${basketSearchIndex.currentVersionId} <> ${v!.id} then 0 else ${basketSearchIndex.embeddingAttempts} end`,
    },
  });
  // Queued here rather than at publish so the row always exists when the embed job runs.
  if (prior?.versionId !== v!.id) await enqueue("embed-basket", { basketId, versionId: v!.id });
}

/**
 * Embeds one basket's current version (spec §6 text) and marks it `ready`. Without a key nothing is called and the row stays `pending`; a failure marks
 * it `failed`, counts the attempt and rethrows so BullMQ retries. A vector for an older version is never written over a newer one.
 */
export async function embedBasket(basketId: string): Promise<void> {
  if (!env.GEMINI_API_KEY) return;
  const [row] = await db.select({
    versionId: basketSearchIndex.currentVersionId, category: basketSearchIndex.category, exposures: basketSearchIndex.exposures, tags: basketSearchIndex.tags,
    name: basketVersions.name, shortDescription: basketVersions.shortDescription, longDescription: basketVersions.longDescription, thesis: basketVersions.thesis, methodology: basketVersions.methodology,
  }).from(basketSearchIndex).innerJoin(basketVersions, eq(basketVersions.id, basketSearchIndex.currentVersionId)).where(eq(basketSearchIndex.basketId, basketId));
  if (!row) return;
  const names = await db.select({ name: instruments.name }).from(instruments).where(inArray(instruments.id, row.exposures.instruments.map((i) => i.id)));
  const text = [row.name, row.shortDescription, row.longDescription, row.thesis, row.methodology, row.category, ...names.map((n) => n.name), ...row.exposures.sectors.map((s) => s.sector), ...row.tags]
    .filter(Boolean).join("\n");
  const where = and(eq(basketSearchIndex.basketId, basketId), eq(basketSearchIndex.currentVersionId, row.versionId));
  try {
    await db.update(basketSearchIndex).set({ embedding: await embedText(text), embeddingStatus: "ready" }).where(where);
  } catch (err) {
    await db.update(basketSearchIndex).set({ embeddingStatus: "failed", embeddingAttempts: sql`${basketSearchIndex.embeddingAttempts} + 1` }).where(where);
    throw err;
  }
}

/** Every 15 minutes: queues the listed baskets whose embedding is `pending` or `failed` with fewer than 5 attempts. */
export async function sweepEmbeddings(): Promise<void> {
  if (!env.GEMINI_API_KEY) return;
  const rows = await db.select({ basketId: basketSearchIndex.basketId, versionId: basketSearchIndex.currentVersionId, attempt: basketSearchIndex.embeddingAttempts }).from(basketSearchIndex)
    .where(and(inArray(basketSearchIndex.status, [...LISTED_BASKET_STATUSES]), or(eq(basketSearchIndex.embeddingStatus, "pending"), eq(basketSearchIndex.embeddingStatus, "failed")), lt(basketSearchIndex.embeddingAttempts, MAX_EMBEDDING_ATTEMPTS)));
  for (const r of rows) await enqueue("embed-basket", r);
}

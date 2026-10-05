import createHttpError from "http-errors";
import { and, asc, desc, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { basketPositions, baskets, basketSearchIndex as idx, db } from "@repo/db";
import type { DiscoveryCollectionsResponse, SetBasketFeaturedRequest, SuggestedBasketsResponse } from "@repo/validator";
import { writeAudit } from "@/modules/audit/audit.service";
import type { OpsCtx } from "@/modules/manager-applications/applications.service";
import { columns, toItem } from "./discovery.service";

const RAIL_SIZE = 12;
/** Same threshold the manager adoption view masks below: fewer investors than this is never surfaced. */
export const TRENDING_MIN_INVESTORS = 5;
const TRENDING_WINDOW_DAYS = 30;

/** Rails show investable baskets only (paused or retiring baskets stay findable through search). */
const investable = eq(idx.status, "ACTIVE");

/** Featured (ops-curated, by rank) and trending (distinct new investors in 30 days, ≥ 5; counts are never returned). */
export async function collections(): Promise<DiscoveryCollectionsResponse> {
  const featured = await db.select(columns).from(idx).innerJoin(baskets, eq(baskets.id, idx.basketId))
    .where(and(investable, isNotNull(baskets.featuredRank))).orderBy(asc(baskets.featuredRank), desc(idx.publishedAt)).limit(RAIL_SIZE);

  const recent = db.select({ basketId: basketPositions.basketId, investors: sql<number>`count(distinct ${basketPositions.userId})`.as("investors") })
    .from(basketPositions).where(sql`${basketPositions.openedAt} > now() - make_interval(days => ${TRENDING_WINDOW_DAYS})`)
    .groupBy(basketPositions.basketId).having(sql`count(distinct ${basketPositions.userId}) >= ${TRENDING_MIN_INVESTORS}`).as("recent");
  const trending = await db.select(columns).from(idx).innerJoin(recent, eq(recent.basketId, idx.basketId))
    .where(investable).orderBy(desc(recent.investors), desc(idx.publishedAt)).limit(RAIL_SIZE);

  return { featured: featured.map(toItem), trending: trending.map(toItem) };
}

/** Investable baskets in the categories the user already holds (excluding those baskets); newest baskets when there is no basis. */
export async function suggested(userId: string): Promise<SuggestedBasketsResponse> {
  const held = await db.select({ basketId: basketPositions.basketId, category: idx.category }).from(basketPositions)
    .innerJoin(idx, eq(idx.basketId, basketPositions.basketId)).where(and(eq(basketPositions.userId, userId), eq(basketPositions.status, "OPEN")));
  const heldIds = held.map((h) => h.basketId);
  const notHeld = heldIds.length ? notInArray(idx.basketId, heldIds) : undefined;
  const categories = [...new Set(held.map((h) => h.category))];
  if (categories.length) {
    const rows = await db.select(columns).from(idx).where(and(investable, notHeld, inArray(idx.category, categories))).orderBy(desc(idx.publishedAt)).limit(RAIL_SIZE);
    if (rows.length) return { items: rows.map(toItem), basis: "your_categories" };
  }
  const rows = await db.select(columns).from(idx).where(and(investable, notHeld)).orderBy(desc(idx.publishedAt)).limit(RAIL_SIZE);
  return { items: rows.map(toItem), basis: "newest" };
}

/** Sets or clears a basket's place in the Featured rail. Only listed, active baskets can be featured; clearing always works. */
export async function setFeatured(ctx: OpsCtx, basketId: string, body: SetBasketFeaturedRequest): Promise<{ basketId: string; rank: number | null }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ id: baskets.id, status: baskets.status, rank: baskets.featuredRank }).from(baskets).where(eq(baskets.id, basketId)).for("update");
    if (!row) throw createHttpError("Basket not found", { code: "NOT_FOUND" });
    if (body.rank !== null && row.status !== "ACTIVE") throw createHttpError("Only active baskets can be featured.", { code: "INVALID_TRANSITION" });
    await tx.update(baskets).set({ featuredRank: body.rank, featuredAt: body.rank === null ? null : sql`now()` }).where(eq(baskets.id, basketId));
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, action: body.rank === null ? "basket.unfeatured" : "basket.featured", entityType: "basket", entityId: basketId, requestId: ctx.meta.requestId,
      metadata: { from: row.rank, to: body.rank },
    });
    return { basketId, rank: body.rank };
  });
}

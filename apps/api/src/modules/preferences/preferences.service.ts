import createHttpError from "http-errors";
import { db, notificationPreferences } from "@repo/db";
import type { NotificationPreferences } from "@repo/validator";
import { eq, sql } from "drizzle-orm";
import { writeAudit } from "@/modules/audit/audit.service";

const pick = (r: typeof notificationPreferences.$inferSelect): NotificationPreferences => ({
  rebalance: r.rebalance, portfolioUpdates: r.portfolioUpdates, managerUpdates: r.managerUpdates,
  offers: r.offers, productUpdates: r.productUpdates, marketing: r.marketing,
});
const notFound = () => createHttpError("Preferences not found", { code: "NOT_FOUND" });

export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
  if (!row) throw notFound();
  return pick(row);
}

export async function updatePreferences(auth: { userId: string; sessionId: string }, requestId: string, patch: NotificationPreferences): Promise<NotificationPreferences> {
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(notificationPreferences).set({ ...patch, updatedAt: sql`now()` })
      .where(eq(notificationPreferences.userId, auth.userId)).returning();
    if (!updated) throw notFound();
    await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "notification_preferences.updated", entityType: "user", entityId: auth.userId, requestId, sessionId: auth.sessionId, metadata: { changed: patch } });
    return updated;
  });
  return pick(row);
}

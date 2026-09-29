import { db, notificationPreferences } from "@repo/db";
import { updateNotificationPreferencesSchema, type NotificationPreferences } from "@repo/validator";
import { eq, sql } from "drizzle-orm";
import createHttpError from "http-errors";
import { Router } from "express";
import { requireSession } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { writeAudit } from "../services/audit";

const pick = (r: typeof notificationPreferences.$inferSelect): NotificationPreferences => ({
  rebalance: r.rebalance, portfolioUpdates: r.portfolioUpdates, managerUpdates: r.managerUpdates,
  offers: r.offers, productUpdates: r.productUpdates, marketing: r.marketing,
});
const notFound = () => createHttpError(404, "Preferences not found", { code: "NOT_FOUND" });

export const preferencesRouter = Router();
preferencesRouter.use(requireSession);

preferencesRouter.get("/", async (req, res) => {
  const [row] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, req.auth!.userId));
  if (!row) throw notFound();
  res.json(pick(row));
});

preferencesRouter.patch("/", validate({ body: updateNotificationPreferencesSchema }), async (req, res) => {
  const patch = req.body as NotificationPreferences;
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(notificationPreferences).set({ ...patch, updatedAt: sql`now()` })
      .where(eq(notificationPreferences.userId, req.auth!.userId)).returning();
    if (!updated) throw notFound();
    await writeAudit(tx, { actorType: "user", actorUserId: req.auth!.userId, action: "notification_preferences.updated", entityType: "user", entityId: req.auth!.userId, requestId: req.ctx.requestId, sessionId: req.auth!.sessionId, metadata: { changed: patch } });
    return updated;
  });
  res.json(pick(row));
});

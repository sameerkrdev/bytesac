import { updateNotificationPreferencesSchema, type NotificationPreferences } from "@repo/contracts";
import { eq, sql } from "drizzle-orm";
import { Router } from "express";
import type { AppDeps } from "../../../deps.js";
import { notificationPreferences } from "../../../db/schema/index.js";
import { writeAudit } from "../../../shared/audit.js";
import { DomainError } from "../../../shared/errors.js";
import { parseOrThrow } from "../../../shared/validate.js";
import { requireSession } from "../../identity/http/require-session.js";

const pick = (r: typeof notificationPreferences.$inferSelect): NotificationPreferences => ({
  rebalance: r.rebalance, portfolioUpdates: r.portfolioUpdates, managerUpdates: r.managerUpdates,
  offers: r.offers, productUpdates: r.productUpdates, marketing: r.marketing,
});

export function preferencesRouter(deps: AppDeps): Router {
  const r = Router();
  r.use(requireSession(deps));

  r.get("/", async (req, res) => {
    const [row] = await deps.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, req.auth!.userId));
    if (!row) throw new DomainError("NOT_FOUND", "Preferences not found");
    res.json(pick(row));
  });

  r.patch("/", async (req, res) => {
    const patch = parseOrThrow(updateNotificationPreferencesSchema, req.body);
    const row = await deps.db.transaction(async (tx) => {
      const [updated] = await tx.update(notificationPreferences).set({ ...patch, updatedAt: sql`now()` })
        .where(eq(notificationPreferences.userId, req.auth!.userId)).returning();
      if (!updated) throw new DomainError("NOT_FOUND", "Preferences not found");
      await writeAudit(tx, { actorType: "user", actorUserId: req.auth!.userId, action: "notification_preferences.updated", entityType: "user", entityId: req.auth!.userId, requestId: req.ctx.requestId, sessionId: req.auth!.sessionId, metadata: { changed: patch } });
      return updated;
    });
    res.json(pick(row));
  });

  return r;
}

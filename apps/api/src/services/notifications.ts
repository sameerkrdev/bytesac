import createHttpError from "http-errors";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { basketPositions, baskets, contacts, db, notificationPreferences, notifications, pushTokens, type DbOrTx } from "@repo/db";
import { logger } from "@repo/logger";
import {
  notificationText, type Adoption, type NotificationKind, type NotificationPreferences, type NotificationsPage,
} from "@repo/validator";
import { env } from "../env";
import { sendPush } from "../providers/fcm";
import { sendNotificationEmail } from "../providers/resend";
import { enqueue } from "../queues";

/** Which of the user's preferences gates the email and push of a kind (the inbox row is always written). */
const PREFERENCE: Record<NotificationKind, keyof NotificationPreferences> = {
  rebalance_available: "rebalance", drifted: "portfolioUpdates", repair_required: "portfolioUpdates", execution_incomplete: "portfolioUpdates",
  basket_paused: "managerUpdates", basket_unpaused: "managerUpdates", basket_retirement_pending: "managerUpdates", basket_retired: "managerUpdates", lead_changed: "managerUpdates", instrument_not_investable: "managerUpdates",
};

interface NewNotification { userId: string; kind: NotificationKind; basketId?: string; positionId?: string; data: Record<string, unknown>; dedupeKey: string }

/** Inserts the inbox row; null when the dedupe key already exists. The caller enqueues `deliver` for the id (after its transaction commits). */
export async function notify(conn: DbOrTx, n: NewNotification): Promise<string | null> {
  const [row] = await conn.insert(notifications).values({ userId: n.userId, kind: n.kind, basketId: n.basketId ?? null, positionId: n.positionId ?? null, data: n.data, dedupeKey: n.dedupeKey }).onConflictDoNothing().returning({ id: notifications.id });
  return row?.id ?? null;
}

const copy = (n: typeof notifications.$inferSelect) => notificationText(n.kind, { ...(n.data as object), positionId: n.positionId ?? undefined });

/**
 * Email and web push for one inbox row, gated by the user's preference for its kind. Throws when the row is not visible yet (the job can run before the
 * enqueuing transaction commits) so the queue retries; a Resend or FCM failure is only logged, and a push token FCM reports dead is revoked.
 */
export async function deliverNotification(id: string): Promise<void> {
  const [n] = await db.select().from(notifications).where(eq(notifications.id, id));
  if (!n) throw new Error("notification is not visible yet");
  const [prefs] = await db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, n.userId));
  if (!prefs?.[PREFERENCE[n.kind]]) return;
  const text = copy(n);
  const [email] = await db.select({ value: contacts.value }).from(contacts).where(and(eq(contacts.userId, n.userId), eq(contacts.type, "email"), eq(contacts.status, "verified")));
  if (email) await sendNotificationEmail(email.value, text, `notification/${n.id}`).catch((err) => logger.warn("notification email failed", { errMessage: err instanceof Error ? err.message : "unknown" }));
  const tokens = (await db.select({ token: pushTokens.token }).from(pushTokens).where(and(eq(pushTokens.userId, n.userId), isNull(pushTokens.revokedAt)))).map((t) => t.token);
  if (tokens.length === 0) return;
  try {
    const dead = await sendPush(tokens, { ...text, link: `${env.AUTH_URI}${text.link}` });
    if (dead.length) await db.update(pushTokens).set({ revokedAt: sql`now()` }).where(inArray(pushTokens.token, dead));
  } catch (err) {
    logger.warn("web push failed", { errMessage: err instanceof Error ? err.message : "unknown" });
  }
}

const basketName = sql<string>`(select v.name from app.basket_versions v where v.basket_id = ${baskets.id} order by v.version_number desc limit 1)`;

/** One notice per OPEN position of the basket (a user has at most one), deduplicated by `<eventKey>:<positionId>`; `deliver` jobs are enqueued after the commit. */
export async function fanOutToHolders(basketId: string, kind: NotificationKind, data: Record<string, unknown>, eventKey: string): Promise<void> {
  const holders = await db.select({ userId: basketPositions.userId, positionId: basketPositions.id, slug: baskets.slug, name: basketName }).from(basketPositions)
    .innerJoin(baskets, eq(baskets.id, basketPositions.basketId)).where(and(eq(basketPositions.basketId, basketId), eq(basketPositions.status, "OPEN")));
  const ids = await db.transaction(async (tx) => {
    const out: string[] = [];
    for (const h of holders) {
      const id = await notify(tx, { userId: h.userId, kind, basketId, positionId: h.positionId, data: { ...data, basketName: h.name, basketSlug: h.slug }, dedupeKey: `${eventKey}:${h.positionId}` });
      if (id) out.push(id);
    }
    return out;
  });
  for (const id of ids) await enqueue("notifications", { job: "deliver", notificationId: id });
}

export async function listNotifications(userId: string, q: { cursor?: string; limit: number }): Promise<NotificationsPage> {
  let after: { t: string; id: string } | null = null;
  if (q.cursor) {
    try {
      after = JSON.parse(Buffer.from(q.cursor, "base64url").toString("utf8")) as { t: string; id: string };
      if (typeof after.t !== "string" || typeof after.id !== "string" || Number.isNaN(Date.parse(after.t))) throw new Error("bad cursor");
    } catch {
      throw createHttpError("Invalid cursor", { code: "VALIDATION_FAILED" });
    }
  }
  // The cursor carries the timestamp as the database prints it (microseconds), so nothing is skipped or repeated between pages.
  const rows = await db.select({ n: notifications, ts: sql<string>`${notifications.createdAt}::text` }).from(notifications)
    .where(and(eq(notifications.userId, userId), after ? sql`(${notifications.createdAt}, ${notifications.id}) < (${after.t}::timestamptz, ${after.id}::uuid)` : undefined))
    .orderBy(desc(notifications.createdAt), desc(notifications.id)).limit(q.limit + 1);
  const page = rows.slice(0, q.limit);
  const [unread] = await db.select({ c: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  const last = page.at(-1);
  return {
    items: page.map(({ n }) => ({ id: n.id, kind: n.kind, basketId: n.basketId, positionId: n.positionId, ...copy(n), readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
    unreadCount: unread!.c,
    nextCursor: rows.length > q.limit && last ? Buffer.from(JSON.stringify({ t: last.ts, id: last.n.id })).toString("base64url") : null,
  };
}

/** Marks the user's own notifications read; ids that belong to someone else match nothing. */
export async function markRead(userId: string, body: { ids: string[] } | { all: true }): Promise<void> {
  await db.update(notifications).set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), "ids" in body ? inArray(notifications.id, body.ids) : undefined));
}

/** A token is one browser. Registering it again un-revokes it, and a browser that a different user signs in to is handed to that user. */
export async function registerPushToken(userId: string, body: { token: string; userAgent?: string }): Promise<void> {
  await db.insert(pushTokens).values({ userId, token: body.token, userAgent: body.userAgent ?? null })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId, userAgent: body.userAgent ?? null, revokedAt: null } });
}

export async function revokePushToken(userId: string, token: string): Promise<void> {
  await db.update(pushTokens).set({ revokedAt: sql`now()` }).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token), isNull(pushTokens.revokedAt)));
}

/**
 * Aggregate adoption per published version for a basket: counts only, never identities; a count of 1 to 4 is shown as "<5". For version V it looks at
 * the OPEN positions that hold V or something older: applied (hold V), skipped (skipped V, still older), in progress (a rebalance to V is open) and the rest.
 */
export async function getAdoption(basketId: string): Promise<Adoption> {
  const rows = await db.execute<{ version_id: string; version_number: number; open: number; applied: number; skipped: number; in_progress: number }>(sql`
    select v.id as version_id, v.version_number,
      count(p.id)::int as open,
      count(p.id) filter (where p.applied_version_id = v.id)::int as applied,
      count(p.id) filter (where p.applied_version_id <> v.id and exists (select 1 from app.position_decisions d where d.position_id = p.id and d.kind = 'skip' and d.version_id = v.id))::int as skipped,
      count(p.id) filter (where p.applied_version_id <> v.id and exists (select 1 from app.operations o where o.position_id = p.id and o.kind = 'rebalance' and o.version_id = v.id and o.status in ('PLANNED', 'IN_PROGRESS')))::int as in_progress
    from app.basket_versions v
    left join app.basket_positions p on p.basket_id = v.basket_id and p.status = 'OPEN'
      and (select av.version_number from app.basket_versions av where av.id = p.applied_version_id) <= v.version_number
    where v.basket_id = ${basketId} and v.status in ('published', 'superseded')
    group by v.id, v.version_number order by v.version_number desc`);
  const mask = (n: number): number | "<5" => (n > 0 && n < 5 ? "<5" : n);
  return {
    versions: [...rows].map((r) => ({
      versionId: r.version_id, versionNumber: r.version_number, openPositions: mask(r.open), applied: mask(r.applied), skipped: mask(r.skipped),
      notResponded: mask(Math.max(r.open - r.applied - r.skipped - r.in_progress, 0)), inProgress: mask(r.in_progress),
    })),
  };
}

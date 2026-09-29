import { createHmac, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { sessions, users, type DbOrTx } from "@repo/db";
import type { ClientKind } from "@repo/validator";
import type { RequestMeta } from "../middleware/request-context";

export type SessionRow = typeof sessions.$inferSelect;
export type RevokeReason = NonNullable<SessionRow["revokeReason"]>;
export interface IssuedSession { id: string; token: string; client: ClientKind; absoluteExpiresAt: Date }

const SESSION_POLICY: Readonly<Record<ClientKind, { idle: string; absolute: string }>> = {
  web: { idle: "12 hours", absolute: "7 days" },
  mobile: { idle: "7 days", absolute: "30 days" },
};
const RENEWAL_THROTTLE = "5 minutes";

export function hashToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

const activeNow = () => and(isNull(sessions.revokedAt), gt(sessions.idleExpiresAt, sql`now()`), gt(sessions.absoluteExpiresAt, sql`now()`));

export async function createSession(db: DbOrTx, i: { userId: string; client: ClientKind; pepper: string; meta: RequestMeta }): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const p = SESSION_POLICY[i.client];
  const [row] = await db.insert(sessions).values({
    userId: i.userId,
    tokenHash: hashToken(token, i.pepper),
    client: i.client,
    idleExpiresAt: sql`now() + ${p.idle}::interval`,
    absoluteExpiresAt: sql`now() + ${p.absolute}::interval`,
    userAgent: i.meta.userAgent,
    ipPrefix: i.meta.ipPrefix,
  }).returning({ id: sessions.id, absoluteExpiresAt: sessions.absoluteExpiresAt });
  return { id: row!.id, token, client: i.client, absoluteExpiresAt: row!.absoluteExpiresAt };
}

export async function findActiveSession(db: DbOrTx, token: string, pepper: string) {
  const [row] = await db.select({ session: sessions, userStatus: users.status })
    .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token, pepper)), activeNow()));
  return row;
}

/** Idempotent under concurrency: conditional update, monotonic values, capped at absolute expiry. */
export async function touchSession(db: DbOrTx, sessionId: string, client: ClientKind): Promise<void> {
  const p = SESSION_POLICY[client];
  await db.update(sessions)
    .set({ lastSeenAt: sql`now()`, idleExpiresAt: sql`LEAST(now() + ${p.idle}::interval, ${sessions.absoluteExpiresAt})` })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), lt(sessions.lastSeenAt, sql`now() - ${RENEWAL_THROTTLE}::interval`)));
}

/** True when this call revoked the session (false if it was already revoked). */
export async function revokeSession(db: DbOrTx, sessionId: string, reason: RevokeReason): Promise<boolean> {
  const rows = await db.update(sessions)
    .set({ revokedAt: sql`now()`, revokeReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length === 1;
}

export async function revokeAllSessions(db: DbOrTx, userId: string, reason: RevokeReason): Promise<number> {
  const rows = await db.update(sessions).set({ revokedAt: sql`now()`, revokeReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function listActiveSessions(db: DbOrTx, userId: string): Promise<SessionRow[]> {
  return db.select().from(sessions).where(and(eq(sessions.userId, userId), activeNow())).orderBy(desc(sessions.lastSeenAt));
}

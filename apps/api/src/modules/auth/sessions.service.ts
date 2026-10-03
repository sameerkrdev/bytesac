import { createHmac, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import createHttpError from "http-errors";
import { db, sessions, users, type DbOrTx } from "@repo/db";
import type { ClientKind, SessionsResponse } from "@repo/validator";
import type { RequestMeta } from "@/middlewares/request-context.middleware";
import { writeAudit } from "@/modules/audit/audit.service";

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

type Caller = { userId: string; sessionId: string };

/** Revokes the caller's own session and audits it. */
export async function logoutSession(auth: Caller, requestId: string): Promise<void> {
  await db.transaction(async (tx) => {
    if (await revokeSession(tx, auth.sessionId, "logout")) {
      await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "session.revoked", entityType: "session", entityId: auth.sessionId, requestId, sessionId: auth.sessionId, metadata: { reason: "logout" } });
    }
  });
}

export async function logoutAllSessions(auth: Caller, requestId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const n = await revokeAllSessions(tx, auth.userId, "logout_all");
    await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "session.revoked_all", entityType: "user", entityId: auth.userId, requestId, sessionId: auth.sessionId, metadata: { count: n } });
  });
}

export async function listOwnSessions(auth: Caller): Promise<SessionsResponse> {
  const rows = await listActiveSessions(db, auth.userId);
  return {
    sessions: rows.map((s) => ({
      id: s.id, client: s.client, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(),
      userAgent: s.userAgent, ipPrefix: s.ipPrefix, current: s.id === auth.sessionId,
    })),
  };
}

export async function revokeOwnSession(auth: Caller, requestId: string, id: string): Promise<void> {
  const [owned] = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, auth.userId)));
  if (!owned) throw createHttpError("Session not found", { code: "NOT_FOUND" });
  await db.transaction(async (tx) => {
    if (await revokeSession(tx, id, "user_revoked")) {
      await writeAudit(tx, { actorType: "user", actorUserId: auth.userId, action: "session.revoked", entityType: "session", entityId: id, requestId, sessionId: auth.sessionId, metadata: { reason: "user_revoked" } });
    }
  });
}

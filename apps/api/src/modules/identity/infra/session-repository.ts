import { createHmac, randomBytes } from "node:crypto";
import type { ClientKind } from "@repo/contracts";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "../../../db/client.js";
import { sessions, users } from "../../../db/schema/index.js";
import type { RequestMeta } from "../../../shared/request-context.js";
import { RENEWAL_THROTTLE, SESSION_POLICY } from "../domain/session-policy.js";

export type SessionRow = typeof sessions.$inferSelect;
export type RevokeReason = NonNullable<SessionRow["revokeReason"]>;
export interface IssuedSession { id: string; token: string; client: ClientKind; absoluteExpiresAt: Date }

export function hashToken(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

const activeNow = () => and(isNull(sessions.revokedAt), gt(sessions.idleExpiresAt, sql`now()`), gt(sessions.absoluteExpiresAt, sql`now()`));

export const sessionRepo = {
  async create(db: DbOrTx, i: { userId: string; client: ClientKind; pepper: string; meta: RequestMeta }): Promise<IssuedSession> {
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
  },

  async findActiveByToken(db: DbOrTx, token: string, pepper: string) {
    const [row] = await db.select({ session: sessions, userStatus: users.status })
      .from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, hashToken(token, pepper)), activeNow()));
    return row;
  },

  /** Idempotent under concurrency: conditional update, monotonic values, capped at absolute expiry. */
  async touch(db: DbOrTx, sessionId: string, client: ClientKind): Promise<void> {
    const p = SESSION_POLICY[client];
    await db.update(sessions)
      .set({ lastSeenAt: sql`now()`, idleExpiresAt: sql`LEAST(now() + ${p.idle}::interval, ${sessions.absoluteExpiresAt})` })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), lt(sessions.lastSeenAt, sql`now() - ${RENEWAL_THROTTLE}::interval`)));
  },

  async revoke(db: DbOrTx, sessionId: string, reason: RevokeReason, replacedBy?: string): Promise<boolean> {
    const rows = await db.update(sessions)
      .set({ revokedAt: sql`now()`, revokeReason: reason, replacedBySessionId: replacedBy ?? null })
      .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length === 1;
  },

  async revokeAllForUser(db: DbOrTx, userId: string, reason: RevokeReason): Promise<number> {
    const rows = await db.update(sessions).set({ revokedAt: sql`now()`, revokeReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length;
  },

  async listActiveForUser(db: DbOrTx, userId: string): Promise<SessionRow[]> {
    return db.select().from(sessions).where(and(eq(sessions.userId, userId), activeNow())).orderBy(desc(sessions.lastSeenAt));
  },
};

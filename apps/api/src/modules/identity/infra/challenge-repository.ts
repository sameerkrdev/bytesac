import { and, eq, gt, lt, or, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@repo/db";
import { authChallenges } from "@repo/db";
import { CHALLENGE_LEASE } from "../domain/session-policy.js";

export type ChallengeRow = typeof authChallenges.$inferSelect;

export const challenges = {
  async dbNow(db: DbOrTx): Promise<Date> {
    const rows = await db.execute<{ now: string | Date }>(sql`select now() as now`);
    const v = (rows as unknown as Array<{ now: string | Date }>)[0]!.now;
    return v instanceof Date ? v : new Date(v);
  },

  async insert(db: DbOrTx, v: typeof authChallenges.$inferInsert): Promise<ChallengeRow> {
    const [row] = await db.insert(authChallenges).values(v).returning();
    return row!;
  },

  async findById(db: DbOrTx, id: string): Promise<ChallengeRow | undefined> {
    const [row] = await db.select().from(authChallenges).where(eq(authChallenges.id, id));
    return row;
  },

  async claim(db: DbOrTx, id: string, claimId: string): Promise<ChallengeRow | undefined> {
    const [row] = await db
      .update(authChallenges)
      .set({ status: "processing", claimId, leaseExpiresAt: sql`now() + ${CHALLENGE_LEASE}::interval` })
      .where(and(
        eq(authChallenges.id, id),
        gt(authChallenges.expiresAt, sql`now()`),
        or(eq(authChallenges.status, "pending"), and(eq(authChallenges.status, "processing"), lt(authChallenges.leaseExpiresAt, sql`now()`))),
      ))
      .returning();
    return row;
  },

  async release(db: DbOrTx, id: string, claimId: string): Promise<void> {
    await db.update(authChallenges).set({ status: "pending", claimId: null, leaseExpiresAt: null })
      .where(and(eq(authChallenges.id, id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")));
  },

  async reject(db: DbOrTx, id: string, claimId: string): Promise<void> {
    await db.update(authChallenges).set({ status: "rejected", resolvedAt: sql`now()`, leaseExpiresAt: null })
      .where(and(eq(authChallenges.id, id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")));
  },

  async consume(tx: Tx, id: string, claimId: string): Promise<boolean> {
    const rows = await tx.update(authChallenges).set({ status: "consumed", resolvedAt: sql`now()`, leaseExpiresAt: null })
      .where(and(eq(authChallenges.id, id), eq(authChallenges.claimId, claimId), eq(authChallenges.status, "processing")))
      .returning({ id: authChallenges.id });
    return rows.length === 1;
  },
};

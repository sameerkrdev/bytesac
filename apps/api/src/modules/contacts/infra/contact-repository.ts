import type { ContactType } from "@repo/validator";
import { and, desc, eq, gt, lt, ne, sql } from "drizzle-orm";
import type { DbOrTx, Tx } from "@repo/db";
import { contactVerifications, contacts } from "@repo/db";
import { DomainError } from "../../../shared/errors.js";
import { OTP_MAX_ATTEMPTS, OTP_TTL } from "../domain/otp.js";

export type ContactRow = typeof contacts.$inferSelect;
export type VerificationRow = typeof contactVerifications.$inferSelect;

export const contactRepo = {
  async current(db: DbOrTx, userId: string, type: ContactType): Promise<ContactRow | undefined> {
    const [row] = await db.select().from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.type, type), ne(contacts.status, "replaced")));
    return row;
  },

  async ownedCurrent(db: DbOrTx, userId: string, contactId: string): Promise<ContactRow | undefined> {
    const [row] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.userId, userId), ne(contacts.status, "replaced")));
    return row;
  },

  async replace(tx: Tx, userId: string, type: ContactType, value: string): Promise<{ contact: ContactRow; replaced: ContactRow | undefined }> {
    await tx.execute(sql`SELECT id FROM app.users WHERE id = ${userId} FOR UPDATE`);
    const replaced = await contactRepo.current(tx, userId, type);
    if (replaced) {
      await tx.update(contacts).set({ status: "replaced" }).where(eq(contacts.id, replaced.id));
      await contactRepo.supersedePending(tx, replaced.id);
    }
    const [contact] = await tx.insert(contacts).values({ userId, type, value }).returning();
    return { contact: contact!, replaced };
  },

  /** Row-lock a contact and return it (undefined when replaced or missing) to serialise sends. */
  async lockCurrent(tx: Tx, contactId: string): Promise<ContactRow | undefined> {
    await tx.execute(sql`SELECT id FROM app.contacts WHERE id = ${contactId} FOR UPDATE`);
    const [row] = await tx.select().from(contacts).where(and(eq(contacts.id, contactId), ne(contacts.status, "replaced")));
    return row;
  },

  async supersedePending(tx: DbOrTx, contactId: string): Promise<void> {
    await tx.update(contactVerifications).set({ status: "superseded", resolvedAt: sql`now()` })
      .where(and(eq(contactVerifications.contactId, contactId), eq(contactVerifications.status, "pending")));
  },

  async createVerification(tx: DbOrTx, v: { id: string; contactId: string; destination: string; channel: "email" | "sms"; codeHash: string | null }): Promise<VerificationRow> {
    const [row] = await tx.insert(contactVerifications).values({ ...v, expiresAt: sql`now() + ${OTP_TTL}::interval` }).returning();
    return row!;
  },

  async setProviderRef(db: DbOrTx, id: string, providerRef: string): Promise<void> {
    await db.update(contactVerifications).set({ providerRef }).where(eq(contactVerifications.id, id));
  },

  async markFailed(db: DbOrTx, id: string): Promise<void> {
    await db.update(contactVerifications).set({ status: "failed", resolvedAt: sql`now()` }).where(and(eq(contactVerifications.id, id), eq(contactVerifications.status, "pending")));
  },

  async latestPending(db: DbOrTx, contactId: string): Promise<VerificationRow | undefined> {
    const [row] = await db.select().from(contactVerifications)
      .where(and(eq(contactVerifications.contactId, contactId), eq(contactVerifications.status, "pending")))
      .orderBy(desc(contactVerifications.createdAt)).limit(1);
    return row;
  },

  async latest(db: DbOrTx, contactId: string): Promise<VerificationRow | undefined> {
    const [row] = await db.select().from(contactVerifications).where(eq(contactVerifications.contactId, contactId)).orderBy(desc(contactVerifications.createdAt)).limit(1);
    return row;
  },

  /** Atomically count an attempt; undefined when expired, exhausted or not pending. */
  async registerAttempt(db: DbOrTx, id: string): Promise<VerificationRow | undefined> {
    const [row] = await db.update(contactVerifications).set({ attempts: sql`${contactVerifications.attempts} + 1` })
      .where(and(eq(contactVerifications.id, id), eq(contactVerifications.status, "pending"), lt(contactVerifications.attempts, OTP_MAX_ATTEMPTS), gt(contactVerifications.expiresAt, sql`now()`)))
      .returning();
    return row;
  },

  /** Return an attempt consumed by a provider outage (never below zero). */
  async giveBackAttempt(db: DbOrTx, id: string): Promise<void> {
    await db.update(contactVerifications).set({ attempts: sql`${contactVerifications.attempts} - 1` })
      .where(and(eq(contactVerifications.id, id), gt(contactVerifications.attempts, 0)));
  },

  async isExpired(db: DbOrTx, id: string): Promise<boolean> {
    const [row] = await db.select({ expired: sql<boolean>`${contactVerifications.expiresAt} <= now()` }).from(contactVerifications).where(eq(contactVerifications.id, id));
    return row?.expired ?? true;
  },

  async secondsSinceCreated(db: DbOrTx, id: string): Promise<number> {
    const [row] = await db.select({ s: sql<number>`extract(epoch from now() - ${contactVerifications.createdAt})::int` }).from(contactVerifications).where(eq(contactVerifications.id, id));
    return row?.s ?? Number.MAX_SAFE_INTEGER;
  },

  async markVerified(tx: Tx, verificationId: string, contactId: string): Promise<ContactRow> {
    const expired = () => new DomainError("OTP_EXPIRED", "This code has expired. Request a new one.");
    const resolved = await tx.update(contactVerifications).set({ status: "verified", resolvedAt: sql`now()` })
      .where(and(eq(contactVerifications.id, verificationId), eq(contactVerifications.status, "pending"))).returning({ id: contactVerifications.id });
    if (resolved.length === 0) throw expired();
    const [row] = await tx.update(contacts).set({ status: "verified", verifiedAt: sql`now()` })
      .where(and(eq(contacts.id, contactId), eq(contacts.status, "unverified"))).returning();
    if (!row) throw expired();
    return row;
  },
};

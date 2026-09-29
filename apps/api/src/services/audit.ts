import { auditEvents, type DbOrTx } from "@repo/db";

/** Never put tokens, signatures, OTP codes or unmasked contact values in `metadata`. */
export async function writeAudit(db: DbOrTx, entry: typeof auditEvents.$inferInsert): Promise<void> {
  await db.insert(auditEvents).values(entry);
}

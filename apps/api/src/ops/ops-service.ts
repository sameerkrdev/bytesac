import type { Chain } from "@repo/validator";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@repo/db";
import { users, walletAddresses } from "@repo/db";
import { canonicalizeAddress } from "../modules/identity/domain/address.js";
import { walletRepo } from "../modules/identity/infra/wallet-repository.js";
import { sessionRepo } from "../modules/identity/infra/session-repository.js";
import { writeAudit } from "../shared/audit.js";

function required(name: string, v: string): void {
  if (!v.trim()) throw new Error(`${name} is required`);
}

export async function disableAddress(db: Db, i: { chain: Chain; address: string; reason: string; operator: string; requestId: string }) {
  required("reason", i.reason);
  required("operator", i.operator);
  const address = canonicalizeAddress(i.chain, i.address);
  return db.transaction(async (tx) => {
    const owner = await walletRepo.findOwner(tx, i.chain, address);
    if (!owner) throw new Error("Address not found");
    const rows = await tx.update(walletAddresses)
      .set({ status: "disabled", disabledAt: sql`now()`, disabledReason: i.reason })
      .where(and(eq(walletAddresses.address, address), eq(walletAddresses.investmentWalletId, owner.walletId), eq(walletAddresses.status, "active")))
      .returning({ id: walletAddresses.id });
    const revoked = await sessionRepo.revokeAllForUser(tx, owner.userId, "admin");
    const base = { actorType: "ops" as const, actorOpsId: i.operator, requestId: i.requestId };
    await writeAudit(tx, { ...base, action: "wallet.address_disabled", entityType: "investment_wallet", entityId: owner.walletId, metadata: { address, rows: rows.length, reason: i.reason } });
    await writeAudit(tx, { ...base, action: "session.revoked_all", entityType: "user", entityId: owner.userId, metadata: { count: revoked, reason: "address_disabled" } });
    return { disabledRows: rows.length, revokedSessions: revoked };
  });
}

export async function reactivateAddress(db: Db, i: { chain: Chain; address: string; operator: string; requestId: string }): Promise<number> {
  required("operator", i.operator);
  const address = canonicalizeAddress(i.chain, i.address);
  return db.transaction(async (tx) => {
    const owner = await walletRepo.findOwner(tx, i.chain, address);
    if (!owner) throw new Error("Address not found");
    const rows = await tx.update(walletAddresses)
      .set({ status: "active", disabledAt: null, disabledReason: null })
      .where(and(eq(walletAddresses.address, address), eq(walletAddresses.investmentWalletId, owner.walletId), eq(walletAddresses.status, "disabled")))
      .returning({ id: walletAddresses.id });
    await writeAudit(tx, { actorType: "ops", actorOpsId: i.operator, requestId: i.requestId, action: "wallet.address_reactivated", entityType: "investment_wallet", entityId: owner.walletId, metadata: { address, rows: rows.length } });
    return rows.length;
  });
}

export async function suspendUser(db: Db, i: { userId: string; reason: string; operator: string; requestId: string }): Promise<number> {
  required("reason", i.reason);
  required("operator", i.operator);
  return db.transaction(async (tx) => {
    const updated = await tx.update(users).set({ status: "suspended", updatedAt: sql`now()` }).where(eq(users.id, i.userId)).returning({ id: users.id });
    if (updated.length !== 1) throw new Error("User not found");
    const revoked = await sessionRepo.revokeAllForUser(tx, i.userId, "user_suspended");
    await writeAudit(tx, { actorType: "ops", actorOpsId: i.operator, requestId: i.requestId, action: "user.suspended", entityType: "user", entityId: i.userId, metadata: { reason: i.reason, revokedSessions: revoked } });
    return revoked;
  });
}

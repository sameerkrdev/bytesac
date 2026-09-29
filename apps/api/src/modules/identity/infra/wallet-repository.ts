import { familyOf, type Chain, type VerificationMethod } from "@repo/validator";
import { and, eq } from "drizzle-orm";
import type { DbOrTx, Tx } from "@repo/db";
import { investmentWallets, notificationPreferences, users, walletAddresses } from "@repo/db";

export interface NewAddressRow { chain: Chain; address: string; method: VerificationMethod; verifiedOnChain: Chain; challengeId: string }
export interface AddressOwner { userId: string; userStatus: "pending" | "active" | "suspended"; walletId: string; status: "active" | "disabled" }

export const walletRepo = {
  async findOwner(db: DbOrTx, chain: Chain, address: string): Promise<AddressOwner | undefined> {
    const [row] = await db
      .select({ userId: users.id, userStatus: users.status, walletId: investmentWallets.id, status: walletAddresses.status })
      .from(walletAddresses)
      .innerJoin(investmentWallets, eq(investmentWallets.id, walletAddresses.investmentWalletId))
      .innerJoin(users, eq(users.id, investmentWallets.userId))
      .where(and(eq(walletAddresses.chain, chain), eq(walletAddresses.address, address)));
    return row;
  },

  async createUserWithWallet(tx: Tx, i: { walletProvider?: string; rows: NewAddressRow[] }): Promise<{ userId: string; walletId: string }> {
    const [user] = await tx.insert(users).values({ status: "active" }).returning({ id: users.id });
    const [wallet] = await tx.insert(investmentWallets).values({ userId: user!.id, status: "active", walletProvider: i.walletProvider ?? null })
      .returning({ id: investmentWallets.id });
    await tx.insert(notificationPreferences).values({ userId: user!.id });
    await walletRepo.insertAddresses(tx, wallet!.id, i.rows);
    return { userId: user!.id, walletId: wallet!.id };
  },

  async activeWalletForUser(db: DbOrTx, userId: string): Promise<{ id: string; walletProvider: string | null } | undefined> {
    const [row] = await db.select({ id: investmentWallets.id, walletProvider: investmentWallets.walletProvider }).from(investmentWallets)
      .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active")));
    return row;
  },

  /** Row-locks the active wallet to serialize concurrent address additions for one user. */
  async lockActiveWalletForUser(tx: Tx, userId: string): Promise<{ id: string; walletProvider: string | null } | undefined> {
    const [row] = await tx.select({ id: investmentWallets.id, walletProvider: investmentWallets.walletProvider }).from(investmentWallets)
      .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active"))).for("update");
    return row;
  },

  async addressesForWallet(db: DbOrTx, walletId: string) {
    return db.select().from(walletAddresses).where(eq(walletAddresses.investmentWalletId, walletId)).orderBy(walletAddresses.createdAt);
  },

  async insertAddresses(tx: Tx, walletId: string, rows: NewAddressRow[]): Promise<void> {
    if (rows.length === 0) return;
    await tx.insert(walletAddresses).values(rows.map((r) => ({
      investmentWalletId: walletId,
      chainFamily: familyOf(r.chain),
      chain: r.chain,
      address: r.address,
      verificationMethod: r.method,
      verifiedOnChain: r.verifiedOnChain,
      verificationChallengeId: r.challengeId,
    })));
  },
};

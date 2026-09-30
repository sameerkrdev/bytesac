import bs58 from "bs58";
import createHttpError from "http-errors";
import { and, eq } from "drizzle-orm";
import { investmentWallets, notificationPreferences, users, walletAddresses, type DbOrTx, type Tx } from "@repo/db";
import { ASSET_CHAINS, familyOf, type AssetChain, type Chain, type VerificationMethod } from "@repo/validator";
import { isAddress } from "viem";

export interface NewAddressRow { chain: Chain; address: string; method: VerificationMethod; verifiedOnChain: Chain; challengeId: string }

const invalid = (message: string) => createHttpError(message, { code: "VALIDATION_FAILED" });

export function canonicalizeAddress(chain: AssetChain, raw: string): string {
  const value = raw.trim();
  const family = ASSET_CHAINS[chain].family;
  if (family === "bitcoin") throw invalid("Bitcoin deployments are native only.");
  if (family === "evm") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value) || !isAddress(value, { strict: true })) throw invalid("Invalid EVM address");
    return value.toLowerCase();
  }
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(value);
  } catch {
    throw invalid("Invalid Solana address");
  }
  if (bytes.length !== 32 || bs58.encode(bytes) !== value) throw invalid("Invalid Solana address");
  return value;
}

export async function findAddressOwner(db: DbOrTx, chain: Chain, address: string) {
  const [row] = await db
    .select({ userId: users.id, userStatus: users.status, walletId: investmentWallets.id, status: walletAddresses.status, verificationMethod: walletAddresses.verificationMethod })
    .from(walletAddresses)
    .innerJoin(investmentWallets, eq(investmentWallets.id, walletAddresses.investmentWalletId))
    .innerJoin(users, eq(users.id, investmentWallets.userId))
    .where(and(eq(walletAddresses.chain, chain), eq(walletAddresses.address, address)));
  return row;
}

export async function addressesForWallet(db: DbOrTx, walletId: string) {
  return db.select().from(walletAddresses).where(eq(walletAddresses.investmentWalletId, walletId)).orderBy(walletAddresses.createdAt);
}

export async function insertAddresses(tx: Tx, walletId: string, rows: NewAddressRow[]): Promise<void> {
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
}

export async function createUserWithWallet(tx: Tx, i: { walletProvider?: string; rows: NewAddressRow[] }): Promise<string> {
  const [user] = await tx.insert(users).values({ status: "active" }).returning({ id: users.id });
  const [wallet] = await tx.insert(investmentWallets).values({ userId: user!.id, status: "active", walletProvider: i.walletProvider ?? null })
    .returning({ id: investmentWallets.id });
  await tx.insert(notificationPreferences).values({ userId: user!.id });
  await insertAddresses(tx, wallet!.id, i.rows);
  return user!.id;
}

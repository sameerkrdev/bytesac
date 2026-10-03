import bs58 from "bs58";
import createHttpError from "http-errors";
import { and, asc, eq } from "drizzle-orm";
import { db, investmentWallets, notificationPreferences, users, walletAddresses, type DbOrTx, type Tx } from "@repo/db";
import { ASSET_CHAINS, familyOf, type AssetChain, type Chain, type ChainFamily, type VerificationMethod } from "@repo/validator";
import { isAddress } from "viem";
import { Address } from "@scure/btc-signer";

export interface NewAddressRow { chain: Chain; address: string; method: VerificationMethod; verifiedOnChain: Chain; challengeId: string }

const invalid = (message: string) => createHttpError(message, { code: "VALIDATION_FAILED" });

/** A mainnet P2WPKH, P2TR, P2SH or P2PKH address in canonical form (bech32 lowercase); anything else is a 400. (No env: the ops CLI imports this.) */
export function canonicalBitcoinAddress(raw: string): string {
  const value = raw.trim();
  try {
    const { type } = Address().decode(value);
    if (type === "wpkh" || type === "tr" || type === "sh" || type === "pkh") return value.toLowerCase().startsWith("bc1") ? value.toLowerCase() : value;
  } catch {
    // falls through
  }
  throw invalid("Invalid Bitcoin address");
}

export function canonicalizeAddress(chain: AssetChain, raw: string): string {
  const value = raw.trim();
  const family = ASSET_CHAINS[chain].family;
  if (family === "bitcoin") return canonicalBitcoinAddress(value);
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

export type Addresses = Partial<Record<ChainFamily, string>>;

export async function userAddresses(db: DbOrTx, userId: string): Promise<Addresses> {
  const rows = await db.select({ family: walletAddresses.chainFamily, address: walletAddresses.address }).from(investmentWallets)
    .innerJoin(walletAddresses, and(eq(walletAddresses.investmentWalletId, investmentWallets.id), eq(walletAddresses.status, "active")))
    .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active"))).orderBy(asc(walletAddresses.createdAt));
  const out: Addresses = {};
  for (const r of rows) out[r.family] ??= r.address;
  return out;
}

export function addressOn(addresses: Addresses, chain: AssetChain): string {
  const a = addresses[ASSET_CHAINS[chain].family];
  if (!a) throw createHttpError(`Link a ${ASSET_CHAINS[chain].family} wallet first.`, { code: ASSET_CHAINS[chain].family === "bitcoin" ? "BTC_ADDRESS_REQUIRED" : "NOT_ELIGIBLE" });
  return a;
}

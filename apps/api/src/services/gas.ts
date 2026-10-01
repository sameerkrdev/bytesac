import createHttpError from "http-errors";
import { and, eq, sql } from "drizzle-orm";
import { db, gasDrops, isUniqueViolation, operationLegs, operations, platformWallets, sponsorUsage, type Tx } from "@repo/db";
import { logger } from "@repo/logger";
import { ASSET_CHAINS, type AssetChain } from "@repo/validator";
import { env } from "../env";
import { evmBalance, evmReceipt, gasWalletAddress, sendNativeFromGasWallet } from "../providers/evm-rpc";
import { feePayer } from "../providers/solana-tx";
import { writeAudit } from "./audit";

type Purpose = typeof platformWallets.$inferSelect["purpose"];

/**
 * Daily sponsored-gas caps in the chain's native base units (lamports, wei). Spec 8: per user Solana 0.02 SOL and $5 per EVM chain, global $200 per chain.
 * Native units, so the dollar values below assume SOL $150, ETH $2,500, BNB $600, POL $0.20 and need re-tuning (review item); the caps are constants until then.
 */
const SOL = 10n ** 9n;
const ETHER = 10n ** 18n;
const CAPS: Readonly<Record<AssetChain, { user: bigint; global: bigint }>> = {
  solana: { user: SOL / 50n, global: (SOL * 4n) / 3n },
  ethereum: { user: ETHER / 500n, global: (ETHER * 2n) / 25n },
  base: { user: ETHER / 500n, global: (ETHER * 2n) / 25n },
  arbitrum: { user: ETHER / 500n, global: (ETHER * 2n) / 25n },
  bnb: { user: ETHER / 125n, global: (ETHER * 33n) / 100n },
  polygon: { user: 25n * ETHER, global: 1000n * ETHER },
  bitcoin: { user: 0n, global: 0n },
};

const EVM_CHAINS = (Object.keys(ASSET_CHAINS) as AssetChain[]).filter((c) => ASSET_CHAINS[c].family === "evm");

/** Public addresses of the platform wallets from env-derived keys; run at API and worker start. Unconfigured wallets are skipped. */
export async function seedPlatformWallets(): Promise<void> {
  const rows: { chain: AssetChain; purpose: Purpose; address: string }[] = [];
  if (env.SOLANA_FEE_PAYER_SECRET) rows.push({ chain: "solana", purpose: "solana_fee_payer", address: feePayer().publicKey.toBase58() });
  if (env.GAS_TREASURY_SOLANA_ADDRESS) rows.push({ chain: "solana", purpose: "gas_treasury", address: env.GAS_TREASURY_SOLANA_ADDRESS });
  if (env.EVM_GAS_WALLET_SECRET) for (const chain of EVM_CHAINS) rows.push({ chain, purpose: "evm_gas", address: gasWalletAddress() });
  for (const r of rows) await db.insert(platformWallets).values(r).onConflictDoUpdate({ target: [platformWallets.chain, platformWallets.purpose], set: { address: r.address } });
}

export async function platformAddress(chain: AssetChain, purpose: Purpose): Promise<string> {
  const [row] = await db.select({ address: platformWallets.address }).from(platformWallets).where(and(eq(platformWallets.chain, chain), eq(platformWallets.purpose, purpose)));
  if (!row) throw createHttpError(`The platform ${purpose} wallet is not configured for ${chain}.`, { code: "ROUTE_UNAVAILABLE" });
  return row.address;
}

/**
 * Adds `amountNative` to today's sponsored gas for the user on `chain`, or throws 409 GAS_BUDGET_EXHAUSTED. Runs in the caller's transaction, so a
 * refused plan leaves nothing behind. A per-chain advisory lock serializes the global-cap check; the user's row is locked as well.
 */
export async function reserveGas(tx: Tx, i: { userId: string; chain: AssetChain; amountNative: bigint }): Promise<void> {
  const today = sql`(now() at time zone 'utc')::date`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gas:${i.chain}`}))`);
  await tx.insert(sponsorUsage).values({ userId: i.userId, chain: i.chain, day: today as unknown as string }).onConflictDoNothing();
  const [mine] = await tx.select({ amount: sponsorUsage.amountNative }).from(sponsorUsage)
    .where(and(eq(sponsorUsage.userId, i.userId), eq(sponsorUsage.chain, i.chain), sql`${sponsorUsage.day} = ${today}`)).for("update");
  const [all] = await tx.select({ total: sql<string>`coalesce(sum(${sponsorUsage.amountNative}), 0)` }).from(sponsorUsage)
    .where(and(eq(sponsorUsage.chain, i.chain), sql`${sponsorUsage.day} = ${today}`));
  const cap = CAPS[i.chain];
  if (BigInt(mine!.amount) + i.amountNative > cap.user || BigInt(all!.total) + i.amountNative > cap.global) {
    throw createHttpError(409, "Today's network gas budget is used up. Try again later.", { code: "GAS_BUDGET_EXHAUSTED" });
  }
  await tx.update(sponsorUsage).set({ amountNative: sql`${sponsorUsage.amountNative} + ${i.amountNative.toString()}::numeric` })
    .where(and(eq(sponsorUsage.userId, i.userId), eq(sponsorUsage.chain, i.chain), sql`${sponsorUsage.day} = ${today}`));
}

export interface GasDropResult { status: "pending" | "confirmed" | "failed" | "skipped"; txHash: string | null }

/**
 * Sends the native gas an EVM-source leg needs from the platform gas wallet, once per leg: skipped when the recipient already holds `amountNative`;
 * otherwise the budget is reserved and the drop row recorded before anything is sent. A repeat call only reports (and, with a hash, confirms) the
 * existing drop; a drop whose send outcome is unknown stays `pending` and is never sent again.
 */
export async function sendGasDrop(legId: string, chain: AssetChain, recipient: string, amountNative: bigint): Promise<GasDropResult> {
  const existing = async () => (await db.select().from(gasDrops).where(eq(gasDrops.legId, legId)))[0];
  let drop = await existing();
  if (!drop) {
    if ((await evmBalance(chain, recipient, null)) >= amountNative) return { status: "skipped", txHash: null };
    try {
      drop = await db.transaction(async (tx) => {
        const [leg] = await tx.select({ userId: operations.userId, expectedTx: operationLegs.expectedTx }).from(operationLegs).innerJoin(operations, eq(operations.id, operationLegs.operationId)).where(eq(operationLegs.id, legId));
        if (!leg) throw createHttpError("Leg not found", { code: "NOT_FOUND" });
        // A planned leg's drop was reserved with its plan (so a refused budget refuses the plan); only an unplanned drop reserves here.
        if (!(leg.expectedTx as { gasReserved?: boolean } | null)?.gasReserved) await reserveGas(tx, { userId: leg.userId, chain, amountNative });
        const [row] = await tx.insert(gasDrops).values({ legId, chain, recipient, amountNative: amountNative.toString() }).returning();
        await writeAudit(tx, { actorType: "system", action: "gas_drop.reserved", entityType: "gas_drop", entityId: row!.id, requestId: `gas-drop-${legId}`, metadata: { legId, chain, recipient, amountNative: amountNative.toString() } });
        return row!;
      });
    } catch (err) {
      if (!isUniqueViolation(err, "gas_drops_leg_key")) throw err;
      drop = (await existing())!; // a concurrent call recorded it first: report, never send twice
      return { status: drop.status, txHash: drop.txHash };
    }
    try {
      const txHash = await sendNativeFromGasWallet({ chain, to: recipient, value: amountNative });
      [drop] = await db.update(gasDrops).set({ txHash, updatedAt: sql`now()` }).where(eq(gasDrops.id, drop.id)).returning();
      await writeAudit(db, { actorType: "system", action: "gas_drop.sent", entityType: "gas_drop", entityId: drop!.id, requestId: `gas-drop-${legId}`, metadata: { legId, chain, txHash } });
    } catch (err) {
      logger.error("gas drop send outcome unknown", { legId, chain, errMessage: err instanceof Error ? err.message : "unknown" });
    }
    return { status: "pending", txHash: drop?.txHash ?? null };
  }
  if (drop.status === "pending" && drop.txHash) {
    const receipt = await evmReceipt(chain, drop.txHash);
    if (receipt) {
      const status = receipt.success ? "confirmed" : "failed";
      await db.update(gasDrops).set({ status, updatedAt: sql`now()` }).where(and(eq(gasDrops.id, drop.id), eq(gasDrops.status, "pending")));
      await writeAudit(db, { actorType: "system", action: `gas_drop.${status}`, entityType: "gas_drop", entityId: drop.id, requestId: `gas-drop-${legId}`, metadata: { legId, chain, txHash: drop.txHash } });
      return { status, txHash: drop.txHash };
    }
  }
  return { status: drop.status, txHash: drop.txHash };
}

import createHttpError from "http-errors";
import { and, eq, sql } from "drizzle-orm";
import { db, gasDrops, isUniqueViolation, operationLegs, operations, platformWallets, sponsorUsage, type Tx } from "@repo/db";
import { logger } from "@repo/logger";
import { ASSET_CHAINS, type AssetChain } from "@repo/validator";
import { env } from "@/config/dotenv";
import { evmBalance, evmReceipt, gasWalletAddress, sendNativeFromGasWallet } from "@/providers/evm-rpc";
import { feePayer, solanaBalance } from "@/providers/solana-tx";
import { writeAudit } from "@/modules/audit/audit.service";

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
  if (env.REVENUE_TREASURY_SOLANA_ADDRESS) rows.push({ chain: "solana", purpose: "revenue_treasury", address: env.REVENUE_TREASURY_SOLANA_ADDRESS });
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

/** Gas drops a user may receive per chain per UTC day (a second limit next to the budget, so repeated small drops cannot be farmed). */
const MAX_DROPS_PER_DAY = 5;

/** A drop the node refused (nothing was sent): its amount went back to the budget when it was refused, so it is neither spent nor counted toward the daily limit. */
const refusedDrop = sql`(${gasDrops.status} = 'failed' and ${gasDrops.txHash} is null)`;

/**
 * Gives back what an operation reserved but will never spend. Runs in the transaction that makes it terminal (cancel, stop, completion, failure) and is
 * idempotent: the remaining reservation is cleared. CANCELLED (nothing was ever submitted): the reservation per chain minus the drops actually sent for its
 * legs. Any other terminal status: only the reservation of legs that never sent (a Solana leg without a source transaction, an EVM drop never recorded),
 * because a submitted leg has spent its Solana fee and a recorded drop stays counted. ponytail: credited to the operation's creation day.
 */
export async function releaseUnspentGas(tx: Tx, opId: string): Promise<void> {
  const [op] = await tx.select({ userId: operations.userId, status: operations.status, reserved: operations.gasReserved, day: sql<string>`(${operations.createdAt} at time zone 'utc')::date` }).from(operations).where(eq(operations.id, opId));
  const reserved = op!.reserved;
  const unspent = new Map<string, bigint>();
  if (op!.status === "CANCELLED") {
    const sent = await tx.select({ chain: gasDrops.chain, total: sql<string>`sum(${gasDrops.amountNative})` }).from(gasDrops).innerJoin(operationLegs, eq(operationLegs.id, gasDrops.legId))
      .where(and(eq(operationLegs.operationId, opId), sql`not ${refusedDrop}`)).groupBy(gasDrops.chain);
    for (const [chain, r] of Object.entries(reserved)) unspent.set(chain, BigInt(r) - BigInt(sent.find((s) => s.chain === chain)?.total ?? 0));
  } else {
    const legs = await tx.select({ chain: operationLegs.fromChain, sourceTx: operationLegs.sourceTx, payer: operationLegs.gasPayer, expectedTx: operationLegs.expectedTx, hasDrop: sql<boolean>`exists (select 1 from app.gas_drops d where d.leg_id = app.operation_legs.id)` })
      .from(operationLegs).where(eq(operationLegs.operationId, opId));
    for (const l of legs) {
      const ex = (l.expectedTx ?? {}) as { gasReserved?: boolean; reservedNative?: string; gasDropNative?: string };
      const [chain, n] = l.payer === "platform_gas_drop" ? [l.chain, ex.gasReserved && !l.hasDrop ? ex.gasDropNative : undefined] : l.payer === "platform_fee_payer" && !l.sourceTx ? ["solana", ex.reservedNative] : [l.chain, undefined];
      if (n) unspent.set(chain, (unspent.get(chain) ?? 0n) + BigInt(n));
    }
    // Never more than what is still reserved (a refused drop already gave its amount back).
    for (const [chain, n] of unspent) unspent.set(chain, n < BigInt(reserved[chain] ?? 0) ? n : BigInt(reserved[chain] ?? 0));
  }
  for (const [chain, n] of unspent) {
    if (n > 0n) {
      await tx.update(sponsorUsage).set({ amountNative: sql`greatest(${sponsorUsage.amountNative} - ${n.toString()}::numeric, 0)` })
        .where(and(eq(sponsorUsage.userId, op!.userId), eq(sponsorUsage.chain, chain as AssetChain), sql`${sponsorUsage.day} = ${op!.day}`));
    }
  }
  await tx.update(operations).set({ gasReserved: {} }).where(eq(operations.id, opId));
}

/** A plan is refused (503) while a platform wallet cannot fund the gas it needs: the Solana fee payer in lamports, the EVM gas wallet in wei per chain. */
export async function assertWalletsCanFund(needs: Map<AssetChain, bigint>): Promise<void> {
  for (const [chain, amount] of needs) {
    if (amount <= 0n) continue;
    const balance = chain === "solana" ? await solanaBalance(await platformAddress("solana", "solana_fee_payer"), null) : await evmBalance(chain, gasWalletAddress(), null);
    if (balance < amount) {
      logger.error("platform gas wallet cannot fund a plan", { chain, balance: balance.toString(), needed: amount.toString() });
      throw createHttpError("Network gas is temporarily unavailable. Try again later.", { code: "ROUTE_UNAVAILABLE" });
    }
  }
}

export interface GasDropResult { status: "pending" | "confirmed" | "failed" | "skipped"; txHash: string | null }

/**
 * Sends the native gas an EVM-source leg needs from the platform gas wallet, once per leg: skipped when the recipient already holds `amountNative`;
 * otherwise the budget is reserved and the drop row recorded before anything is sent. A repeat call only reports (and, with a hash, confirms) the
 * existing drop; a drop whose send outcome is unknown stays `pending` and is never sent again.
 */
export async function sendGasDrop(legId: string, chain: AssetChain, recipient: string, amountNative: bigint, alsoSpends = 0n): Promise<GasDropResult> {
  const existing = async () => (await db.select().from(gasDrops).where(eq(gasDrops.legId, legId)))[0];
  let drop = await existing();
  if (!drop) {
    // `alsoSpends`: the amount the leg itself sends when the asset sold is the native one (a 100% sell needs value + gas).
    if ((await evmBalance(chain, recipient, null)) >= amountNative + alsoSpends) return { status: "skipped", txHash: null };
    try {
      drop = await db.transaction(async (tx) => {
        const [leg] = await tx.select({ userId: operations.userId, operationId: operations.id, expectedTx: operationLegs.expectedTx }).from(operationLegs).innerJoin(operations, eq(operations.id, operationLegs.operationId)).where(eq(operationLegs.id, legId));
        if (!leg) throw createHttpError("Leg not found", { code: "NOT_FOUND" });
        // Under the operation's row lock (the same one cancel takes), so a cancel either happens first (no drop) or sees this drop as spent (it is kept, not released).
        const [op] = await tx.select({ status: operations.status, expiresAt: operations.expiresAt }).from(operations).where(eq(operations.id, leg.operationId)).for("update");
        if (!op || (op.status !== "PLANNED" && op.status !== "IN_PROGRESS") || (op.status === "PLANNED" && op.expiresAt <= new Date())) throw createHttpError(409, "This operation is no longer open.", { code: "INVALID_TRANSITION" });
        const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(gasDrops).innerJoin(operationLegs, eq(operationLegs.id, gasDrops.legId)).innerJoin(operations, eq(operations.id, operationLegs.operationId))
          .where(and(eq(operations.userId, leg.userId), eq(gasDrops.chain, chain), sql`not ${refusedDrop}`, sql`(${gasDrops.createdAt} at time zone 'utc')::date = (now() at time zone 'utc')::date`))) as [{ n: number }];
        if (n >= MAX_DROPS_PER_DAY) throw createHttpError(409, "Today's gas top-ups for this network are used up. Try again tomorrow.", { code: "GAS_BUDGET_EXHAUSTED" });
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
      // One send at a time per chain from the single gas wallet, so concurrent drops cannot collide on a nonce.
      const txHash = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`gas-send:${chain}`}))`);
        return sendNativeFromGasWallet({ chain, to: recipient, value: amountNative });
      });
      [drop] = await db.update(gasDrops).set({ txHash, updatedAt: sql`now()` }).where(eq(gasDrops.id, drop.id)).returning();
      await writeAudit(db, { actorType: "system", action: "gas_drop.sent", entityType: "gas_drop", entityId: drop!.id, requestId: `gas-drop-${legId}`, metadata: { legId, chain, txHash } });
    } catch (err) {
      if ((err as { refused?: boolean }).refused) {
        // The node refused it (insufficient funds, nonce): nothing was sent, so this is a definite failure, not an unknown outcome. The amount goes back
        // to the budget (and to the operation's reservation when it was reserved with the plan); a stop that already released it as "sent" is not repeated.
        await db.transaction(async (tx) => {
          const [row] = await tx.update(gasDrops).set({ status: "failed", updatedAt: sql`now()` }).where(eq(gasDrops.id, drop!.id)).returning();
          const [{ operationId, expectedTx }] = (await tx.select({ operationId: operationLegs.operationId, expectedTx: operationLegs.expectedTx }).from(operationLegs).where(eq(operationLegs.id, legId))) as [{ operationId: string; expectedTx: unknown }];
          const [op] = await tx.select({ userId: operations.userId, reserved: operations.gasReserved, day: sql<string>`(${operations.createdAt} at time zone 'utc')::date` }).from(operations).where(eq(operations.id, operationId)).for("update");
          const planned = !!(expectedTx as { gasReserved?: boolean } | null)?.gasReserved;
          const n = amountNative.toString();
          await tx.update(sponsorUsage).set({ amountNative: sql`greatest(${sponsorUsage.amountNative} - ${n}::numeric, 0)` })
            .where(and(eq(sponsorUsage.userId, op!.userId), eq(sponsorUsage.chain, chain), planned ? sql`${sponsorUsage.day} = ${op!.day}` : sql`${sponsorUsage.day} = (now() at time zone 'utc')::date`));
          if (planned) {
            const left = BigInt(op!.reserved[chain] ?? 0) - amountNative;
            await tx.update(operations).set({ gasReserved: { ...op!.reserved, [chain]: (left > 0n ? left : 0n).toString() } }).where(eq(operations.id, operationId));
          }
          await writeAudit(tx, { actorType: "system", action: "gas_drop.failed", entityType: "gas_drop", entityId: row!.id, requestId: `gas-drop-${legId}`, metadata: { legId, chain, refused: true } });
        });
        return { status: "failed", txHash: null };
      }
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

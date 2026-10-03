import createHttpError from "http-errors";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from "drizzle-orm";
import {
  basketPositions, basketVersionAssets, basketVersions, baskets, db, instrumentDeployments, instruments, operationFees, operationLegs, notifications, operations, positionCashEntries, positionDecisions, positionLedgerEntries, positionReconciliations, type Tx,
} from "@repo/db";
import { logger } from "@repo/logger";
import {
  CONFIRMATIONS, DRIFT_THRESHOLD_BPS_DEFAULT, USDC_SOLANA_MINT, headlineOf, splitRepair, type AssetChain, type OperationView, type Portfolio, type PositionStates, type Repair, type ResolveLegRequest,
} from "@repo/validator";
import { env } from "@/config/dotenv";
import { bitcoinTx } from "@/providers/bitcoin";
import { evmBalance, evmNativeReceived, evmReceipt, gasWalletAddress } from "@/providers/evm-rpc";
import { routeProviderById } from "@/providers/routes";
import { feePayer, solanaBalance, solanaBlockTime, solanaFinality, solanaReceived } from "@/providers/solana-tx";
import { redis } from "@/middlewares/rate-limit.middleware";
import { enqueue } from "@/config/queues";
import { writeAudit } from "@/modules/audit/audit.service";
import { activeCustom, addressOn, closeIfEmpty, gasPayerFor, basketCashMicro, cancelIfExpired, inFlightAssets, lockOperation, markSubmitted, operationView, refreshOperationStatus, setLegStatus, setOperationStatus, stopStatus, userAddresses, walletBalance, type OpCtx } from "./operations";
import { versionDiff } from "@/modules/baskets/baskets.service";
import { notify } from "./notifications";
import { getPrices } from "@/modules/assets/pricing.service";
import { latestRecon, valuePosition } from "./rebalance";
import { routeDenyList } from "./routing";

const TRACK_WINDOW_MS = 30 * 60_000;
const MAX_RECHECKS = 168; // hourly, seven days
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
type Leg = typeof operationLegs.$inferSelect;
type Op = typeof operations.$inferSelect;

/**
 * `finalized` (enough confirmations), `failed` (the transaction reverted or errored), `expired` (Solana: never landed and its blockhash is gone, so it
 * never can) or `pending` (not seen or not final yet). Bitcoin and EVM cannot report "dropped": a replaced transaction stays pending until ops resolve it.
 */
async function finality(chain: AssetChain, tx: string, recentBlockhash?: string): Promise<"finalized" | "failed" | "expired" | "pending"> {
  if (chain === "solana") return solanaFinality(tx, recentBlockhash);
  if (chain === "bitcoin") return ((await bitcoinTx(tx))?.confirmations ?? 0) >= CONFIRMATIONS.bitcoin ? "finalized" : "pending";
  const receipt = await evmReceipt(chain, tx);
  if (!receipt) return "pending";
  if (!receipt.success) return "failed";
  return receipt.head - receipt.blockNumber + 1n >= BigInt(CONFIRMATIONS[chain]) ? "finalized" : "pending";
}

/** What `owner` received in `destinationTx`, from chain evidence only (Solana balance change, ERC-20 Transfer logs, native EVM balance delta at the block, Bitcoin outputs); null = not visible. */
async function receivedOnChain(chain: AssetChain, owner: string, token: string | null, destinationTx: string): Promise<bigint | null> {
  if (chain === "solana") return solanaReceived(destinationTx, owner, token);
  if (chain === "bitcoin") return (await bitcoinTx(destinationTx))?.outputs.filter((o) => o.address === owner).reduce((s, o) => s + o.value, 0n) ?? null;
  if (!token) return evmNativeReceived(chain, owner, destinationTx);
  const receipt = await evmReceipt(chain, destinationTx);
  if (!receipt) return null;
  const topic = `0x${"0".repeat(24)}${owner.slice(2).toLowerCase()}`;
  return receipt.logs.filter((l) => l.address === token.toLowerCase() && l.topics[0] === TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === topic).reduce((s, l) => s + BigInt(l.data), 0n);
}

const destinationToken = async (leg: Leg): Promise<string | null> =>
  leg.toDeploymentId ? (await db.select({ a: instrumentDeployments.address }).from(instrumentDeployments).where(eq(instrumentDeployments.id, leg.toDeploymentId)))[0]!.a : USDC_SOLANA_MINT;

/**
 * What leaves the position when a leg's funds are spent: a sale debits the sold asset (a plain sell also releases that share of basket cash, once per
 * operation), a rebalance buy spends basket cash. Invest and repair buys spend free USDC: no entry. Written when the leg settles, or, for a leg that
 * failed with a recovery (the funds left the wallet but arrived as another token), when it fails: once either way.
 */
async function writeSourceSide(tx: Tx, op: Op, leg: Leg): Promise<void> {
  if (op.kind === "invest" || op.kind === "repair") return;
  if (leg.fromDeploymentId) {
    await tx.insert(positionLedgerEntries).values({ positionId: op.positionId!, deploymentId: leg.fromDeploymentId, quantityDelta: (-BigInt(leg.amountIn)).toString(), reason: op.kind === "rebalance" ? "rebalance" : "sell", legId: leg.id });
    if (op.kind === "rebalance") return;
    // A sale to USDC releases that share of the basket cash (the USDC is in the wallet already), once, when the operation's first sell leg is spent.
    const [earlier] = await tx.select({ id: operationLegs.id }).from(operationLegs).where(and(eq(operationLegs.operationId, op.id), or(eq(operationLegs.status, "SETTLED"), isNotNull(operationLegs.recoveryToken)), isNotNull(operationLegs.fromDeploymentId), ne(operationLegs.id, leg.id))).limit(1);
    const released = earlier ? 0n : ((await basketCashMicro(tx, op.positionId!)) * BigInt(op.sellPercent!)) / 100n;
    if (released > 0n) await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: (-released).toString(), reason: "sell", legId: leg.id }).onConflictDoNothing();
  } else if (op.kind === "rebalance") {
    await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: (-BigInt(leg.amountIn)).toString(), reason: "rebalance_buy", legId: leg.id });
  }
}

/** Marks the leg SETTLED and, for asset legs, writes the ledger entry and recomputes the operation, in the caller's transaction (which holds the operation lock). */
async function settleLeg(tx: Tx, ctx: OpCtx | null, op: Op, leg: Leg, destinationTx: string | null, received: bigint | null): Promise<void> {
  await setLegStatus(tx, ctx, leg, "SETTLED", { destinationTx, amountReceived: received?.toString() ?? null });
  if (leg.kind === "network_fee") {
    // Every charged fee of the plan is paid by this one transaction: earnings and revenue count them from now on.
    await tx.update(operationFees).set({ settledAt: sql`now()` }).where(and(eq(operationFees.operationId, op.id), sql`${operationFees.amountMicro} > 0`));
    if (op.kind === "rebalance" && leg.routeSummary?.fromCash) await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: (-BigInt(leg.amountIn)).toString(), reason: "network_fee", legId: leg.id });
  } else {
    // A recovery completes the leg it recovers (the leg whose destination swap failed): that leg's source side was written when it failed, so only the
    // destination side follows here, by that leg's role, from what the recovery received.
    const [origin] = leg.recoveryOf ? await tx.select().from(operationLegs).where(eq(operationLegs.id, leg.recoveryOf)) : [];
    if (!origin) await writeSourceSide(tx, op, leg);
    const role = origin ?? leg;
    if (op.kind === "invest") {
      await tx.insert(positionLedgerEntries).values({ positionId: op.positionId ?? (await openPosition(tx, op)), deploymentId: leg.toDeploymentId!, quantityDelta: received!.toString(), reason: "invest", legId: leg.id });
    } else if (op.kind === "repair") {
      // What arrived is shared by shortfall; the excess stays outside baskets and any deficit stays SHORT.
      const shares = Object.entries(op.repairShares!).map(([positionId, s]) => ({ positionId, shortfall: BigInt(s) }));
      const parts = [...splitRepair(received!, shares)].filter(([, q]) => q > 0n);
      if (parts.length) await tx.insert(positionLedgerEntries).values(parts.map(([positionId, q]) => ({ positionId, deploymentId: leg.toDeploymentId!, quantityDelta: q.toString(), reason: "repair" as const, legId: leg.id })));
    } else if (role.fromDeploymentId) {
      // Sell side: a rebalance sale's proceeds become basket cash; a plain sell's proceeds are wallet USDC already.
      if (op.kind === "rebalance") await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: received!.toString(), reason: "rebalance_sell", legId: leg.id });
    } else {
      // Rebalance buy.
      await tx.insert(positionLedgerEntries).values({ positionId: op.positionId!, deploymentId: leg.toDeploymentId!, quantityDelta: received!.toString(), reason: "rebalance", legId: leg.id });
    }
  }
  await refreshOperationStatus(tx, ctx, op.id);
  // A sale that settled the last of the position closes it (after the operation itself is over).
  if (op.kind === "sell_to_usdc") await closeIfEmpty(tx, ctx, op.positionId!);
}

/**
 * Follows one submitted leg to its end, never submitting anything. The first run (12 attempts, backing off) throws while the leg is not final; after
 * 30 minutes the leg becomes UNKNOWN. Hourly rechecks (1..168) then run until it settles or fails: a recheck never throws, so an RPC or provider
 * error cannot end the chain, and every recheck that leaves the leg open schedules the next one.
 */
export async function trackLeg(legId: string, recheck = 0): Promise<void> {
  let open = true;
  try {
    open = await trackOnce(legId, recheck);
  } catch (err) {
    if (!recheck) throw err;
    logger.warn("leg recheck failed; the next one is scheduled", { legId, recheck, errMessage: err instanceof Error ? err.message : "unknown" });
    await markStaleUnknown(legId);
  }
  if (recheck > 0 && open && recheck < MAX_RECHECKS) await enqueue("track-leg", { legId, recheck: recheck + 1 });
}

/** A leg that errored past the 30-minute window still becomes UNKNOWN, so the user can see and stop it. */
async function markStaleUnknown(legId: string): Promise<void> {
  const [row] = await db.select({ leg: operationLegs }).from(operationLegs).where(eq(operationLegs.id, legId));
  if (!row || !["SUBMITTED", "PENDING_CHAIN"].includes(row.leg.status) || Date.now() - (row.leg.submittedAt?.getTime() ?? Date.now()) < TRACK_WINDOW_MS) return;
  await db.transaction(async (tx) => {
    await lockOperation(tx, row.leg.operationId);
    const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, legId));
    if (current && ["SUBMITTED", "PENDING_CHAIN"].includes(current.status)) await setLegStatus(tx, null, current, "UNKNOWN", { unknownSince: sql`now()` as unknown as Date });
  });
}

/**
 * Liveness sweep (every 5 minutes). Legs claimed (SUBMITTING) but never confirmed as sent, for example after a crash between the claim and the send,
 * are handed to the tracker. A SUBMITTED or PENDING_CHAIN leg past the 30-minute window whose tracking job is gone (a queue outage, a flushed Redis) is
 * checked right here in recheck mode, which makes it UNKNOWN (so the user can stop and ops can resolve it) and restarts the recheck chain.
 */
export async function trackStaleClaims(): Promise<void> {
  const claimed = await db.select({ id: operationLegs.id }).from(operationLegs).where(and(eq(operationLegs.status, "SUBMITTING"), sql`${operationLegs.updatedAt} < now() - interval '2 minutes'`));
  for (const l of claimed) await enqueue("track-leg", { legId: l.id }).catch((err) => logger.warn("sweep: could not enqueue a claimed leg", { legId: l.id, errMessage: err instanceof Error ? err.message : "unknown" }));
  const stuck = await db.select({ id: operationLegs.id }).from(operationLegs).where(and(inArray(operationLegs.status, ["SUBMITTED", "PENDING_CHAIN"]), sql`${operationLegs.submittedAt} < now() - interval '35 minutes'`));
  for (const l of stuck) await trackLeg(l.id, 1).catch((err) => logger.warn("sweep: recheck of a stuck leg failed", { legId: l.id, errMessage: err instanceof Error ? err.message : "unknown" }));
}

/** Plans nobody touched are cancelled once expired (nothing claimed or submitted), which frees the user's slot and releases the unspent gas reservation. */
export async function expireStalePlans(): Promise<void> {
  const due = await db.select({ id: operations.id }).from(operations).where(and(eq(operations.status, "PLANNED"), sql`${operations.expiresAt} <= now()`));
  for (const { id } of due) {
    try {
      await db.transaction(async (tx) => { await cancelIfExpired(tx, null, await lockOperation(tx, id)); });
    } catch (err) {
      logger.warn("sweep: could not expire a plan", { operationId: id, errMessage: err instanceof Error ? err.message : "unknown" });
    }
  }
}

const RECOVERY_AUTO_STOP_DAYS = 7;

/**
 * A recovery leg nobody signed for 7 days stops its operation, as the user's Stop would (PARTIAL: the tokens that arrived are in their wallet), releases the
 * unsent reservations (via the terminal status), is audited and tells the user. Only a still-PLANNED recovery qualifies, re-checked under the operation's
 * lock: one that was claimed or sent meanwhile (SUBMITTING and later), or any leg in flight, is left alone.
 */
export async function stopStalledRecoveries(): Promise<void> {
  const due = await db.selectDistinct({ id: operationLegs.operationId }).from(operationLegs).innerJoin(operations, eq(operations.id, operationLegs.operationId))
    .where(and(isNotNull(operationLegs.recoveryOf), eq(operationLegs.status, "PLANNED"), eq(operations.status, "IN_PROGRESS"), sql`${operationLegs.createdAt} < now() - ${`${RECOVERY_AUTO_STOP_DAYS} days`}::interval`));
  for (const { id } of due) {
    try {
      const notificationId = await db.transaction(async (tx) => {
        const op = await lockOperation(tx, id);
        const legs = await tx.select().from(operationLegs).where(eq(operationLegs.operationId, id));
        const stalled = legs.some((l) => l.recoveryOf && l.status === "PLANNED" && Date.now() - l.createdAt.getTime() >= RECOVERY_AUTO_STOP_DAYS * 86_400_000);
        if (op.status !== "IN_PROGRESS" || !stalled || legs.some((l) => ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN"].includes(l.status))) return null;
        await setOperationStatus(tx, null, op, stopStatus(legs));
        await writeAudit(tx, { actorType: "system", actorUserId: op.userId, action: "operation.auto_stopped", entityType: "operation", entityId: op.id, requestId: `auto-stop-${op.id}`, metadata: { reason: "recovery_unsent" } });
        const [b] = op.basketId ? await tx.select({ slug: baskets.slug, name: sql<string>`(select v.name from app.basket_versions v where v.basket_id = ${baskets.id} order by v.version_number desc limit 1)` }).from(baskets).where(eq(baskets.id, op.basketId)) : [];
        return notify(tx, {
          userId: op.userId, kind: "execution_incomplete", basketId: op.basketId ?? undefined, positionId: op.positionId ?? undefined,
          data: { basketName: b?.name, basketSlug: b?.slug, operationId: op.id, asset: op.deploymentId ?? undefined, autoStopped: true }, dedupeKey: `incomplete:${op.id}`,
        });
      });
      if (notificationId) await enqueue("notifications", { job: "deliver", notificationId });
    } catch (err) {
      logger.warn("sweep: could not auto-stop an operation", { operationId: id, errMessage: err instanceof Error ? err.message : "unknown" });
    }
  }
}

/** Returns whether the leg is still open (needs another check). */
async function trackOnce(legId: string, recheck: number): Promise<boolean> {
  const [row] = await db.select({ leg: operationLegs, op: operations }).from(operationLegs).innerJoin(operations, eq(operations.id, operationLegs.operationId)).where(eq(operationLegs.id, legId));
  if (!row || !["SUBMITTING", "SUBMITTED", "PENDING_CHAIN", "UNKNOWN"].includes(row.leg.status) || !row.leg.sourceTx) return false;
  const { op } = row;
  const sourceTx = row.leg.sourceTx;
  let { leg } = row;
  if (leg.status === "SUBMITTING") {
    // Claimed but never confirmed as sent (see `trackStaleClaims`): the outcome is unknown, so it is followed like any submitted leg.
    await markSubmitted(null, op.id, leg.id);
    leg = { ...leg, status: "SUBMITTED" };
  }
  const fail = async (reason: string) => {
    await db.transaction(async (tx) => {
      await lockOperation(tx, op.id);
      await setLegStatus(tx, null, leg, "FAILED", { failureReason: reason });
      await refreshOperationStatus(tx, null, op.id);
    });
    return false;
  };
  const goUnknown = async () => {
    if (leg.status !== "UNKNOWN") {
      await db.transaction(async (tx) => { await lockOperation(tx, op.id); await setLegStatus(tx, null, leg, "UNKNOWN", { unknownSince: sql`now()` as unknown as Date }); });
      leg = { ...leg, status: "UNKNOWN" };
    }
    if (!recheck) await enqueue("track-leg", { legId, recheck: 1 });
    return true;
  };
  const notFinal = async () => {
    if (leg.status === "UNKNOWN") return true;
    if (Date.now() - (leg.submittedAt?.getTime() ?? Date.now()) >= TRACK_WINDOW_MS) return goUnknown();
    if (!recheck) throw new Error("leg is not final yet");
    return true;
  };

  const recentBlockhash = (leg.expectedTx as { recentBlockhash?: string } | null)?.recentBlockhash;
  const source = await finality(leg.fromChain, sourceTx, recentBlockhash);
  if (source === "failed") return fail("The source transaction failed.");
  if (source === "expired") return fail("The transaction never landed and its blockhash expired, so it can no longer execute.");
  if (source === "pending") return notFinal();
  if (leg.status === "SUBMITTED") {
    await db.transaction(async (tx) => { await lockOperation(tx, op.id); await setLegStatus(tx, null, leg, "PENDING_CHAIN"); });
    leg = { ...leg, status: "PENDING_CHAIN" };
  }

  // Destination: the same transaction for a one-chain leg; otherwise the route provider's status, then the destination transaction itself.
  let destinationTx = sourceTx;
  if (leg.fromChain !== leg.toChain) {
    const status = await routeProviderById(leg.provider ?? "")!.status({ txHash: sourceTx, fromChain: leg.fromChain, toChain: leg.toChain });
    if (status.substatus && status.substatus !== leg.providerSubstatus) {
      await db.update(operationLegs).set({ providerSubstatus: status.substatus }).where(eq(operationLegs.id, leg.id));
      leg = { ...leg, providerSubstatus: status.substatus };
    }
    if (status.state === "FAILED") return fail(`The route failed: ${status.reason}.`);
    if (status.state === "UNKNOWN") {
      // LI.FI finished the transfer but delivered a different token: the destination swap failed. With chain evidence of what arrived, the operation gets a
      // user-signed recovery leg (delivered token -> the intended asset); without it, or for a recovery leg itself, a person resolves it as before.
      const delivered = status.receiving;
      const evmOrSolana = leg.toChain !== "bitcoin";
      if (status.substatus === "PARTIAL" && delivered && leg.kind === "cross_chain" && !leg.recoveryOf && evmOrSolana && op.status === "IN_PROGRESS") {
        if ((await finality(leg.toChain, delivered.txHash)) !== "finalized") return notFinal();
        const addresses = await userAddresses(db, op.userId);
        const owner = addressOn(addresses, leg.toChain);
        const native = /^0x(0{40}|e{40})$/i.test(delivered.token.address) || delivered.token.address === "11111111111111111111111111111111";
        const evidenced = await receivedOnChain(leg.toChain, owner, native ? null : delivered.token.address, delivered.txHash);
        if (evidenced !== null && evidenced > 0n) {
          // Network calls stay outside the database transaction: the estimate first, then the writes under the operation lock.
          const [target] = leg.toDeploymentId ? await db.select({ address: instrumentDeployments.address, decimals: instrumentDeployments.decimals, symbol: instruments.symbol }).from(instrumentDeployments).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId)).where(eq(instrumentDeployments.id, leg.toDeploymentId)) : [];
          const toToken = leg.toDeploymentId ? target!.address : USDC_SOLANA_MINT; // a sell's proceeds are USDC on Solana
          // The token that arrived is the intended one already: there is nothing to swap, a person resolves it.
          const arrivedAsTarget = !native && toToken !== null && delivered.token.address.toLowerCase() === toToken.toLowerCase();
          const estimate = arrivedAsTarget ? null : await routeProviderById(leg.provider ?? "")!.estimate({
            fromChain: leg.toChain, fromToken: native ? null : delivered.token.address, toChain: leg.toChain, toToken, fromAmount: evidenced, toAddress: owner, slippageBps: op.slippageBps, deny: await routeDenyList(leg.toChain, owner),
          }).catch((err: unknown) => {
            logger.warn("recovery estimate failed; the leg stays unknown", { legId, errMessage: err instanceof Error ? err.message : "unknown" });
            return null;
          });
          if (estimate) {
            const created = await db.transaction(async (tx) => {
              const locked = await lockOperation(tx, op.id);
              const [again] = await tx.select({ id: operationLegs.id }).from(operationLegs).where(eq(operationLegs.recoveryOf, leg.id));
              const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, leg.id));
              if (again) return true; // an earlier run created it
              if (locked.status !== "IN_PROGRESS" || !["PENDING_CHAIN", "UNKNOWN"].includes(current!.status)) return false; // the operation was stopped: ops resolve the leg
              const recoveryToken = { chain: leg.toChain, address: native ? null : delivered.token.address, decimals: delivered.token.decimals, symbol: delivered.token.symbol, amount: evidenced.toString() };
              await setLegStatus(tx, null, current!, "FAILED", { failureReason: "DESTINATION_SWAP_FAILED", destinationTx: delivered.txHash, recoveryToken });
              await writeSourceSide(tx, locked, current!);
              const [{ next }] = await tx.select({ next: sql<number>`max(${operationLegs.sequence}) + 1` }).from(operationLegs).where(eq(operationLegs.operationId, op.id)) as [{ next: number }];
              const payer = gasPayerFor(leg.toChain);
              await tx.insert(operationLegs).values({
                operationId: op.id, sequence: next, kind: "swap", fromChain: leg.toChain, fromDeploymentId: null, toChain: leg.toChain, toDeploymentId: leg.toDeploymentId, amountIn: evidenced.toString(), minOut: estimate.minOut.toString(),
                provider: leg.provider, gasPayer: payer, recoveryOf: leg.id,
                routeSummary: { fromToken: recoveryToken.address, fromSymbol: recoveryToken.symbol, fromDecimals: recoveryToken.decimals, symbol: target?.symbol ?? "USDC", decimals: target?.decimals ?? 6, tool: estimate.toolSummary, estimatedOut: estimate.estimatedOut.toString(), routeFees: estimate.routeFees, priceImpact: estimate.priceImpact },
                // The gas is reserved when the recovery is quoted, under the per-chain lock and the daily caps (an EVM drop is sized here, x1.5 x2 like an ERC-20 sell).
                expectedTx: payer === "platform_gas_drop" ? { gasReserved: false, gasDropNative: ((estimate.gasNative * (native ? 3n : 4n)) / 2n).toString() } : { gasReserved: false },
              });
              return true;
            });
            if (created) return false;
          }
        }
      }
      return goUnknown();
    }
    if (status.state === "PENDING") return notFinal();
    // Every ledger amount rests on a destination transaction we can read: without its hash the leg waits (and becomes UNKNOWN), never guesses.
    if (!status.destinationTx) return notFinal();
    destinationTx = status.destinationTx;
    const dest = await finality(leg.toChain, destinationTx);
    if (dest === "failed") return fail("The destination transaction failed.");
    if (dest !== "finalized") return notFinal();
  }

  let received: bigint | null = null;
  if (leg.kind !== "network_fee") {
    received = await receivedOnChain(leg.toChain, addressOn(await userAddresses(db, op.userId), leg.toChain), await destinationToken(leg), destinationTx);
    if (received === null) return notFinal();
    // Delivered per the provider but nothing is visible for the user: an unclear outcome, reconciled by hand, never retried.
    if (received <= 0n) return goUnknown();
  }

  await db.transaction(async (tx) => {
    await lockOperation(tx, op.id);
    await settleLeg(tx, null, op, leg, destinationTx, received);
  });
  if (leg.kind === "network_fee") {
    // The fee's on-chain time buckets revenue by day (settled_at is when this server noticed). Outside the transaction: a read failure only leaves the fallback.
    try {
      const blockTime = await solanaBlockTime(sourceTx);
      if (blockTime) await db.update(operationFees).set({ settledChainAt: blockTime }).where(and(eq(operationFees.legId, leg.id), isNull(operationFees.settledChainAt)));
    } catch (err) {
      logger.warn("fee block time unavailable", { legId: leg.id, errMessage: err instanceof Error ? err.message : "unknown" });
    }
  }
  return false;
}

/**
 * Ops resolution of a leg stuck UNKNOWN (a dropped EVM or Bitcoin transaction, a delivery that cannot be read). SETTLED is only written from chain
 * evidence this server reads itself: the destination transaction must be final and the amount received must match what the chain shows; only where the
 * chain cannot show it (a native EVM balance the node cannot serve) does the supplied amount stand, and the audit says so. FAILED cannot contradict a
 * finalized same-chain transaction.
 */
export async function resolveLeg(ctx: OpCtx, opId: string, legId: string, body: ResolveLegRequest): Promise<OperationView> {
  const [row] = await db.select({ leg: operationLegs, op: operations }).from(operationLegs).innerJoin(operations, eq(operations.id, operationLegs.operationId)).where(and(eq(operationLegs.id, legId), eq(operations.id, opId)));
  if (!row) throw createHttpError("Leg not found", { code: "NOT_FOUND" });
  const { leg, op } = row;
  if (leg.status !== "UNKNOWN") throw createHttpError(409, "Only a leg whose outcome is unknown can be resolved.", { code: "INVALID_TRANSITION" });
  const conflict = (message: string) => createHttpError(409, message, { code: "INVALID_TRANSITION" });
  let received: bigint | null = null;
  let verified = true;
  if (body.status === "FAILED") {
    if (leg.fromChain === leg.toChain && leg.sourceTx && (await finality(leg.fromChain, leg.sourceTx)) === "finalized") throw conflict("The transaction finalized on-chain: it did not fail.");
  } else if (leg.kind === "network_fee") {
    if (!leg.sourceTx || (await finality(leg.fromChain, leg.sourceTx)) !== "finalized") throw conflict("The fee transaction is not final on-chain.");
  } else {
    if ((await finality(leg.toChain, body.txEvidence)) !== "finalized") throw conflict("The destination transaction is not final on-chain.");
    received = await receivedOnChain(leg.toChain, addressOn(await userAddresses(db, op.userId), leg.toChain), await destinationToken(leg), body.txEvidence);
    if (received === null) {
      if (!body.amountReceived) throw conflict("The chain does not show the amount: supply amountReceived.");
      [received, verified] = [BigInt(body.amountReceived), false];
    } else if (body.amountReceived && BigInt(body.amountReceived) !== received) throw conflict(`The chain shows ${received} received, not ${body.amountReceived}.`);
    if (received <= 0n) throw conflict("Nothing was received in that transaction.");
  }
  await db.transaction(async (tx) => {
    await lockOperation(tx, op.id);
    const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, leg.id));
    if (current!.status !== "UNKNOWN") throw conflict("This leg changed. Reload and try again.");
    if (body.status === "SETTLED") await settleLeg(tx, ctx, op, current!, leg.kind === "network_fee" ? null : body.txEvidence, received);
    else {
      await setLegStatus(tx, ctx, current!, "FAILED", { failureReason: `Resolved by ops: ${body.reason}` });
      await refreshOperationStatus(tx, ctx, op.id);
    }
    await writeAudit(tx, {
      actorType: "user", actorUserId: ctx.userId, sessionId: ctx.sessionId, requestId: ctx.meta.requestId, action: "leg.resolved_by_ops", entityType: "operation_leg", entityId: leg.id,
      metadata: { status: body.status, txEvidence: body.txEvidence, reason: body.reason, amountReceived: received?.toString() ?? null, verifiedOnChain: verified },
    });
  });
  const [fresh] = await db.select().from(operations).where(eq(operations.id, op.id));
  return operationView(db, fresh!);
}

/** The user's OPEN position in the basket (created by the first settled invest leg) and the operation's link to it. */
async function openPosition(tx: Tx, op: typeof operations.$inferSelect): Promise<string> {
  const basketId = op.basketId!; // invest operations always have a basket (only repairs do not)
  await tx.insert(basketPositions).values({ userId: op.userId, basketId, appliedVersionId: op.versionId }).onConflictDoNothing();
  const [p] = await tx.select({ id: basketPositions.id }).from(basketPositions).where(and(eq(basketPositions.userId, op.userId), eq(basketPositions.basketId, basketId), eq(basketPositions.status, "OPEN")));
  await tx.update(operations).set({ positionId: p!.id }).where(eq(operations.id, op.id));
  await writeAudit(tx, { actorType: "system", actorUserId: op.userId, action: "position.opened", entityType: "basket_position", entityId: p!.id, requestId: `track-${op.id}`, metadata: { basketId } });
  return p!.id;
}

/**
 * The shortfall of a wallet balance against what positions record, shared pro-rata by recorded amount; the remainder goes to the largest position
 * (the first listed on a tie, so callers order by `openedAt`). Surplus is not allocated.
 */
function shareShortfall(recorded: bigint[], wallet: bigint): { shares: bigint[]; shortfall: bigint; total: bigint } {
  const total = recorded.reduce((a, b) => a + b, 0n);
  const shortfall = wallet < total ? total - wallet : 0n;
  const shares = recorded.map((l) => (total > 0n ? (shortfall * l) / total : 0n));
  if (shortfall > 0n) shares[recorded.indexOf(recorded.reduce((m, l) => (l > m ? l : m), 0n))]! += shortfall - shares.reduce((a, b) => a + b, 0n);
  return { shares, shortfall, total };
}

/**
 * Compares what each user's open positions record with what their wallets hold, per deployment and for basket cash (USDC on Solana), and appends the
 * result. Surplus stays outside baskets; a shortfall is shared pro-rata by recorded quantity (the remainder to the largest position, the oldest on a
 * tie). Then each open position's weights are checked against its target (drift). A new shortfall and drift raise inbox notices, deduplicated; their
 * `deliver` jobs are enqueued once everything is written.
 */
export async function reconcilePositions(userId?: string): Promise<void> {
  const open = await db.select({
    id: basketPositions.id, userId: basketPositions.userId, basketId: basketPositions.basketId, openedAt: basketPositions.openedAt, appliedVersionId: basketPositions.appliedVersionId,
    slug: baskets.slug, name: sql<string>`(select v.name from app.basket_versions v where v.basket_id = ${baskets.id} order by v.version_number desc limit 1)`,
  }).from(basketPositions).innerJoin(baskets, eq(baskets.id, basketPositions.basketId)).where(and(eq(basketPositions.status, "OPEN"), userId ? eq(basketPositions.userId, userId) : undefined))
    .orderBy(asc(basketPositions.openedAt), asc(basketPositions.id));
  const info = new Map(open.map((p) => [p.id, p]));
  const busy = await inFlightAssets(db, userId);
  const toDeliver: string[] = [];

  /** Appends reconciliation rows; a row that is SHORT where the previous one was not raises `repair_required` (one per row). */
  const record = async (items: { positionId: string; deploymentId: string | null; ledger: bigint; allocated: bigint; wallet: bigint; status: "OK" | "SHORT" | "SURPLUS" }[]) => {
    const previous = await Promise.all(items.map(async (i) => (await db.select({ status: positionReconciliations.status }).from(positionReconciliations)
      .where(and(eq(positionReconciliations.positionId, i.positionId), i.deploymentId ? eq(positionReconciliations.deploymentId, i.deploymentId) : isNull(positionReconciliations.deploymentId)))
      .orderBy(desc(positionReconciliations.checkedAt), desc(positionReconciliations.id)).limit(1))[0]?.status));
    const inserted = await db.insert(positionReconciliations).values(items.map((i) => ({
      positionId: i.positionId, deploymentId: i.deploymentId, ledgerQuantity: i.ledger.toString(), allocatedQuantity: i.allocated.toString(), walletBalance: i.wallet.toString(), status: i.status,
    }))).returning({ id: positionReconciliations.id });
    for (const [n, i] of items.entries()) {
      if (i.status !== "SHORT" || previous[n] === "SHORT") continue;
      const p = info.get(i.positionId)!;
      const asset = i.deploymentId ?? "cash";
      const id = await notify(db, { userId: p.userId, kind: "repair_required", basketId: p.basketId, positionId: p.id, data: { basketName: p.name, basketSlug: p.slug, asset }, dedupeKey: `short:${p.id}:${asset}:${inserted[n]!.id}` });
      if (id) toDeliver.push(id);
    }
  };

  const rows = await db.select({
    userId: basketPositions.userId, positionId: positionLedgerEntries.positionId, deploymentId: positionLedgerEntries.deploymentId, quantity: sql<string>`sum(${positionLedgerEntries.quantityDelta})`,
    chain: instrumentDeployments.chain, address: instrumentDeployments.address, opened: basketPositions.openedAt,
  }).from(positionLedgerEntries).innerJoin(basketPositions, eq(basketPositions.id, positionLedgerEntries.positionId)).innerJoin(instrumentDeployments, eq(instrumentDeployments.id, positionLedgerEntries.deploymentId))
    .where(and(eq(basketPositions.status, "OPEN"), userId ? eq(basketPositions.userId, userId) : undefined))
    .groupBy(basketPositions.userId, positionLedgerEntries.positionId, positionLedgerEntries.deploymentId, instrumentDeployments.chain, instrumentDeployments.address, basketPositions.openedAt)
    .orderBy(asc(basketPositions.openedAt), asc(positionLedgerEntries.positionId));
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(`${r.userId}:${r.deploymentId}`, [...(groups.get(`${r.userId}:${r.deploymentId}`) ?? []), r]);
  for (const group of groups.values()) {
    try {
      const first = group[0]!;
      if (busy.get(first.userId)?.has(first.deploymentId!)) continue; // a leg is in flight: the wallet and the ledger are not comparable yet
      const ledger = group.map((g) => BigInt(g.quantity));
      let wallet: bigint;
      try {
        wallet = await walletBalance(await userAddresses(db, first.userId), first.chain, first.address);
      } catch (err) {
        logger.warn("reconciliation skipped: balance unavailable", { deploymentId: first.deploymentId, errMessage: err instanceof Error ? err.message : "unknown" });
        continue;
      }
      const { shares, shortfall, total } = shareShortfall(ledger, wallet);
      await record(group.map((g, n) => ({
        positionId: g.positionId, deploymentId: g.deploymentId, ledger: ledger[n]!, allocated: ledger[n]! - shares[n]!, wallet,
        status: shortfall > 0n ? (shares[n]! > 0n ? ("SHORT" as const) : ("OK" as const)) : wallet > total ? ("SURPLUS" as const) : ("OK" as const),
      })));
    } catch (err) {
      logger.warn("reconciliation of one holding failed; continuing", { deploymentId: group[0]?.deploymentId, errMessage: err instanceof Error ? err.message : "unknown" });
    }
  }

  // Basket cash is USDC the wallet must still hold: the same comparison, against the cash entries of the user's open positions.
  const cash = !open.length ? [] : await db.select({ positionId: positionCashEntries.positionId, amount: sql<string>`sum(${positionCashEntries.amountMicro})` }).from(positionCashEntries)
    .where(inArray(positionCashEntries.positionId, open.map((p) => p.id))).groupBy(positionCashEntries.positionId);
  const cashByUser = new Map<string, { positionId: string; amount: bigint }[]>();
  for (const p of open) {
    const amount = BigInt(cash.find((c) => c.positionId === p.id)?.amount ?? "0");
    if (amount > 0n) cashByUser.set(p.userId, [...(cashByUser.get(p.userId) ?? []), { positionId: p.id, amount }]);
  }
  for (const [owner, list] of cashByUser) {
    try {
      if (busy.has(owner)) continue; // every leg touches USDC on Solana
      let wallet: bigint;
      try {
        wallet = await walletBalance(await userAddresses(db, owner), "solana", USDC_SOLANA_MINT);
      } catch (err) {
        logger.warn("cash reconciliation skipped: balance unavailable", { errMessage: err instanceof Error ? err.message : "unknown" });
        continue;
      }
      const { shares, shortfall, total } = shareShortfall(list.map((c) => c.amount), wallet);
      await record(list.map((c, n) => ({
        positionId: c.positionId, deploymentId: null, ledger: c.amount, allocated: c.amount - shares[n]!, wallet,
        status: shortfall > 0n ? (shares[n]! > 0n ? ("SHORT" as const) : ("OK" as const)) : wallet > total ? ("SURPLUS" as const) : ("OK" as const),
      })));
    } catch (err) {
      logger.warn("cash reconciliation of one user failed; continuing", { userId: owner, errMessage: err instanceof Error ? err.message : "unknown" });
    }
  }

  // Drift. ponytail: one valuation (and price lookup) per open position; batch the prices if the nightly run gets slow.
  for (const p of open) {
    if (busy.has(p.userId)) continue; // allocated quantities are not settled yet
    try {
      const val = await valuePosition(db, p.id);
      if (!val.fresh || val.holdings.length === 0) continue; // without every price the stored state is left as it was
      const [version] = await db.select({ assetsRevision: basketVersions.assetsRevision, rebalance: basketVersions.rebalance }).from(basketVersions).where(eq(basketVersions.id, p.appliedVersionId));
      const threshold = version!.rebalance.driftThresholdBps ?? DRIFT_THRESHOLD_BPS_DEFAULT;
      const custom = await activeCustom(db, p.id);
      const target = custom
        ? (custom.data.weights as Record<string, number>)
        : Object.fromEntries((await db.select({ instrumentId: basketVersionAssets.instrumentId, bps: basketVersionAssets.targetWeightBps }).from(basketVersionAssets)
          .where(and(eq(basketVersionAssets.versionId, p.appliedVersionId), eq(basketVersionAssets.revision, version!.assetsRevision)))).map((a) => [a.instrumentId, a.bps]));
      const actual = new Map(val.holdings.map((h) => [h.instrumentId, h.weightBps]));
      const moved = [...new Set([...actual.keys(), ...Object.keys(target)])].some((i) => Math.abs((actual.get(i) ?? 0) - (target[i] ?? 0)) >= threshold);
      const next = moved ? ("WEIGHT_DRIFT" as const) : custom ? ("CUSTOMIZED" as const) : ("ALIGNED" as const);
      const id = await db.transaction(async (tx) => {
        await tx.update(basketPositions).set({ allocationStatus: next, allocationCheckedAt: sql`now()` }).where(eq(basketPositions.id, p.id));
        if (custom && moved) await tx.insert(positionDecisions).values({ positionId: p.id, kind: "revert_custom", data: { reason: "moved" }, actorUserId: p.userId });
        if (next !== "WEIGHT_DRIFT") return null;
        // A prompt at most once a week while the position stays drifted; the dedupe key also makes a repeated run on one day a no-op.
        const [recent] = await tx.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.positionId, p.id), eq(notifications.kind, "drifted"), sql`${notifications.createdAt} > now() - interval '7 days'`)).limit(1);
        return recent ? null : notify(tx, { userId: p.userId, kind: "drifted", basketId: p.basketId, positionId: p.id, data: { basketName: p.name, basketSlug: p.slug }, dedupeKey: `drifted:${p.id}:${new Date().toISOString().slice(0, 10)}` });
      });
      if (id) toDeliver.push(id);
    } catch (err) {
      logger.warn("drift check of one position failed; continuing", { positionId: p.id, errMessage: err instanceof Error ? err.message : "unknown" });
    }
  }
  for (const id of toDeliver) await enqueue("notifications", { job: "deliver", notificationId: id });
}

const STALE_AFTER_MS = 26 * 3_600_000;

/** Positions with holdings (ledger sums), values, weights, states and the latest reconciliation; shortfalls to repair; open operations; former (closed) positions. */
export async function getPortfolio(ctx: OpCtx): Promise<Portfolio> {
  // At most one on-demand reconciliation a minute per user; a provider outage never breaks the portfolio.
  if (await redis.set(`reconcile:user:${ctx.userId}`, "1", "EX", 60, "NX").catch(() => null)) {
    await reconcilePositions(ctx.userId).catch((err) => logger.warn("reconciliation failed", { errMessage: err instanceof Error ? err.message : "unknown" }));
  }
  const positions = await db.select({
    p: basketPositions, slug: baskets.slug, name: sql<string>`coalesce((select v.name from app.basket_versions v where v.id = ${baskets.currentVersionId}), ${basketVersions.name})`, currentVersionId: baskets.currentVersionId, assetsRevision: basketVersions.assetsRevision, appliedNumber: basketVersions.versionNumber, rebalance: basketVersions.rebalance,
  }).from(basketPositions)
    .innerJoin(baskets, eq(baskets.id, basketPositions.basketId)).innerJoin(basketVersions, eq(basketVersions.id, basketPositions.appliedVersionId))
    .where(eq(basketPositions.userId, ctx.userId)).orderBy(desc(basketPositions.openedAt));
  const ids = positions.map((x) => x.p.id);
  const holdings = ids.length ? await db.select({
    positionId: positionLedgerEntries.positionId, deploymentId: positionLedgerEntries.deploymentId, quantity: sql<string>`sum(${positionLedgerEntries.quantityDelta})`, instrumentId: instruments.id, symbol: instruments.symbol,
    chain: instrumentDeployments.chain, decimals: instrumentDeployments.decimals,
  }).from(positionLedgerEntries).innerJoin(instrumentDeployments, eq(instrumentDeployments.id, positionLedgerEntries.deploymentId)).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId))
    .where(inArray(positionLedgerEntries.positionId, ids)).groupBy(positionLedgerEntries.positionId, positionLedgerEntries.deploymentId, instruments.id, instruments.symbol, instrumentDeployments.chain, instrumentDeployments.decimals) : [];
  const recon = await latestRecon(db, { userId: ctx.userId });
  const targets = ids.length ? await db.select({ versionId: basketVersionAssets.versionId, revision: basketVersionAssets.revision, instrumentId: basketVersionAssets.instrumentId, bps: basketVersionAssets.targetWeightBps })
    .from(basketVersionAssets).where(inArray(basketVersionAssets.versionId, positions.map((x) => x.p.appliedVersionId))) : [];
  const prices = await getPrices([...new Set(holdings.map((h) => h.instrumentId))]);
  const cash = ids.length ? await db.select({ positionId: positionCashEntries.positionId, amount: sql<string>`sum(${positionCashEntries.amountMicro})` }).from(positionCashEntries).where(inArray(positionCashEntries.positionId, ids)).groupBy(positionCashEntries.positionId) : [];
  const skips = ids.length ? await db.select({ positionId: positionDecisions.positionId, versionId: positionDecisions.versionId }).from(positionDecisions).where(and(inArray(positionDecisions.positionId, ids), eq(positionDecisions.kind, "skip"))) : [];
  const latestRebalance = ids.length ? await db.selectDistinctOn([operations.positionId], { positionId: operations.positionId, status: operations.status }).from(operations)
    .where(and(inArray(operations.positionId, ids), eq(operations.kind, "rebalance"), ne(operations.status, "CANCELLED"))).orderBy(operations.positionId, desc(operations.createdAt)) : [];
  const newerIds = [...new Set(positions.filter((x) => x.p.status === "OPEN" && x.currentVersionId && x.currentVersionId !== x.p.appliedVersionId).map((x) => x.currentVersionId!))];
  const newer = newerIds.length ? await db.select().from(basketVersions).where(inArray(basketVersions.id, newerIds)) : [];
  const diffs = new Map(await Promise.all(newer.map(async (v) => [v.id, await versionDiff(db, v)] as const)));
  const open = await db.select().from(operations).where(and(eq(operations.userId, ctx.userId), inArray(operations.status, ["PLANNED", "IN_PROGRESS"])));

  const view = positions.map(({ p, slug, name, currentVersionId, assetsRevision, appliedNumber, rebalance }) => {
    // Display only: values are decimal approximations of quantity x market price.
    const mine = holdings.filter((h) => h.positionId === p.id && BigInt(h.quantity) > 0n).map((h) => {
      const price = prices.find((x) => x.instrumentId === h.instrumentId && x.kind === "market" && x.status === "ok");
      return { h, usd: price?.value ? (Number(h.quantity) / 10 ** h.decimals) * Number(price.value) : null };
    });
    const total = mine.every((m) => m.usd !== null) ? mine.reduce((s, m) => s + m.usd!, 0) : null;
    const rows = recon.filter((r) => r.positionId === p.id);
    const latest = newer.find((v) => v.id === currentVersionId && v.id !== p.appliedVersionId);
    const states: PositionStates = {
      version: !latest ? "CURRENT" : skips.some((s) => s.positionId === p.id && s.versionId === latest.id) ? "SKIPPED" : "OUT_OF_DATE",
      backing: rows.some((r) => r.status === "SHORT") ? "REPAIR_REQUIRED"
        : rows.length === 0 || Date.now() - Math.max(...rows.map((r) => r.checkedAt.getTime())) > STALE_AFTER_MS || mine.some((m) => m.usd === null) ? "DATA_STALE" : "VERIFIED",
      allocation: p.allocationStatus,
      execution: open.some((o) => o.positionId === p.id) ? "PENDING" : ["PARTIAL", "FAILED"].includes(latestRebalance.find((o) => o.positionId === p.id)?.status ?? "") ? "INCOMPLETE" : "NONE",
    };
    return {
      id: p.id, basketId: p.basketId, basketSlug: slug, basketName: name, status: p.status, openedAt: p.openedAt.toISOString(), closedAt: p.closedAt?.toISOString() ?? null,
      holdings: mine.map(({ h, usd }) => ({
        deploymentId: h.deploymentId, instrumentId: h.instrumentId, symbol: h.symbol, chain: h.chain, quantity: h.quantity, decimals: h.decimals, valueUsd: usd === null ? null : usd.toFixed(2),
        actualBps: total && usd !== null ? Math.round((usd / total) * 10_000) : null,
        targetBps: targets.find((t) => t.versionId === p.appliedVersionId && t.revision === assetsRevision && t.instrumentId === h.instrumentId)?.bps ?? null,
        reconciliation: rows.find((r) => r.deploymentId === h.deploymentId)?.status ?? null,
      })),
      states, headline: headlineOf(states), cashMicro: cash.find((c) => c.positionId === p.id)?.amount ?? "0",
      latestVersion: latest ? { id: latest.id, number: latest.versionNumber, rationale: latest.rationale, diff: diffs.get(latest.id)! } : null,
      appliedVersionNumber: appliedNumber, driftThresholdBps: rebalance.driftThresholdBps ?? DRIFT_THRESHOLD_BPS_DEFAULT,
    };
  });
  const openView = view.filter((p) => p.status === "OPEN");

  // One repair per short deployment (or basket cash) across every basket, never one per basket.
  const repairs: Repair[] = [];
  for (const r of recon.filter((x) => x.status === "SHORT")) {
    const asset = r.deploymentId ?? "cash";
    const entry = repairs.find((x) => x.asset === asset) ?? repairs[repairs.push({ asset, symbol: r.deploymentId ? (holdings.find((h) => h.deploymentId === r.deploymentId)?.symbol ?? "") : "USDC", totalShortfall: "0", positions: [] }) - 1]!;
    entry.totalShortfall = (BigInt(entry.totalShortfall) + r.ledger - r.allocated).toString();
    entry.positions.push({ positionId: r.positionId, basketSlug: positions.find((x) => x.p.id === r.positionId)?.slug ?? "", ledger: r.ledger.toString(), shortfall: (r.ledger - r.allocated).toString() });
  }
  const past = await db.select().from(operations).where(and(eq(operations.userId, ctx.userId), notInArray(operations.status, ["PLANNED", "IN_PROGRESS"]))).orderBy(desc(operations.createdAt)).limit(20);
  return {
    positions: openView, repairs, formerPositions: view.filter((p) => p.status === "CLOSED"),
    openOperations: await Promise.all(open.map((o) => operationView(db, o))), history: await Promise.all(past.map((o) => operationView(db, o))),
  };
}

/** Platform gas wallet balances against fixed floors (native units); a low wallet is a warning log for ops. */
export async function checkGasWallets(): Promise<void> {
  const ether = 10n ** 18n;
  const floors: [AssetChain, bigint][] = [["ethereum", ether / 100n], ["base", ether / 100n], ["arbitrum", ether / 100n], ["bnb", ether / 20n], ["polygon", 10n * ether]];
  const low: { wallet: string; balance: string; floor: string }[] = [];
  if (env.SOLANA_FEE_PAYER_SECRET) {
    const balance = await solanaBalance(feePayer().publicKey.toBase58(), null);
    if (balance < 500_000_000n) low.push({ wallet: "solana_fee_payer", balance: balance.toString(), floor: "500000000" });
  }
  for (const [chain, floor] of env.EVM_GAS_WALLET_SECRET ? floors : []) {
    try {
      const balance = await evmBalance(chain, gasWalletAddress(), null);
      if (balance < floor) low.push({ wallet: `evm_gas:${chain}`, balance: balance.toString(), floor: floor.toString() });
    } catch (err) {
      logger.warn("gas wallet balance unavailable", { chain, errMessage: err instanceof Error ? err.message : "unknown" });
    }
  }
  for (const l of low) logger.warn("platform gas wallet is low", l);
}

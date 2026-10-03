import createHttpError from "http-errors";
import { and, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { basketPositions, baskets, db, instrumentDeployments, instruments, operationFees, operationLegs, operations, positionCashEntries, positionLedgerEntries, type Tx } from "@repo/db";
import { logger } from "@repo/logger";
import { CONFIRMATIONS, USDC_SOLANA_MINT, splitRepair, type AssetChain, type OperationView, type ResolveLegRequest } from "@repo/validator";
import { bitcoinTx } from "@/providers/bitcoin";
import { evmNativeReceived, evmReceipt } from "@/providers/evm-rpc";
import { routeProviderById } from "@/providers/routes";
import { solanaBlockTime, solanaFinality, solanaReceived } from "@/providers/solana-tx";
import { enqueue } from "@/config/queues";
import { writeAudit } from "@/modules/audit/audit.service";
import { closeIfEmpty, basketCashMicro, cancelIfExpired, lockOperation, operationView, refreshOperationStatus, setLegStatus, setOperationStatus, stopStatus, type OpCtx } from "@/modules/operations/operations.service";
import { addressOn, userAddresses } from "@/modules/auth/wallets.service";
import { gasPayerFor } from "@/modules/operations/plan.service";
import { markSubmitted } from "@/modules/operations/submit.service";
import { notify } from "@/modules/notifications/notifications.service";
import { routeDenyList } from "@/modules/routing/routing.service";

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

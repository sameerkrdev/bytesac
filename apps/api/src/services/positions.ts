import createHttpError from "http-errors";
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  basketPositions, basketVersionAssets, basketVersions, baskets, db, instrumentDeployments, instruments, operationLegs, operations, positionCashEntries, positionLedgerEntries, positionReconciliations, type Tx,
} from "@repo/db";
import { logger } from "@repo/logger";
import { CONFIRMATIONS, USDC_SOLANA_MINT, splitRepair, type AssetChain, type OperationView, type Portfolio, type ResolveLegRequest } from "@repo/validator";
import { env } from "../env";
import { bitcoinTx } from "../providers/bitcoin";
import { evmBalance, evmNativeReceived, evmReceipt, gasWalletAddress } from "../providers/evm-rpc";
import { routeProviderById } from "../providers/routes";
import { feePayer, solanaBalance, solanaFinality, solanaReceived } from "../providers/solana-tx";
import { redis } from "../middleware/rate-limit";
import { enqueue } from "../queues";
import { writeAudit } from "./audit";
import { addressOn, cancelIfExpired, lockOperation, markSubmitted, operationView, refreshOperationStatus, setLegStatus, userAddresses, walletBalance, type OpCtx } from "./operations";
import { getPrices } from "./pricing";

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

/** Marks the leg SETTLED and, for asset legs, writes the ledger entry and recomputes the operation, in the caller's transaction (which holds the operation lock). */
async function settleLeg(tx: Tx, ctx: OpCtx | null, op: Op, leg: Leg, destinationTx: string | null, received: bigint | null): Promise<void> {
  await setLegStatus(tx, ctx, leg, "SETTLED", { destinationTx, amountReceived: received?.toString() ?? null });
  if (leg.kind === "network_fee") {
    if (op.kind === "rebalance" && leg.routeSummary?.fromCash) await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: (-BigInt(leg.amountIn)).toString(), reason: "network_fee", legId: leg.id });
  } else if (op.kind === "invest") {
    await tx.insert(positionLedgerEntries).values({ positionId: op.positionId ?? (await openPosition(tx, op)), deploymentId: leg.toDeploymentId!, quantityDelta: received!.toString(), reason: "invest", legId: leg.id });
  } else if (op.kind === "repair") {
    // What arrived is shared by shortfall; the excess stays outside baskets and any deficit stays SHORT.
    const shares = Object.entries(op.repairShares!).map(([positionId, s]) => ({ positionId, shortfall: BigInt(s) }));
    const parts = [...splitRepair(received!, shares)].filter(([, q]) => q > 0n);
    if (parts.length) await tx.insert(positionLedgerEntries).values(parts.map(([positionId, q]) => ({ positionId, deploymentId: leg.toDeploymentId!, quantityDelta: q.toString(), reason: "repair" as const, legId: leg.id })));
  } else if (leg.fromDeploymentId) {
    // Sell side (sell_to_usdc, sell_former, rebalance sell).
    await tx.insert(positionLedgerEntries).values({ positionId: op.positionId!, deploymentId: leg.fromDeploymentId, quantityDelta: (-BigInt(leg.amountIn)).toString(), reason: op.kind === "rebalance" ? "rebalance" : "sell", legId: leg.id });
    if (op.kind === "rebalance") await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: received!.toString(), reason: "rebalance_sell", legId: leg.id });
  } else {
    // Rebalance buy.
    await tx.insert(positionCashEntries).values({ positionId: op.positionId!, amountMicro: (-BigInt(leg.amountIn)).toString(), reason: "rebalance_buy", legId: leg.id });
    await tx.insert(positionLedgerEntries).values({ positionId: op.positionId!, deploymentId: leg.toDeploymentId!, quantityDelta: received!.toString(), reason: "rebalance", legId: leg.id });
  }
  await refreshOperationStatus(tx, ctx, op.id);
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
  for (const l of claimed) await enqueue("track-leg", { legId: l.id });
  const stuck = await db.select({ id: operationLegs.id }).from(operationLegs).where(and(inArray(operationLegs.status, ["SUBMITTED", "PENDING_CHAIN"]), sql`${operationLegs.submittedAt} < now() - interval '35 minutes'`));
  for (const l of stuck) await trackLeg(l.id, 1);
}

/** Plans nobody touched are cancelled once expired (nothing claimed or submitted), which frees the user's slot and releases the unspent gas reservation. */
export async function expireStalePlans(): Promise<void> {
  const due = await db.select({ id: operations.id }).from(operations).where(and(eq(operations.status, "PLANNED"), sql`${operations.expiresAt} <= now()`));
  for (const { id } of due) await db.transaction(async (tx) => { await cancelIfExpired(tx, null, await lockOperation(tx, id)); });
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
    if (status.state === "FAILED") return fail(`The route failed: ${status.reason}.`);
    if (status.state === "UNKNOWN") return goUnknown();
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
 * Compares what each user's open positions record with what their wallets hold, per deployment, and appends the result. Surplus stays outside
 * baskets; a shortfall is shared pro-rata by recorded quantity (the remainder to the largest position, the oldest on a tie).
 */
export async function reconcilePositions(userId?: string): Promise<void> {
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
    const first = group[0]!;
    const ledger = group.map((g) => BigInt(g.quantity));
    const total = ledger.reduce((a, b) => a + b, 0n);
    let wallet: bigint;
    try {
      wallet = await walletBalance(await userAddresses(db, first.userId), first.chain, first.address);
    } catch (err) {
      logger.warn("reconciliation skipped: balance unavailable", { deploymentId: first.deploymentId, errMessage: err instanceof Error ? err.message : "unknown" });
      continue;
    }
    const shortfall = wallet < total ? total - wallet : 0n;
    const shares = ledger.map((l) => (total > 0n ? (shortfall * l) / total : 0n));
    if (shortfall > 0n) shares[ledger.indexOf(ledger.reduce((m, l) => (l > m ? l : m), 0n))]! += shortfall - shares.reduce((a, b) => a + b, 0n);
    await db.insert(positionReconciliations).values(group.map((g, n) => ({
      positionId: g.positionId, deploymentId: g.deploymentId, ledgerQuantity: ledger[n]!.toString(), allocatedQuantity: (ledger[n]! - shares[n]!).toString(), walletBalance: wallet.toString(),
      status: shortfall > 0n ? (shares[n]! > 0n ? ("SHORT" as const) : ("OK" as const)) : wallet > total ? ("SURPLUS" as const) : ("OK" as const),
    })));
  }
}

/** Positions with holdings (ledger sums), values, weights and the latest reconciliation; open operations; former (closed) positions. */
export async function getPortfolio(ctx: OpCtx): Promise<Portfolio> {
  // At most one on-demand reconciliation a minute per user; a provider outage never breaks the portfolio.
  if (await redis.set(`reconcile:user:${ctx.userId}`, "1", "EX", 60, "NX").catch(() => null)) {
    await reconcilePositions(ctx.userId).catch((err) => logger.warn("reconciliation failed", { errMessage: err instanceof Error ? err.message : "unknown" }));
  }
  const positions = await db.select({ p: basketPositions, slug: baskets.slug, assetsRevision: basketVersions.assetsRevision }).from(basketPositions)
    .innerJoin(baskets, eq(baskets.id, basketPositions.basketId)).innerJoin(basketVersions, eq(basketVersions.id, basketPositions.appliedVersionId))
    .where(eq(basketPositions.userId, ctx.userId)).orderBy(desc(basketPositions.openedAt));
  const ids = positions.map((x) => x.p.id);
  const holdings = ids.length ? await db.select({
    positionId: positionLedgerEntries.positionId, deploymentId: positionLedgerEntries.deploymentId, quantity: sql<string>`sum(${positionLedgerEntries.quantityDelta})`, instrumentId: instruments.id, symbol: instruments.symbol,
    chain: instrumentDeployments.chain, decimals: instrumentDeployments.decimals,
  }).from(positionLedgerEntries).innerJoin(instrumentDeployments, eq(instrumentDeployments.id, positionLedgerEntries.deploymentId)).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId))
    .where(inArray(positionLedgerEntries.positionId, ids)).groupBy(positionLedgerEntries.positionId, positionLedgerEntries.deploymentId, instruments.id, instruments.symbol, instrumentDeployments.chain, instrumentDeployments.decimals) : [];
  const recon = ids.length ? await db.selectDistinctOn([positionReconciliations.positionId, positionReconciliations.deploymentId], { positionId: positionReconciliations.positionId, deploymentId: positionReconciliations.deploymentId, status: positionReconciliations.status })
    .from(positionReconciliations).where(inArray(positionReconciliations.positionId, ids)).orderBy(positionReconciliations.positionId, positionReconciliations.deploymentId, desc(positionReconciliations.checkedAt)) : [];
  const targets = ids.length ? await db.select({ versionId: basketVersionAssets.versionId, revision: basketVersionAssets.revision, instrumentId: basketVersionAssets.instrumentId, bps: basketVersionAssets.targetWeightBps })
    .from(basketVersionAssets).where(inArray(basketVersionAssets.versionId, positions.map((x) => x.p.appliedVersionId))) : [];
  const prices = await getPrices([...new Set(holdings.map((h) => h.instrumentId))]);

  const view = positions.map(({ p, slug, assetsRevision }) => {
    // Display only: values are decimal approximations of quantity x market price.
    const mine = holdings.filter((h) => h.positionId === p.id && BigInt(h.quantity) > 0n).map((h) => {
      const price = prices.find((x) => x.instrumentId === h.instrumentId && x.kind === "market" && x.status === "ok");
      return { h, usd: price?.value ? (Number(h.quantity) / 10 ** h.decimals) * Number(price.value) : null };
    });
    const total = mine.every((m) => m.usd !== null) ? mine.reduce((s, m) => s + m.usd!, 0) : null;
    return {
      id: p.id, basketId: p.basketId, basketSlug: slug, status: p.status, openedAt: p.openedAt.toISOString(), closedAt: p.closedAt?.toISOString() ?? null,
      holdings: mine.map(({ h, usd }) => ({
        deploymentId: h.deploymentId, instrumentId: h.instrumentId, symbol: h.symbol, chain: h.chain, quantity: h.quantity, decimals: h.decimals, valueUsd: usd === null ? null : usd.toFixed(2),
        actualBps: total && usd !== null ? Math.round((usd / total) * 10_000) : null,
        targetBps: targets.find((t) => t.versionId === p.appliedVersionId && t.revision === assetsRevision && t.instrumentId === h.instrumentId)?.bps ?? null,
        reconciliation: recon.find((r) => r.positionId === p.id && r.deploymentId === h.deploymentId)?.status ?? null,
      })),
    };
  });
  const open = await db.select().from(operations).where(and(eq(operations.userId, ctx.userId), inArray(operations.status, ["PLANNED", "IN_PROGRESS"])));
  const past = await db.select().from(operations).where(and(eq(operations.userId, ctx.userId), notInArray(operations.status, ["PLANNED", "IN_PROGRESS"]))).orderBy(desc(operations.createdAt)).limit(20);
  return {
    positions: view.filter((p) => p.status === "OPEN"), formerPositions: view.filter((p) => p.status === "CLOSED"),
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

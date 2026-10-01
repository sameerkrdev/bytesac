import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  basketPositions, basketVersionAssets, basketVersions, baskets, db, instrumentDeployments, instruments, operationLegs, operations, positionLedgerEntries, positionReconciliations, type Tx,
} from "@repo/db";
import { logger } from "@repo/logger";
import { CONFIRMATIONS, USDC_SOLANA_MINT, type AssetChain, type Portfolio } from "@repo/validator";
import { env } from "../env";
import { bitcoinTx } from "../providers/bitcoin";
import { evmBalance, evmReceipt, gasWalletAddress } from "../providers/evm-rpc";
import { routeProviderById } from "../providers/routes";
import { feePayer, solanaBalance, solanaFinality, solanaReceived } from "../providers/solana-tx";
import { redis } from "../middleware/rate-limit";
import { enqueue } from "../queues";
import { writeAudit } from "./audit";
import { addressOn, lockOperation, operationView, refreshOperationStatus, setLegStatus, userAddresses, walletBalance, type OpCtx } from "./operations";
import { getPrices } from "./pricing";

const TRACK_WINDOW_MS = 30 * 60_000;
const MAX_RECHECKS = 168; // hourly, seven days
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/** `finalized` (enough confirmations), `failed` (the transaction reverted or errored) or `pending` (not seen or not final yet). */
async function finality(chain: AssetChain, tx: string): Promise<"finalized" | "failed" | "pending"> {
  if (chain === "solana") return solanaFinality(tx);
  if (chain === "bitcoin") return ((await bitcoinTx(tx))?.confirmations ?? 0) >= CONFIRMATIONS.bitcoin ? "finalized" : "pending";
  const receipt = await evmReceipt(chain, tx);
  if (!receipt) return "pending";
  if (!receipt.success) return "failed";
  return receipt.head - receipt.blockNumber + 1n >= BigInt(CONFIRMATIONS[chain]) ? "finalized" : "pending";
}

/**
 * Follows one submitted leg to its end, never submitting anything. Not final yet: throws, so BullMQ backs off; after 30 minutes the leg becomes
 * UNKNOWN and is re-checked hourly (`recheck` 1..168) until it settles, fails, or the week is up and ops take over.
 */
export async function trackLeg(legId: string, recheck = 0): Promise<void> {
  const [row] = await db.select({ leg: operationLegs, op: operations }).from(operationLegs).innerJoin(operations, eq(operations.id, operationLegs.operationId)).where(eq(operationLegs.id, legId));
  if (!row || !["SUBMITTED", "PENDING_CHAIN", "UNKNOWN"].includes(row.leg.status) || !row.leg.sourceTx) return;
  const { op } = row;
  const sourceTx = row.leg.sourceTx;
  let { leg } = row;
  const fail = async (reason: string) => {
    await db.transaction(async (tx) => {
      await lockOperation(tx, op.id);
      await setLegStatus(tx, null, leg, "FAILED", { failureReason: reason });
      await refreshOperationStatus(tx, null, op.id);
    });
  };
  const notFinal = async () => {
    if (leg.status === "UNKNOWN") {
      if (recheck < MAX_RECHECKS) await enqueue("track-leg", { legId, recheck: recheck + 1 });
      return;
    }
    if (Date.now() - (leg.submittedAt?.getTime() ?? Date.now()) < TRACK_WINDOW_MS) throw new Error("leg is not final yet");
    await db.transaction(async (tx) => {
      await lockOperation(tx, op.id);
      await setLegStatus(tx, null, leg, "UNKNOWN", { unknownSince: sql`now()` as unknown as Date });
    });
    await enqueue("track-leg", { legId, recheck: 1 });
  };

  const source = await finality(leg.fromChain, sourceTx);
  if (source === "failed") return fail("The source transaction failed.");
  if (source === "pending") return notFinal();
  if (leg.status === "SUBMITTED") {
    await db.transaction(async (tx) => { await lockOperation(tx, op.id); await setLegStatus(tx, null, leg, "PENDING_CHAIN"); });
    leg = { ...leg, status: "PENDING_CHAIN" };
  }

  // Destination: the same transaction for a one-chain leg; otherwise the route provider's status, then the destination transaction itself.
  let destinationTx = sourceTx;
  let providerAmount: bigint | null = null;
  if (leg.fromChain !== leg.toChain) {
    const status = await routeProviderById(leg.provider ?? "")!.status({ txHash: sourceTx, fromChain: leg.fromChain, toChain: leg.toChain });
    if (status.state === "FAILED") return fail(`The route failed: ${status.reason}.`);
    if (status.state === "PENDING") return notFinal();
    destinationTx = status.destinationTx ?? "";
    providerAmount = status.receivedAmount;
    if (destinationTx) {
      const dest = await finality(leg.toChain, destinationTx);
      if (dest === "failed") return fail("The destination transaction failed.");
      if (dest === "pending") return notFinal();
    }
  }

  // What actually arrived: from chain evidence (Solana token balance change, ERC-20 Transfer logs, Bitcoin outputs). A bridged native EVM
  // asset has no log to read, so the provider's reported amount is used and the nightly reconciliation checks it against the wallet.
  let received: bigint | null = null;
  const addresses = await userAddresses(db, op.userId);
  if (leg.kind !== "network_fee") {
    const owner = addressOn(addresses, leg.toChain);
    const token = leg.toDeploymentId ? (await db.select({ a: instrumentDeployments.address }).from(instrumentDeployments).where(eq(instrumentDeployments.id, leg.toDeploymentId)))[0]!.a : USDC_SOLANA_MINT;
    if (leg.toChain === "solana") received = await solanaReceived(destinationTx, owner, token);
    else if (leg.toChain === "bitcoin") received = (await bitcoinTx(destinationTx))?.outputs.filter((o) => o.address === owner).reduce((s, o) => s + o.value, 0n) ?? null;
    else if (token && destinationTx) {
      const logs = (await evmReceipt(leg.toChain, destinationTx))?.logs ?? [];
      const topic = `0x${"0".repeat(24)}${owner.slice(2).toLowerCase()}`;
      received = logs.filter((l) => l.address === token.toLowerCase() && l.topics[0] === TRANSFER_TOPIC && l.topics[2]?.toLowerCase() === topic).reduce((s, l) => s + BigInt(l.data), 0n);
    } else received = providerAmount;
    if (received === null) return notFinal();
    if (received <= 0n) {
      // Delivered per the provider but nothing is visible for the user: an unclear outcome, reconciled by hand, never retried.
      if (leg.status !== "UNKNOWN") await db.transaction(async (tx) => { await lockOperation(tx, op.id); await setLegStatus(tx, null, leg, "UNKNOWN", { unknownSince: sql`now()` as unknown as Date }); });
      return;
    }
  }

  await db.transaction(async (tx) => {
    await lockOperation(tx, op.id);
    await setLegStatus(tx, null, leg, "SETTLED", { destinationTx: destinationTx || null, amountReceived: received?.toString() ?? null });
    if (leg.kind !== "network_fee") {
      const positionId = op.positionId ?? (await openPosition(tx, op));
      await tx.insert(positionLedgerEntries).values(op.kind === "invest"
        ? { positionId, deploymentId: leg.toDeploymentId!, quantityDelta: received!.toString(), reason: "invest" as const, legId: leg.id }
        : { positionId, deploymentId: leg.fromDeploymentId!, quantityDelta: (-BigInt(leg.amountIn)).toString(), reason: "sell" as const, legId: leg.id });
    }
    await refreshOperationStatus(tx, null, op.id);
  });
}

/** The user's OPEN position in the basket (created by the first settled invest leg) and the operation's link to it. */
async function openPosition(tx: Tx, op: typeof operations.$inferSelect): Promise<string> {
  await tx.insert(basketPositions).values({ userId: op.userId, basketId: op.basketId, appliedVersionId: op.versionId }).onConflictDoNothing();
  const [p] = await tx.select({ id: basketPositions.id }).from(basketPositions).where(and(eq(basketPositions.userId, op.userId), eq(basketPositions.basketId, op.basketId), eq(basketPositions.status, "OPEN")));
  await tx.update(operations).set({ positionId: p!.id }).where(eq(operations.id, op.id));
  await writeAudit(tx, { actorType: "system", actorUserId: op.userId, action: "position.opened", entityType: "basket_position", entityId: p!.id, requestId: `track-${op.id}`, metadata: { basketId: op.basketId } });
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

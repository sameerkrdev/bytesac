import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { basketPositions, basketVersionAssets, basketVersions, baskets, db, instrumentDeployments, notifications, positionCashEntries, positionDecisions, positionLedgerEntries, positionReconciliations } from "@repo/db";
import { logger } from "@repo/logger";
import { DRIFT_THRESHOLD_BPS_DEFAULT, USDC_SOLANA_MINT } from "@repo/validator";
import { enqueue } from "@/config/queues";
import { activeCustom, inFlightAssets } from "@/modules/operations/operations.service";
import { userAddresses, walletBalance } from "@/modules/auth/wallets.service";
import { notify } from "@/modules/notifications/notifications.service";
import { valuePosition } from "./valuation.service";

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

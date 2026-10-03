import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { basketPositions, basketVersionAssets, basketVersions, baskets, db, instrumentDeployments, instruments, operations, positionCashEntries, positionDecisions, positionLedgerEntries } from "@repo/db";
import { logger } from "@repo/logger";
import { DRIFT_THRESHOLD_BPS_DEFAULT, headlineOf, type Portfolio, type PositionStates, type Repair } from "@repo/validator";
import { redis } from "@/middlewares/rate-limit.middleware";
import { operationView, type OpCtx } from "@/modules/operations/operations.service";
import { versionDiff } from "@/modules/baskets/baskets.service";
import { getPrices } from "@/modules/assets/pricing.service";
import { latestRecon } from "./valuation.service";
import { reconcilePositions } from "./reconciliation.service";

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

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { basketPositions, instrumentDeployments, instruments, positionLedgerEntries, positionReconciliations, type DbOrTx } from "@repo/db";
import type { AssetChain } from "@repo/validator";
import { basketCashMicro } from "@/modules/operations/operations.service";
import { getPrices, priceToMicro } from "@/modules/assets/pricing.service";
import createHttpError from "http-errors";

/** The newest reconciliation row per (position, deployment) for the user's OPEN positions; a null deployment is the basket-cash row. */
export async function latestRecon(conn: DbOrTx, f: { userId?: string; positionId?: string }) {
  const rows = await conn.selectDistinctOn([positionReconciliations.positionId, positionReconciliations.deploymentId], {
    positionId: positionReconciliations.positionId, deploymentId: positionReconciliations.deploymentId, ledger: positionReconciliations.ledgerQuantity, allocated: positionReconciliations.allocatedQuantity,
    wallet: positionReconciliations.walletBalance, status: positionReconciliations.status, checkedAt: positionReconciliations.checkedAt, openedAt: basketPositions.openedAt, appliedVersionId: basketPositions.appliedVersionId,
  }).from(positionReconciliations).innerJoin(basketPositions, eq(basketPositions.id, positionReconciliations.positionId))
    .where(and(eq(basketPositions.status, "OPEN"), f.userId ? eq(basketPositions.userId, f.userId) : undefined, f.positionId ? eq(positionReconciliations.positionId, f.positionId) : undefined))
    .orderBy(positionReconciliations.positionId, positionReconciliations.deploymentId, desc(positionReconciliations.checkedAt), desc(positionReconciliations.id));
  return rows.map((r) => ({ ...r, ledger: BigInt(r.ledger), allocated: BigInt(r.allocated), wallet: BigInt(r.wallet) }));
}

export interface ValuedHolding {
  deploymentId: string; instrumentId: string; symbol: string; chain: AssetChain; address: string | null; decimals: number;
  /** The allocated quantity (the latest reconciliation; the ledger when none exists), raw units. */
  quantity: bigint; walletBalance: bigint | null; reconciledAt: Date | null;
  /** Micro-USD per whole token from a fresh market price; null = missing or stale. */
  priceMicro: bigint | null; valueMicro: bigint; weightBps: number;
}

export interface Valuation { holdings: ValuedHolding[]; cashMicro: bigint; valueMicro: bigint; fresh: boolean; priceByInstrument: Map<string, bigint> }

/**
 * The one valuation of a position: allocated quantity x fresh market price per held deployment, the basket cash, and each holding's weight in bps of the
 * total (cash included). Used to plan a rebalance, to snapshot a keep-custom allocation and to detect drift. `fresh` is false when any held asset has no
 * fresh price; `extraInstrumentIds` adds prices (planner targets) to `priceByInstrument`.
 */
export async function valuePosition(conn: DbOrTx, positionId: string, extraInstrumentIds: string[] = []): Promise<Valuation> {
  const ledger = await conn.select({
    deploymentId: positionLedgerEntries.deploymentId, quantity: sql<string>`sum(${positionLedgerEntries.quantityDelta})`, instrumentId: instruments.id, symbol: instruments.symbol,
    chain: instrumentDeployments.chain, address: instrumentDeployments.address, decimals: instrumentDeployments.decimals,
  }).from(positionLedgerEntries).innerJoin(instrumentDeployments, eq(instrumentDeployments.id, positionLedgerEntries.deploymentId)).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId))
    .where(eq(positionLedgerEntries.positionId, positionId)).groupBy(positionLedgerEntries.deploymentId, instruments.id, instruments.symbol, instrumentDeployments.chain, instrumentDeployments.address, instrumentDeployments.decimals)
    .orderBy(asc(instrumentDeployments.chain), asc(positionLedgerEntries.deploymentId));
  const recon = await latestRecon(conn, { positionId });
  const held = ledger.filter((l) => BigInt(l.quantity) > 0n);
  const prices = await getPrices([...new Set([...held.map((h) => h.instrumentId), ...extraInstrumentIds])]);
  const priceByInstrument = new Map<string, bigint>();
  for (const p of prices) {
    const price = p.kind === "market" && p.status === "ok" && !p.stale && p.value ? priceToMicro(p.value) : null;
    if (price) priceByInstrument.set(p.instrumentId, price);
  }
  const cashMicro = await basketCashMicro(conn, positionId);
  const draft = held.map((h) => {
    const r = recon.find((x) => x.deploymentId === h.deploymentId);
    const quantity = r ? r.allocated : BigInt(h.quantity);
    const priceMicro = priceByInstrument.get(h.instrumentId) ?? null;
    return { ...h, quantity, walletBalance: r?.wallet ?? null, reconciledAt: r?.checkedAt ?? null, priceMicro, valueMicro: priceMicro === null ? 0n : (quantity * priceMicro) / 10n ** BigInt(h.decimals) };
  });
  const valueMicro = sum(draft.map((h) => h.valueMicro)) + cashMicro;
  return {
    holdings: draft.map((h) => ({ ...h, weightBps: valueMicro > 0n ? Number((h.valueMicro * 10_000n) / valueMicro) : 0 })),
    cashMicro, valueMicro, fresh: draft.every((h) => h.priceMicro !== null), priceByInstrument,
  };
}

export const sum = (s: bigint[]) => s.reduce((a, b) => a + b, 0n);

export const stale = (message: string) => createHttpError(409, message, { code: "DATA_STALE" });

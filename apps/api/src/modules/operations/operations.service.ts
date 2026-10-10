import createHttpError from "http-errors";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { basketPositions, baskets, contacts, db, instrumentDeployments, operationLegs, operations, operationFees, organizations, positionCashEntries, positionDecisions, positionLedgerEntries, type DbOrTx, type Tx } from "@repo/db";
import { LEG_TRANSITIONS, OPERATION_TRANSITIONS, USDC_SOLANA_MINT, canTransition, minOut, type OperationView, type WaivedReason } from "@repo/validator";
import type { RouteFee } from "@/providers/routes/types";
import type { RequestMeta } from "@/middlewares/request-context.middleware";
import { enqueue } from "@/config/queues";
import { writeAudit } from "@/modules/audit/audit.service";
import { releaseUnspentGas } from "./gas.service";
import { notify } from "@/modules/notifications/notifications.service";
import { orgDisplayName } from "@/modules/members/members.service";
import { getPrices } from "@/modules/assets/pricing.service";
import type { AssetChain } from "@repo/validator";
import { bitcoinBalance } from "@/providers/bitcoin";
import { evmBalance } from "@/providers/evm-rpc";
import { solanaBalance, SOLANA_FEE_TRANSFER_LAMPORTS } from "@/providers/solana-tx";
import { type Addresses, addressOn } from "@/modules/auth/wallets.service";

export { SOLANA_FEE_TRANSFER_LAMPORTS };

export interface OpCtx { userId: string; sessionId: string; meta: RequestMeta }

export type Op = typeof operations.$inferSelect;

export type Leg = typeof operationLegs.$inferSelect;

export const PLAN_TTL = "30 minutes";

/** ponytail: a flat estimate for the network-fee transfer's own cost (two signatures plus the fee-leg priority fee). */
export const FEE_LEG_GAS_USD = 0.005;

/** Investing needs a verified email and phone. */
export async function assertVerifiedContacts(userId: string): Promise<void> {
  const verified = await db.select({ type: contacts.type }).from(contacts).where(and(eq(contacts.userId, userId), eq(contacts.status, "verified"), inArray(contacts.type, ["email", "phone"])));
  if (verified.length < 2) throw createHttpError(409, "Verify your email and phone before investing.", { code: "NOT_ELIGIBLE" });
}

export const notFound = () => createHttpError("Operation not found", { code: "NOT_FOUND" });

export const invalidTransition = (message: string) => createHttpError(409, message, { code: "INVALID_TRANSITION" });

export async function operationView(db: DbOrTx, op: Op): Promise<OperationView> {
  const legs = await db.select().from(operationLegs).where(eq(operationLegs.operationId, op.id)).orderBy(asc(operationLegs.sequence));
  const flagged = new Set((await db.select({ id: instrumentDeployments.id }).from(instrumentDeployments).where(and(eq(instrumentDeployments.feeOnTransfer, true), inArray(instrumentDeployments.id, legs.flatMap((l) => [l.fromDeploymentId, l.toDeploymentId]).filter((d): d is string => !!d))))).map((d) => d.id));
  const fees = await db.select({ f: operationFees, org: orgDisplayName }).from(operationFees).leftJoin(organizations, eq(organizations.id, operationFees.organizationId))
    .where(eq(operationFees.operationId, op.id)).orderBy(asc(operationFees.createdAt), asc(operationFees.id));
  return {
    id: op.id, kind: op.kind, status: op.status, basketId: op.basketId, positionId: op.positionId, amountUsdc: op.amountUsdc, sellPercent: op.sellPercent, slippageBps: op.slippageBps,
    networkFeeUsdc: op.networkFeeUsdc, expiresAt: op.expiresAt.toISOString(), createdAt: op.createdAt.toISOString(),
    // A pre-Spec-10 operation has no fee rows: its one fee is the network fee.
    fees: fees.length ? fees.map(({ f, org }) => ({
      kind: f.kind, amountMicro: f.amountMicro, waivedReason: f.waivedReason as WaivedReason | null,
      recipientLabel: f.kind === "network" ? "Bytesac (network)" : f.kind === "platform" ? "Bytesac (platform)" : (org ?? "Organization"),
    })) : [{ kind: "network" as const, amountMicro: op.networkFeeUsdc, waivedReason: null, recipientLabel: "Bytesac (network)" }],
    legs: legs.map((l) => ({
      priceImpact: typeof l.routeSummary?.priceImpact === "number" ? l.routeSummary.priceImpact : null, routeFees: (l.routeSummary?.routeFees ?? []) as RouteFee[],
      providerSubstatus: l.providerSubstatus, recoveryOf: l.recoveryOf, recoveryToken: l.recoveryToken, feeOnTransfer: [l.fromDeploymentId, l.toDeploymentId].some((d) => d && flagged.has(d)),
      id: l.id, sequence: l.sequence, kind: l.kind, status: l.status, fromChain: l.fromChain, toChain: l.toChain, fromDeploymentId: l.fromDeploymentId, toDeploymentId: l.toDeploymentId,
      amountIn: l.amountIn, minOut: l.minOut, amountReceived: l.amountReceived, provider: l.provider, routeSummary: l.routeSummary, quoteExpiresAt: l.quoteExpiresAt?.toISOString() ?? null,
      gasPayer: l.gasPayer, sourceTx: l.sourceTx, destinationTx: l.destinationTx, failureReason: l.failureReason,
    })),
  };
}

export async function getOperation(ctx: OpCtx, id: string): Promise<OperationView> {
  const [op] = await db.select().from(operations).where(and(eq(operations.id, id), eq(operations.userId, ctx.userId)));
  if (!op) throw notFound();
  return operationView(db, op);
}

export const auditBase = (ctx: OpCtx | null, entityId: string) => ({
  actorType: ctx ? ("user" as const) : ("system" as const), actorUserId: ctx?.userId ?? null, sessionId: ctx?.sessionId ?? null, requestId: ctx?.meta.requestId ?? `track-${entityId}`,
});

/** Moves a leg along `LEG_TRANSITIONS` under the caller's row lock on its operation; a stale `from` (a concurrent change) is a 409. */
export async function setLegStatus(tx: Tx, ctx: OpCtx | null, leg: Pick<Leg, "id" | "status">, to: Leg["status"], patch: Partial<typeof operationLegs.$inferInsert> = {}): Promise<void> {
  if (!canTransition(LEG_TRANSITIONS, leg.status, to)) throw invalidTransition(`A leg cannot go from ${leg.status} to ${to}.`);
  const rows = await tx.update(operationLegs).set({ ...patch, status: to, updatedAt: sql`now()` }).where(and(eq(operationLegs.id, leg.id), eq(operationLegs.status, leg.status))).returning({ id: operationLegs.id });
  if (rows.length !== 1) throw invalidTransition("This leg changed. Reload and try again.");
  await writeAudit(tx, { ...auditBase(ctx, leg.id), action: `leg.${to.toLowerCase()}`, entityType: "operation_leg", entityId: leg.id, metadata: { from: leg.status, to } });
}

export async function setOperationStatus(tx: Tx, ctx: OpCtx | null, op: Pick<Op, "id" | "status">, to: Op["status"]): Promise<void> {
  if (!canTransition(OPERATION_TRANSITIONS, op.status, to)) throw invalidTransition(`An operation cannot go from ${op.status} to ${to}.`);
  const rows = await tx.update(operations).set({ status: to, updatedAt: sql`now()` }).where(and(eq(operations.id, op.id), eq(operations.status, op.status))).returning({ id: operations.id });
  if (rows.length !== 1) throw invalidTransition("This operation changed. Reload and try again.");
  await writeAudit(tx, { ...auditBase(ctx, op.id), action: `operation.${to.toLowerCase()}`, entityType: "operation", entityId: op.id, metadata: { from: op.status, to } });
  // Every terminal status gives back what was reserved and will never be spent (idempotent; a sent drop and a submitted leg's fee stay counted).
  if (to !== "IN_PROGRESS") await releaseUnspentGas(tx, op.id);
}

/** What a stopped IN_PROGRESS operation becomes: PARTIAL once an asset leg settled, a recovery token arrived or a leg's outcome is unknown, otherwise FAILED. */
export const stopStatus = (legs: Pick<Leg, "kind" | "status" | "recoveryToken">[]): "PARTIAL" | "FAILED" =>
  legs.some((l) => l.status === "UNKNOWN" || l.recoveryToken || (l.kind !== "network_fee" && l.status === "SETTLED")) ? "PARTIAL" : "FAILED";

/** Basket cash of a position in micro-USDC: what rebalance sells credited, buys and fees spent, sells released. */
export async function basketCashMicro(conn: DbOrTx, positionId: string): Promise<bigint> {
  const [r] = await conn.select({ s: sql<string>`coalesce(sum(${positionCashEntries.amountMicro}), 0)` }).from(positionCashEntries).where(eq(positionCashEntries.positionId, positionId));
  return BigInt(r!.s);
}

/** USDC on Solana the user can spend on new investments, fees and buy-backs: the wallet balance minus the cash of their OPEN baskets (never negative). */
export async function freeUsdcMicro(conn: DbOrTx, userId: string, walletUsdc: bigint): Promise<bigint> {
  const [r] = await conn.select({ s: sql<string>`coalesce(sum(${positionCashEntries.amountMicro}), 0)` }).from(positionCashEntries)
    .innerJoin(basketPositions, eq(basketPositions.id, positionCashEntries.positionId)).where(and(eq(basketPositions.userId, userId), eq(basketPositions.status, "OPEN")));
  const free = walletUsdc - BigInt(r!.s);
  return free > 0n ? free : 0n;
}

/** The keep-custom decision in force for the position (the latest keep/revert decision, when it is a keep), if any. */
export async function activeCustom(conn: DbOrTx, positionId: string) {
  const [d] = await conn.select().from(positionDecisions).where(and(eq(positionDecisions.positionId, positionId), inArray(positionDecisions.kind, ["keep_custom", "revert_custom"]))).orderBy(desc(positionDecisions.createdAt), desc(positionDecisions.id)).limit(1);
  return d?.kind === "keep_custom" ? d : undefined;
}

/** A rebalance (or an aligned apply) sets the applied version; it ends a keep-custom and clears the stored drift flag (the next reconciliation recomputes it). */
export async function applyVersion(tx: Tx, ctx: OpCtx | null, p: { positionId: string; userId: string; versionId: string }): Promise<void> {
  await tx.update(basketPositions).set({ appliedVersionId: p.versionId, allocationStatus: "ALIGNED", allocationCheckedAt: sql`now()` }).where(eq(basketPositions.id, p.positionId));
  if (await activeCustom(tx, p.positionId)) {
    await tx.insert(positionDecisions).values({ positionId: p.positionId, kind: "revert_custom", data: { reason: "rebalanced" }, actorUserId: p.userId });
  }
  await writeAudit(tx, { ...auditBase(ctx, p.positionId), action: "position.version_applied", entityType: "basket_position", entityId: p.positionId, metadata: { versionId: p.versionId } });
}

/** Locks the operation row. Every leg and operation transition happens under this lock. */
export async function lockOperation(tx: Tx, id: string): Promise<Op> {
  const [op] = await tx.select().from(operations).where(eq(operations.id, id)).for("update");
  if (!op) throw notFound();
  return op;
}

/**
 * The user's assets that have a leg in flight (SUBMITTING, SUBMITTED, PENDING_CHAIN or UNKNOWN), per user: every deployment on such a leg, and "cash"
 * (USDC on Solana, which every leg touches). While the chain and the ledger disagree on these, reconciling them would report a loss that is not one.
 */
export async function inFlightAssets(conn: DbOrTx, userId?: string): Promise<Map<string, Set<string>>> {
  const rows = await conn.select({ userId: operations.userId, from: operationLegs.fromDeploymentId, to: operationLegs.toDeploymentId }).from(operationLegs).innerJoin(operations, eq(operations.id, operationLegs.operationId))
    .where(and(inArray(operationLegs.status, ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN", "UNKNOWN"]), userId ? eq(operations.userId, userId) : undefined));
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const assets = out.get(r.userId) ?? out.set(r.userId, new Set(["cash"])).get(r.userId)!;
    for (const d of [r.from, r.to]) if (d) assets.add(d);
  }
  return out;
}

/** A sync or repair of an asset with a leg in flight waits for that leg. */
export async function assertNoneInFlight(conn: DbOrTx, userId: string, asset: string): Promise<void> {
  if ((await inFlightAssets(conn, userId)).get(userId)?.has(asset)) throw createHttpError(409, "A transaction involving this asset is still pending. Wait for it to finish.", { code: "OPERATION_IN_PROGRESS" });
}

/**
 * After a leg ends: COMPLETED when every leg settled; PARTIAL when an asset leg settled and another failed; FAILED when a leg failed and no asset leg settled.
 * A leg that failed with a recovery that is still alive (not itself failed or unknown) counts as neither: the recovery stands in for it. While any recovery
 * is not final (PLANNED to UNKNOWN) the operation stays IN_PROGRESS, whatever else failed: the user can still sign it, or Stop (PARTIAL, D-072).
 */
export async function refreshOperationStatus(tx: Tx, ctx: OpCtx | null, opId: string): Promise<void> {
  const op = await lockOperation(tx, opId);
  if (op.status !== "IN_PROGRESS") return;
  const all = await tx.select({ id: operationLegs.id, kind: operationLegs.kind, status: operationLegs.status, recoveryOf: operationLegs.recoveryOf }).from(operationLegs).where(eq(operationLegs.operationId, opId));
  if (all.some((l) => l.recoveryOf && l.status !== "SETTLED" && l.status !== "FAILED")) return;
  const recovered = new Set(all.filter((l) => l.recoveryOf && l.status !== "FAILED" && l.status !== "UNKNOWN").map((l) => l.recoveryOf));
  const legs = all.filter((l) => !recovered.has(l.id));
  if (legs.every((l) => l.status === "SETTLED")) {
    await setOperationStatus(tx, ctx, op, "COMPLETED");
    if (op.kind === "rebalance") await applyVersion(tx, ctx, { positionId: op.positionId!, userId: op.userId, versionId: op.versionId });
    return;
  }
  if (legs.some((l) => l.status === "FAILED")) {
    await setOperationStatus(tx, ctx, op, legs.some((l) => l.kind !== "network_fee" && l.status === "SETTLED") ? "PARTIAL" : "FAILED");
    if (op.kind === "rebalance" || op.kind === "repair") {
      // Told to the user once (the id is enqueued right away: delivery retries until the row is committed). A repair has no basket; its notice links to the repair page.
      const [b] = op.basketId ? await tx.select({ slug: baskets.slug, name: sql<string>`(select v.name from app.basket_versions v where v.basket_id = ${baskets.id} order by v.version_number desc limit 1)` }).from(baskets).where(eq(baskets.id, op.basketId)) : [];
      const id = await notify(tx, {
        userId: op.userId, kind: "execution_incomplete", basketId: op.basketId ?? undefined, positionId: op.positionId ?? undefined,
        data: { basketName: b?.name, basketSlug: b?.slug, operationId: op.id, asset: op.deploymentId ?? undefined }, dedupeKey: `incomplete:${op.id}`,
      });
      if (id) await enqueue("notifications", { job: "deliver", notificationId: id });
    }
  }
}

/** Expired plans (nothing submitted within 30 minutes) are cancelled when next touched, which frees the user's one active-operation slot. */
export async function cancelIfExpired(tx: Tx, ctx: OpCtx | null, op: Op): Promise<boolean> {
  if (op.status !== "PLANNED" || op.expiresAt > new Date()) return false;
  const [claimed] = await tx.select({ id: operationLegs.id }).from(operationLegs).where(and(eq(operationLegs.operationId, op.id), ne(operationLegs.status, "PLANNED"))).limit(1);
  if (claimed) return false; // a signed transaction is being sent: the plan is not abandoned
  await setOperationStatus(tx, ctx, op, "CANCELLED");
  return true;
}

export async function usdcPrice(): Promise<string> {
  const [usdc] = await db.select({ instrumentId: instrumentDeployments.instrumentId }).from(instrumentDeployments)
    .where(and(eq(instrumentDeployments.chain, "solana"), eq(instrumentDeployments.address, USDC_SOLANA_MINT), eq(instrumentDeployments.status, "ACTIVE")));
  const price = usdc ? (await getPrices([usdc.instrumentId])).find((p) => p.kind === "market" && p.status === "ok" && !p.stale) : undefined;
  return price?.value && Number(price.value) > 0 ? price.value : "1"; // a stablecoin: without a fresh, positive market price the peg is used
}

/**
 * Cancels a plan nothing was submitted for, or stops an operation between legs: PARTIAL once an asset leg settled or a leg's outcome is still unknown
 * (that leg keeps being tracked and reconciled), otherwise FAILED. A leg being sent or confirmed blocks it; an UNKNOWN one does not.
 */
export async function cancelOperation(ctx: OpCtx, opId: string): Promise<OperationView> {
  await db.transaction(async (tx) => {
    const op = await lockOperation(tx, opId);
    if (op.userId !== ctx.userId) throw notFound();
    const legs = await tx.select({ kind: operationLegs.kind, status: operationLegs.status, recoveryToken: operationLegs.recoveryToken }).from(operationLegs).where(eq(operationLegs.operationId, opId));
    if (legs.some((l) => ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN"].includes(l.status))) throw invalidTransition("A transaction is still pending. Wait for it to finish.");
    if (op.status === "PLANNED") return setOperationStatus(tx, ctx, op, "CANCELLED");
    if (op.status === "IN_PROGRESS") {
      return setOperationStatus(tx, ctx, op, stopStatus(legs));
    }
    throw invalidTransition(`This operation is ${op.status.toLowerCase()}.`);
  });
  return getOperation(ctx, opId);
}

/** An operation that is not over (a plan or a running one) on the position blocks closing it. */
export const hasOpenOperation = async (tx: DbOrTx, positionId: string): Promise<boolean> =>
  (await tx.select({ id: operations.id }).from(operations).where(and(eq(operations.positionId, positionId), inArray(operations.status, ["PLANNED", "IN_PROGRESS"]))).limit(1)).length > 0;

/**
 * Closes the OPEN position when every holding and its basket cash are exactly 0 (a sale, Sync or Accept took the last of it), no operation on it is still open
 * (the settling operation counts until it is COMPLETED), ending a keep-custom with it. The ledger stays as the former-basket record. Returns whether it closed.
 */
export async function closeIfEmpty(tx: Tx, ctx: OpCtx | null, positionId: string): Promise<boolean> {
  const [p] = await tx.select().from(basketPositions).where(eq(basketPositions.id, positionId)).for("update");
  if (!p || p.status !== "OPEN" || (await hasOpenOperation(tx, positionId))) return false;
  const [held] = await tx.select({ deploymentId: positionLedgerEntries.deploymentId }).from(positionLedgerEntries).where(eq(positionLedgerEntries.positionId, positionId))
    .groupBy(positionLedgerEntries.deploymentId).having(sql`sum(${positionLedgerEntries.quantityDelta}) <> 0`).limit(1);
  if (held || (await basketCashMicro(tx, positionId)) !== 0n) return false;
  await tx.update(basketPositions).set({ status: "CLOSED", closedAt: sql`now()` }).where(eq(basketPositions.id, positionId));
  if (await activeCustom(tx, positionId)) await tx.insert(positionDecisions).values({ positionId, kind: "revert_custom", data: { reason: "closed" }, actorUserId: p.userId });
  await writeAudit(tx, { ...auditBase(ctx, positionId), action: "position.auto_closed", entityType: "basket_position", entityId: positionId, metadata: { basketId: p.basketId } });
  return true;
}

/** Leave the basket and keep the assets: the position closes (its ledger is kept as the former-basket record); no transaction is made. */
export async function leavePosition(ctx: OpCtx, positionId: string, action: "position.left" | "position.closed" = "position.left"): Promise<void> {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(basketPositions).where(and(eq(basketPositions.id, positionId), eq(basketPositions.userId, ctx.userId))).for("update");
    if (!p) throw createHttpError("Position not found", { code: "NOT_FOUND" });
    if (p.status !== "OPEN") throw invalidTransition("This position is already closed.");
    await tx.update(basketPositions).set({ status: "CLOSED", closedAt: sql`now()` }).where(eq(basketPositions.id, positionId));
    await writeAudit(tx, { ...auditBase(ctx, positionId), action, entityType: "basket_position", entityId: positionId, metadata: { basketId: p.basketId } });
  });
}

/** The user's wallet balance in base units: native when `token` is null. */
export async function walletBalance(addresses: Addresses, chain: AssetChain, token: string | null): Promise<bigint> {
  const owner = addressOn(addresses, chain);
  return chain === "solana" ? solanaBalance(owner, token) : chain === "bitcoin" ? bitcoinBalance(owner) : evmBalance(chain, owner, token);
}

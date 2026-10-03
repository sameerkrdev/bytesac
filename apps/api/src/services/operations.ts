import { createHash } from "node:crypto";
import createHttpError from "http-errors";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  basketPositions, basketVersions, baskets, db, instrumentDeployments, instruments, investmentWallets, isUniqueViolation, operationLegs, operations,
  eligibilityDecisions, operationFees, organizations, positionCashEntries, positionDecisions, positionLedgerEntries, walletAddresses, type DbOrTx, type Tx,
} from "@repo/db";
import {
  ASSET_CHAINS, LEG_TRANSITIONS, OPERATION_TRANSITIONS, USDC_SOLANA_MINT, canTransition, micro, minOut, networkFeeMicro, scaleBuys, splitInvestment,
  type AssetChain, type AssetType, type BasketFees, type ChainFamily, type InvestRequest, type LegQuoteResponse, type LegSubmit, type OperationView, type SellRequest, type WaivedReason,
} from "@repo/validator";
import { env } from "@/config/dotenv";
import { bitcoinBalance, broadcastBitcoin, checkPsbt, expectedBtcTx, finalizePsbt, maxBtcMinerFee, psbtInputs, type PsbtInput, type PsbtOutput } from "@/providers/bitcoin";
import { evmBalance, evmTransaction } from "@/providers/evm-rpc";
import { routeProviderById } from "@/providers/routes";
import { isBuildRefusal } from "@/providers/routes/lifi";
import type { LegEstimate, LegQuote, RouteFee } from "@/providers/routes/types";
import { SendTransactionError } from "@solana/web3.js";
import { SOL_USD_FALLBACK, TOKEN_ACCOUNT_RENT_LAMPORTS, buildFeeTransfer, cosign, describeUnsigned, sendSolana, solanaBalance, sponsorExposure, tokenAccountMissing } from "@/providers/solana-tx";
import type { RequestMeta } from "@/middlewares/request-context.middleware";
import { enqueue } from "@/config/queues";
import { writeAudit } from "@/modules/audit/audit.service";
import { assertWalletsCanFund, platformAddress, releaseUnspentGas, reserveGas, sendGasDrop } from "./gas";
import { type DecisionDraft, assertAllowed, decisionOf, evaluateFor, isRwa, recordDecisions } from "./eligibility";
import { getInvestability } from "./investability";
import { notify } from "./notifications";
import { orgDisplayName } from "@/modules/members/members.service";
import { planFees, type PlannedFee } from "./fees";
import { getPrices, priceToMicro } from "@/modules/assets/pricing.service";
import { routeDenyList } from "./routing";

export interface OpCtx { userId: string; sessionId: string; meta: RequestMeta }
type Op = typeof operations.$inferSelect;
type Leg = typeof operationLegs.$inferSelect;
type Addresses = Partial<Record<ChainFamily, string>>;

const PLAN_TTL = "30 minutes";
export const SOLANA_FEE_TRANSFER_LAMPORTS = 10_000n;
/** ponytail: a flat estimate for the network-fee transfer's own cost (one signature, no priority fee). */
export const FEE_LEG_GAS_USD = 0.002;
const notFound = () => createHttpError("Operation not found", { code: "NOT_FOUND" });
const invalidTransition = (message: string) => createHttpError(409, message, { code: "INVALID_TRANSITION" });

export async function userAddresses(db: DbOrTx, userId: string): Promise<Addresses> {
  const rows = await db.select({ family: walletAddresses.chainFamily, address: walletAddresses.address }).from(investmentWallets)
    .innerJoin(walletAddresses, and(eq(walletAddresses.investmentWalletId, investmentWallets.id), eq(walletAddresses.status, "active")))
    .where(and(eq(investmentWallets.userId, userId), eq(investmentWallets.status, "active"))).orderBy(asc(walletAddresses.createdAt));
  const out: Addresses = {};
  for (const r of rows) out[r.family] ??= r.address;
  return out;
}

/** The user's wallet balance in base units: native when `token` is null. */
export async function walletBalance(addresses: Addresses, chain: AssetChain, token: string | null): Promise<bigint> {
  const owner = addressOn(addresses, chain);
  return chain === "solana" ? solanaBalance(owner, token) : chain === "bitcoin" ? bitcoinBalance(owner) : evmBalance(chain, owner, token);
}

export function addressOn(addresses: Addresses, chain: AssetChain): string {
  const a = addresses[ASSET_CHAINS[chain].family];
  if (!a) throw createHttpError(`Link a ${ASSET_CHAINS[chain].family} wallet first.`, { code: ASSET_CHAINS[chain].family === "bitcoin" ? "BTC_ADDRESS_REQUIRED" : "NOT_ELIGIBLE" });
  return a;
}

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

export interface LegDraft {
  kind: Leg["kind"]; fromChain: AssetChain; fromDeploymentId: string | null; toChain: AssetChain; toDeploymentId: string | null; amountIn: bigint; minOut: bigint | null;
  routeSummary: Record<string, unknown> | null; expectedTx: Record<string, unknown> | null; gasPayer: Leg["gasPayer"];
  /** Spec 11: the eligibility decision of an RWA leg, stored with the plan. */
  decision?: DecisionDraft;
}

export const gasPayerFor = (chain: AssetChain): Leg["gasPayer"] => (chain === "solana" ? "platform_fee_payer" : chain === "bitcoin" ? "user_btc_inputs" : "platform_gas_drop");

/** What a plan holds per leg: a quote (a built transaction) or an estimate (no transaction, no funded wallet needed). */
export type PlanQuote = LegQuote | LegEstimate;

/**
 * One quote per asset leg is taken at plan time only to estimate gas and outputs; quotes that are signed are fetched later, per leg. `estimate`: the wallet
 * does not hold the funds yet (a rebalance buy paid from sale proceeds), so LI.FI's balance-free route estimate is used. A quote LI.FI refuses because it
 * cannot build the transaction for this wallet (code 1001) falls back to an estimate as well.
 */
export async function planQuote(i: { fromChain: AssetChain; fromToken: string | null; toChain: AssetChain; toToken: string | null; amount: bigint; slippageBps: number; addresses: Addresses; estimate?: boolean }): Promise<PlanQuote> {
  const provider = routeProviderById(env.ROUTE_PROVIDER_ORDER[0]!)!;
  const toAddress = addressOn(i.addresses, i.toChain);
  const trade = { fromChain: i.fromChain, fromToken: i.fromToken, toChain: i.toChain, toToken: i.toToken, fromAmount: i.amount, slippageBps: i.slippageBps, toAddress, deny: await routeDenyList(i.toChain, toAddress) };
  if (i.estimate) return provider.estimate(trade);
  try {
    return await provider.quote({ ...trade, fromAddress: addressOn(i.addresses, i.fromChain), svmSponsor: i.fromChain === "solana" ? await platformAddress("solana", "solana_fee_payer") : undefined });
  } catch (err) {
    if (!isBuildRefusal(err)) throw err;
    return provider.estimate(trade);
  }
}

/**
 * What a Solana-source leg costs the platform: the decoded fee-payer exposure (signatures, priority fee, token-account rent) or LI.FI's own estimate if
 * higher, and the gas estimate in USD with the rent added on top (it is not known whether LI.FI's figure includes it). Refuses an unsponsorable transaction.
 * An estimate carries no transaction: LI.FI's own gas figure plus `rentLamports` (the caller passes it only when the destination token account is missing);
 * `quoteLeg` tops the reservation up if the transaction it builds needs more (D-072 keeps its bound).
 */
export function sponsoredCost(q: PlanQuote, rentLamports = 0n): { lamports: bigint; usd: number; estimated: boolean } {
  const usd = (rent: bigint) => q.gasEstimateUsd + (Number(rent) / 1e9) * (q.nativePriceUsd ?? SOL_USD_FALLBACK);
  if (!q.transaction) return { lamports: q.gasNative + rentLamports, usd: usd(rentLamports), estimated: true };
  const e = sponsorExposure((q.transaction as { serializedBase64: string }).serializedBase64);
  return { lamports: e.lamports > q.gasNative ? e.lamports : q.gasNative, usd: usd(e.rentLamports), estimated: false };
}

/** Plan-time cost of a Solana-source leg delivering `toToken` (null: native) to the user's wallet: an estimate adds token-account rent only when the destination is Solana and the account is missing. */
export async function legCost(q: PlanQuote, toChain: AssetChain, toToken: string | null, solanaOwner: string): Promise<ReturnType<typeof sponsoredCost>> {
  return sponsoredCost(q, !q.transaction && toChain === "solana" && toToken && (await tokenAccountMissing(solanaOwner, toToken)) ? TOKEN_ACCOUNT_RENT_LAMPORTS : 0n);
}

/** A leg records what it reserved: the quote it later signs can top the reservation up, and a stop or terminal status gives it back if the leg never sent. */
export const reservedExpectedTx = (c: { lamports: bigint }): Record<string, unknown> => ({ reservedNative: c.lamports.toString() });

/** Reserves platform-paid gas, then inserts the operation and its legs, all in one transaction (a refused budget leaves no operation). */
export async function insertPlan(ctx: OpCtx, i: { op: Omit<typeof operations.$inferInsert, "userId" | "expiresAt" | "gasReserved">; legs: LegDraft[]; gas: Map<AssetChain, bigint>; fees: PlannedFee[]; excluded?: DecisionDraft[] }): Promise<string> {
  await assertWalletsCanFund(i.gas);
  try {
    return await db.transaction(async (tx) => {
      const stale = await tx.select().from(operations).where(and(eq(operations.userId, ctx.userId), eq(operations.status, "PLANNED"), sql`${operations.expiresAt} <= now()`));
      for (const s of stale) await cancelIfExpired(tx, ctx, s);
      for (const [chain, amountNative] of i.gas) if (amountNative > 0n) await reserveGas(tx, { userId: ctx.userId, chain, amountNative });
      const [op] = await tx.insert(operations).values({ ...i.op, userId: ctx.userId, gasReserved: Object.fromEntries([...i.gas].filter(([, n]) => n > 0n).map(([c, n]) => [c, n.toString()])), expiresAt: sql`now() + ${PLAN_TTL}::interval` as unknown as Date }).returning({ id: operations.id });
      const inserted = await tx.insert(operationLegs).values(i.legs.map((l, n) => ({
        operationId: op!.id, sequence: n + 1, kind: l.kind, fromChain: l.fromChain, fromDeploymentId: l.fromDeploymentId, toChain: l.toChain, toDeploymentId: l.toDeploymentId,
        amountIn: l.amountIn.toString(), minOut: l.minOut?.toString() ?? null, provider: l.kind === "network_fee" ? null : env.ROUTE_PROVIDER_ORDER[0]!, routeSummary: l.routeSummary,
        expectedTx: l.expectedTx, gasPayer: l.gasPayer,
      }))).returning({ id: operationLegs.id, kind: operationLegs.kind });
      // Decisions of the RWA legs, and of sell exclusions (no leg), recorded with the plan.
      await recordDecisions(tx, [...i.legs.flatMap((l, n) => (l.decision ? [{ ...l.decision, legId: inserted[n]!.id }] : [])), ...(i.excluded ?? []).map((d) => ({ ...d, legId: null }))]
        .map((d) => ({ ...d, operationId: op!.id, userId: ctx.userId, ipCountry: ctx.meta.ipCountry })));
      const feeLeg = inserted.find((l) => l.kind === "network_fee")!;
      await tx.insert(operationFees).values(i.fees.map((f) => ({
        operationId: op!.id, legId: feeLeg.id, kind: f.kind, baseMicro: f.baseMicro.toString(), bps: f.bps, capMicro: f.capMicro?.toString() ?? null, amountMicro: f.amountMicro.toString(),
        recipientAddress: f.recipientAddress, organizationId: f.organizationId, basketId: f.basketId, scheduleId: f.scheduleId, waivedReason: f.waivedReason,
      })));
      await writeAudit(tx, { ...auditBase(ctx, op!.id), action: "operation.planned", entityType: "operation", entityId: op!.id, metadata: { kind: i.op.kind, legs: i.legs.length } });
      return op!.id;
    });
  } catch (err) {
    // A concurrent request with the same key won (either unique index may report it): that plan is the answer.
    const winner = isUniqueViolation(err) ? await findByKey(ctx.userId, i.op.idempotencyKey) : undefined;
    if (winner) return winner.id;
    if (isUniqueViolation(err, "operations_one_active_per_user")) throw createHttpError(409, "Finish or cancel your current operation first.", { code: "OPERATION_IN_PROGRESS" });
    throw err;
  }
}

export const findByKey = async (userId: string, key: string) => (await db.select().from(operations).where(and(eq(operations.userId, userId), eq(operations.idempotencyKey, key))))[0];

export const reused = () => createHttpError("This idempotency key was already used for a different request.", { code: "VALIDATION_FAILED" });

/** The basket must be investable and the user eligible (the same reasons for invest and rebalance). */
export function assertEligible(inv: Awaited<ReturnType<typeof getInvestability>>): void {
  if (!inv.investable) throw createHttpError(409, "This basket can't be invested in right now.", { code: "NOT_INVESTABLE", details: { reasons: inv.reasons } });
  const blockers = inv.eligibility?.reasons ?? [];
  for (const code of ["OPERATION_IN_PROGRESS", "BTC_ADDRESS_REQUIRED", "DECLARATION_REQUIRED"] as const) {
    if (blockers.some((r) => r.code === code)) throw createHttpError(409, blockers.find((r) => r.code === code)!.message, { code, details: { reasons: blockers } });
  }
  if (blockers.length) throw createHttpError(409, "You can't invest yet.", { code: "NOT_ELIGIBLE", details: { reasons: blockers } });
}

export async function createInvestPlan(ctx: OpCtx, body: InvestRequest): Promise<OperationView> {
  const amount = micro(body.amountUsdc);
  const existing = await findByKey(ctx.userId, body.idempotencyKey);
  if (existing) {
    if (existing.kind !== "invest" || existing.basketId !== body.basketId || existing.amountUsdc !== amount.toString()) throw reused();
    return operationView(db, existing);
  }

  const inv = await getInvestability(db, { id: body.basketId }, { userId: ctx.userId, ipCountry: ctx.meta.ipCountry });
  assertEligible(inv);

  const [version] = await db.select({ increment: basketVersions.minimumIncrementUsdc, fees: basketVersions.fees, organizationId: baskets.organizationId }).from(basketVersions)
    .innerJoin(baskets, eq(baskets.id, basketVersions.basketId)).where(eq(basketVersions.id, inv.versionId!));
  const invalidAmount = (message: string) => createHttpError(message, { code: "VALIDATION_FAILED" });
  if (!inv.minimumUsdc || amount < micro(inv.minimumUsdc)) throw invalidAmount(`The minimum investment is ${inv.minimumUsdc ?? "not set"} USDC.`);
  if (version?.increment && amount % micro(version.increment) !== 0n) throw invalidAmount(`The amount must be a multiple of ${version.increment} USDC.`);

  const addresses = await userAddresses(db, ctx.userId);
  if ((await freeUsdcMicro(db, ctx.userId, await solanaBalance(addressOn(addresses, "solana"), USDC_SOLANA_MINT))) < amount) throw createHttpError(409, "Your Solana wallet doesn't hold enough USDC (basket cash is not available for new investments).", { code: "INSUFFICIENT_BALANCE" });

  // Provisional split (no fee) to estimate gas, then the real split with the network fee taken out of the amount.
  const weights = inv.constituents.map((c) => ({ deploymentId: c.deployment.id, bps: c.weightBps }));
  const provisional = splitInvestment(amount, 0n, weights);
  const quotes = await Promise.all(inv.constituents.map((c, n) => planQuote({
    fromChain: "solana", fromToken: USDC_SOLANA_MINT, toChain: c.deployment.chain, toToken: c.deployment.address, amount: provisional[n]!.amountMicro, slippageBps: body.slippageBps, addresses,
  })));
  const costs = await Promise.all(quotes.map((q, n) => legCost(q, inv.constituents[n]!.deployment.chain, inv.constituents[n]!.deployment.address, addressOn(addresses, "solana"))));
  const price = await usdcPrice();
  const fees = await planFees(db, {
    networkMicro: networkFeeMicro([FEE_LEG_GAS_USD, ...costs.map((c) => c.usd)], price), operation: "invest", platformBaseMicro: amount, usdcPrice: price, solPriceUsd: quotes.find((q) => q.nativePriceUsd)?.nativePriceUsd,
    manager: { kind: "manager_entry", fee: (version?.fees as BasketFees | undefined)?.entry, baseMicro: amount }, organizationId: version?.organizationId ?? null, basketId: body.basketId,
  });
  if (amount - fees.totalMicro <= 0n) throw invalidAmount("The amount doesn't cover the fees.");
  const shares = splitInvestment(amount, fees.totalMicro, weights);
  if (shares.some((s) => s.amountMicro <= 0n)) throw invalidAmount("The amount doesn't cover the fees.");

  const legs: LegDraft[] = [{ kind: "network_fee", fromChain: "solana", fromDeploymentId: null, toChain: "solana", toDeploymentId: null, amountIn: fees.totalMicro, minOut: null, routeSummary: null, expectedTx: reservedExpectedTx({ lamports: SOLANA_FEE_TRANSFER_LAMPORTS + fees.rentLamports }), gasPayer: "platform_fee_payer" }];
  let solanaGas = SOLANA_FEE_TRANSFER_LAMPORTS + fees.rentLamports;
  inv.constituents.forEach((c, n) => {
    const estimatedOut = (quotes[n]!.estimatedOut * shares[n]!.amountMicro) / provisional[n]!.amountMicro;
    solanaGas += costs[n]!.lamports;
    legs.push({
      kind: c.deployment.chain === "solana" ? "swap" : "cross_chain", fromChain: "solana", fromDeploymentId: null, toChain: c.deployment.chain, toDeploymentId: c.deployment.id,
      amountIn: shares[n]!.amountMicro, minOut: minOut(estimatedOut, body.slippageBps), routeSummary: { tool: quotes[n]!.toolSummary, estimatedOut: estimatedOut.toString(), symbol: c.symbol, decimals: c.deployment.decimals, routeFees: quotes[n]!.routeFees, priceImpact: quotes[n]!.priceImpact }, expectedTx: reservedExpectedTx(costs[n]!), gasPayer: "platform_fee_payer",
      decision: decisionOf(inv.rwaDecisions, c.instrumentId, "acquire"),
    });
  });

  const id = await insertPlan(ctx, {
    op: { basketId: body.basketId, kind: "invest", amountUsdc: amount.toString(), slippageBps: body.slippageBps, networkFeeUsdc: fees.rows[0]!.amountMicro.toString(), versionId: inv.versionId!, idempotencyKey: body.idempotencyKey },
    legs, gas: new Map([["solana", solanaGas]]), fees: fees.rows,
  });
  return getOperation(ctx, id);
}

/** A sell leg (asset to USDC on Solana) with its gas reservation added to `gas`. Shared by sell and rebalance plans. */
export function sellLeg(
  s: { deploymentId: string; chain: AssetChain; address: string | null; symbol: string; decimals: number; quantity: bigint }, q: PlanQuote, cost: { lamports: bigint; estimated?: boolean }, slippageBps: number, gas: Map<AssetChain, bigint>,
): LegDraft {
  const payer = gasPayerFor(s.chain);
  // EVM sells: the planned drop is reserved with the plan; `sendGasDrop` later sends exactly this amount. Estimate x 1.5, and x 2 when an ERC-20
  // is sold (the exact-amount approval the client signs first is a second transaction that the quote's gas figure may not cover).
  const drop = payer === "platform_gas_drop" ? (q.gasNative * (s.address ? 4n : 3n)) / 2n : 0n;
  const gasChain = payer === "platform_gas_drop" ? s.chain : "solana";
  gas.set(gasChain, (gas.get(gasChain) ?? 0n) + (payer === "platform_gas_drop" ? drop : payer === "platform_fee_payer" ? cost.lamports : 0n));
  return {
    kind: s.chain === "solana" ? "swap" : "cross_chain", fromChain: s.chain, fromDeploymentId: s.deploymentId, toChain: "solana", toDeploymentId: null, amountIn: s.quantity,
    minOut: minOut(q.estimatedOut, slippageBps), routeSummary: { tool: q.toolSummary, estimatedOut: q.estimatedOut.toString(), symbol: s.symbol, decimals: s.decimals, routeFees: q.routeFees, priceImpact: q.priceImpact },
    expectedTx: payer === "platform_gas_drop" ? { gasReserved: true, gasDropNative: drop.toString() } : reservedExpectedTx(cost), gasPayer: payer,
  };
}

const restrictedNotice = (symbol: string) => `You can't sell ${symbol} through Bytesac in your region; it stays in your wallet.`;

export async function createSellPlan(ctx: OpCtx, body: SellRequest): Promise<OperationView> {
  const existing = await findByKey(ctx.userId, body.idempotencyKey);
  if (existing) {
    if (existing.positionId !== body.positionId || existing.sellPercent !== body.percent) throw reused();
    // The exclusions a replay shows are the stored decisions without a leg (a missing declaration stores none).
    const left = await db.select({ instrumentId: eligibilityDecisions.instrumentId, symbol: instruments.symbol }).from(eligibilityDecisions).innerJoin(instruments, eq(instruments.id, eligibilityDecisions.instrumentId))
      .where(and(eq(eligibilityDecisions.operationId, existing.id), isNull(eligibilityDecisions.legId)));
    return { ...(await operationView(db, existing)), ...(left.length ? { excluded: left.map((l) => ({ ...l, notice: restrictedNotice(l.symbol) })) } : {}) };
  }
  const [position] = await db.select().from(basketPositions).where(and(eq(basketPositions.id, body.positionId), eq(basketPositions.userId, ctx.userId)));
  if (!position) throw createHttpError("Position not found", { code: "NOT_FOUND" });
  const addresses = await userAddresses(db, ctx.userId);

  // Quantity per deployment: the smaller of the recorded holding and what the wallet still holds, never more.
  const holdings = await db.select({
    deploymentId: positionLedgerEntries.deploymentId, instrumentId: instrumentDeployments.instrumentId, assetType: instruments.assetType, quantity: sql<string>`sum(${positionLedgerEntries.quantityDelta})`, chain: instrumentDeployments.chain, address: instrumentDeployments.address, decimals: instrumentDeployments.decimals, symbol: instruments.symbol,
  }).from(positionLedgerEntries).innerJoin(instrumentDeployments, eq(instrumentDeployments.id, positionLedgerEntries.deploymentId)).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId))
    .where(eq(positionLedgerEntries.positionId, position.id)).groupBy(positionLedgerEntries.deploymentId, instrumentDeployments.instrumentId, instrumentDeployments.chain, instrumentDeployments.address, instrumentDeployments.decimals, instruments.symbol, instruments.assetType)
    .orderBy(asc(instrumentDeployments.chain), asc(positionLedgerEntries.deploymentId));
  const candidates: { deploymentId: string; instrumentId: string; assetType: AssetType; chain: AssetChain; address: string | null; symbol: string; decimals: number; quantity: bigint }[] = [];
  for (const h of holdings) {
    const wanted = (BigInt(h.quantity) * BigInt(body.percent)) / 100n;
    if (wanted <= 0n) continue;
    const balance = await walletBalance(addresses, h.chain, h.address);
    // Native Bitcoin pays the miner fee out of the same balance: a full sell keeps the fee ceiling back so the PSBT can be built.
    const spendable = h.chain === "bitcoin" ? (balance > maxBtcMinerFee(balance) ? balance - maxBtcMinerFee(balance) : 0n) : balance;
    const quantity = wanted < spendable ? wanted : spendable;
    if (quantity > 0n) candidates.push({ deploymentId: h.deploymentId, instrumentId: h.instrumentId, assetType: h.assetType, chain: h.chain, address: h.address, symbol: h.symbol, decimals: h.decimals, quantity });
  }
  if (candidates.length === 0) throw createHttpError("There is nothing to sell: your wallet holds none of this position's assets.", { code: "INSUFFICIENT_BALANCE" });

  // Spec 11 section 7: each RWA is evaluated for selling; one the user may not sell, or has no fresh declaration for, is left out (it stays in the wallet) and the rest sells. Nothing left is a 409.
  const sellDecisions = await evaluateFor(db, { userId: ctx.userId, ipCountry: ctx.meta.ipCountry, items: candidates.filter((s) => isRwa(s.assetType)).map((s) => ({ instrumentId: s.instrumentId, assetType: s.assetType, deploymentId: s.deploymentId, action: "sell" as const })) });
  const blocked = (s: { instrumentId: string }) => (sellDecisions.get(s.instrumentId)?.outcome ?? "ALLOWED") !== "ALLOWED";
  const sells = candidates.filter((s) => !blocked(s));
  if (sells.length === 0) assertAllowed(sellDecisions);
  const excluded = candidates.filter(blocked).map((s) => ({ instrumentId: s.instrumentId, symbol: s.symbol, notice: sellDecisions.get(s.instrumentId)?.outcome === "DECLARATION_REQUIRED" ? `Confirm your eligibility to sell ${s.symbol} through Bytesac.` : restrictedNotice(s.symbol) }));

  const quotes = await Promise.all(sells.map((s) => planQuote({ fromChain: s.chain, fromToken: s.address, toChain: "solana", toToken: USDC_SOLANA_MINT, amount: s.quantity, slippageBps: body.slippageBps, addresses })));
  const costs = await Promise.all(quotes.map((q, n) => (sells[n]!.chain === "solana" ? legCost(q, "solana", USDC_SOLANA_MINT, addressOn(addresses, "solana")) : { lamports: 0n, usd: q.gasEstimateUsd, estimated: false })));
  const price = await usdcPrice();
  // The platform fee is charged on the planned sale value; a sell with any price missing is waived "no_price".
  const marketPrices = new Map((await getPrices(sells.map((s) => s.instrumentId))).flatMap((p) => (p.kind === "market" && p.status === "ok" && !p.stale && p.value && priceToMicro(p.value) ? [[p.instrumentId, priceToMicro(p.value)!] as const] : [])));
  const [org] = await db.select({ organizationId: baskets.organizationId }).from(baskets).where(eq(baskets.id, position.basketId));
  const fees = await planFees(db, {
    networkMicro: networkFeeMicro([FEE_LEG_GAS_USD, ...costs.map((c) => c.usd)], price), operation: position.status === "OPEN" ? "sell_to_usdc" : "sell_former", usdcPrice: price, manager: null, solPriceUsd: quotes.find((q, n) => sells[n]!.chain === "solana" && q.nativePriceUsd)?.nativePriceUsd,
    platformBaseMicro: sells.every((s) => marketPrices.has(s.instrumentId)) ? sells.reduce((t, s) => t + (s.quantity * marketPrices.get(s.instrumentId)!) / 10n ** BigInt(s.decimals), 0n) : null,
    organizationId: org?.organizationId ?? null, basketId: position.basketId,
  });
  const fee = fees.totalMicro;
  const legs: LegDraft[] = [];
  const gas = new Map<AssetChain, bigint>([["solana", SOLANA_FEE_TRANSFER_LAMPORTS + fees.rentLamports]]);
  sells.forEach((s, n) => legs.push({ ...sellLeg(s, quotes[n]!, costs[n]!, body.slippageBps, gas), decision: decisionOf(sellDecisions, s.instrumentId, "sell") }));
  // The network fee goes FIRST when the wallet already holds that much USDC, so the platform is paid before it spends gas; otherwise (Solana-only
  // sells) it is last, paid from the proceeds, and a fee the user never pays is an accepted loss within the caps.
  const evmSell = sells.find((s) => gasPayerFor(s.chain) === "platform_gas_drop");
  const feeUsdc = await freeUsdcMicro(db, ctx.userId, await solanaBalance(addressOn(addresses, "solana"), USDC_SOLANA_MINT));
  // EVM gas is only ever dropped after the network fee has settled, so selling an EVM asset needs the fee in USDC on Solana up front (D-071).
  const cents = (fee + 9_999n) / 10_000n; // rounded up to whole cents: "at least"
  if (evmSell && feeUsdc < fee) throw createHttpError(409, `Add at least $${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, "0")} USDC on Solana to pay the ${fee === fees.rows[0]!.amountMicro ? "network fee" : "fees"} before selling assets on ${ASSET_CHAINS[evmSell.chain].label}.`, { code: "INSUFFICIENT_BALANCE", details: { requiredUsdc: fee.toString() } });
  const feeLeg: LegDraft = { kind: "network_fee", fromChain: "solana", fromDeploymentId: null, toChain: "solana", toDeploymentId: null, amountIn: fee, minOut: null, routeSummary: null, expectedTx: reservedExpectedTx({ lamports: SOLANA_FEE_TRANSFER_LAMPORTS + fees.rentLamports }), gasPayer: "platform_fee_payer" };
  if (feeUsdc >= fee) legs.unshift(feeLeg);
  else legs.push(feeLeg);

  const id = await insertPlan(ctx, {
    op: {
      basketId: position.basketId, positionId: position.id, kind: position.status === "OPEN" ? "sell_to_usdc" : "sell_former", sellPercent: body.percent, slippageBps: body.slippageBps,
      networkFeeUsdc: fees.rows[0]!.amountMicro.toString(), versionId: position.appliedVersionId, idempotencyKey: body.idempotencyKey,
    },
    legs, gas, fees: fees.rows, excluded: candidates.filter(blocked).map((s) => decisionOf(sellDecisions, s.instrumentId, "sell")!),
  });
  return { ...(await getOperation(ctx, id)), ...(excluded.length ? { excluded } : {}) };
}

async function loadLeg(ctx: OpCtx, opId: string, legId: string) {
  const [op] = await db.select().from(operations).where(and(eq(operations.id, opId), eq(operations.userId, ctx.userId)));
  const legs = op ? await db.select().from(operationLegs).where(eq(operationLegs.operationId, opId)).orderBy(asc(operationLegs.sequence)) : [];
  const leg = legs.find((l) => l.id === legId);
  if (!op || !leg) throw notFound();
  return { op, legs, leg };
}

/** An operation that is over (or expired before its first submission) takes no more quotes or signatures. */
async function assertOperable(ctx: OpCtx, op: Op): Promise<void> {
  if (op.status !== "PLANNED" && op.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${op.status.toLowerCase()}.`);
  if (op.status === "PLANNED" && op.expiresAt <= new Date()) {
    await db.transaction(async (tx) => { await cancelIfExpired(tx, ctx, await lockOperation(tx, op.id)); });
    throw invalidTransition("This plan expired. Start again.");
  }
}

const sha256Hex = (s: string) => createHash("sha256").update(s.toLowerCase()).digest("hex");

export async function quoteLeg(ctx: OpCtx, opId: string, legId: string): Promise<LegQuoteResponse> {
  let { op, legs, leg } = await loadLeg(ctx, opId, legId);
  await assertOperable(ctx, op);
  if (leg.status !== "PLANNED") throw invalidTransition("This leg was already submitted.");
  // Strictly sequential: each earlier leg is settled, except that the first asset leg may follow a network fee that is on-chain.
  // A leg that failed with a recovery (the funds arrived as another token) does not hold the legs after it back; its recovery goes last, once every other leg is final.
  if (leg.recoveryOf
    ? legs.some((l) => l.id !== leg.id && !l.recoveryOf && l.status !== "SETTLED" && l.status !== "FAILED")
    : legs.some((l) => l.sequence < leg.sequence && !(l.status === "SETTLED" || l.recoveryToken || (l.kind === "network_fee" && l.status === "PENDING_CHAIN")))) throw invalidTransition("Finish the previous leg first.");

  // Spec 11: an RWA leg (the asset bought, or the asset sold) is evaluated again at every quote: rules or the declaration may have changed since the plan. Earlier settled legs stand.
  const rwaDeploymentId = leg.kind === "network_fee" ? null : (leg.fromDeploymentId ?? leg.toDeploymentId);
  const [rwa] = rwaDeploymentId ? await db.select({ instrumentId: instrumentDeployments.instrumentId, assetType: instruments.assetType }).from(instrumentDeployments).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId)).where(eq(instrumentDeployments.id, rwaDeploymentId)) : [];
  if (rwa && isRwa(rwa.assetType)) {
    const action = leg.fromDeploymentId ? "sell" : "acquire";
    const results = await evaluateFor(db, { userId: ctx.userId, ipCountry: ctx.meta.ipCountry, items: [{ ...rwa, deploymentId: rwaDeploymentId!, action }] });
    await recordDecisions(db, [{ operationId: op.id, legId: leg.id, userId: ctx.userId, ipCountry: ctx.meta.ipCountry, instrumentId: rwa.instrumentId, action, result: results.get(rwa.instrumentId)! }]);
    assertAllowed(results);
  }

  // A rebalance's buys are sized once, at the first buy's quote, from the basket cash that actually arrived (spec section 4.3).
  const isBuy = leg.fromDeploymentId === null && leg.kind !== "network_fee" && !leg.recoveryOf;
  if (op.kind === "rebalance" && !op.buyScale && isBuy) {
    const nothing = await db.transaction(async (tx) => {
      const locked = await lockOperation(tx, op.id);
      if (locked.buyScale) return false;
      const fresh = await tx.select().from(operationLegs).where(eq(operationLegs.operationId, op.id)).orderBy(asc(operationLegs.sequence));
      const current = fresh.find((l) => l.id === leg.id)!;
      if (current.status !== "PLANNED") return false;
      // All earlier legs are final here (legs are sequential), except a fee paid from cash that may still be on its way: it is not yet debited.
      const feeInFlight = fresh.filter((l) => l.kind === "network_fee" && l.routeSummary?.fromCash === true && l.status !== "SETTLED").reduce((s, l) => s + BigInt(l.amountIn), 0n);
      const cash = await basketCashMicro(tx, op.positionId!);
      const available = cash > feeInFlight ? cash - feeInFlight : 0n;
      const buys = fresh.filter((l) => l.sequence >= current.sequence && l.fromDeploymentId === null && l.kind !== "network_fee" && !l.recoveryOf); // a recovery is not sized from cash
      const planned = buys.map((l) => BigInt(l.amountIn));
      const scaled = scaleBuys(planned, available);
      for (const [n, l] of buys.entries()) {
        if (scaled[n]! <= 0n) await setLegStatus(tx, ctx, l, "FAILED", { failureReason: "NO_FUNDS" });
        else await tx.update(operationLegs).set({ amountIn: scaled[n]!.toString(), minOut: ((BigInt(l.minOut!) * scaled[n]!) / planned[n]!).toString() }).where(eq(operationLegs.id, l.id));
      }
      await tx.update(operations).set({ buyScale: { num: available.toString(), den: planned.reduce((s, p) => s + p, 0n).toString() } }).where(eq(operations.id, op.id));
      if (scaled[0]! <= 0n) await refreshOperationStatus(tx, ctx, op.id);
      return scaled[0]! <= 0n;
    });
    if (nothing) throw createHttpError(409, "Nothing left to buy: the basket cash that arrived is used up.", { code: "VALIDATION_FAILED" });
    ({ op, legs, leg } = await loadLeg(ctx, opId, legId));
  }

  const addresses = await userAddresses(db, ctx.userId);
  const solanaAddress = addressOn(addresses, "solana");
  // The user's free USDC (the wallet minus basket cash) must cover the plan before the first leg (invest), the fee, and a repair's buy. A fee paid from
  // basket cash and a rebalance buy (sized from that cash) are checked against the wallet balance itself.
  const need = leg.sequence === 1 && op.kind === "invest" ? BigInt(op.amountUsdc!) : leg.kind === "network_fee" || (isBuy && (op.kind === "repair" || op.kind === "rebalance")) ? BigInt(leg.amountIn) : 0n;
  if (need > 0n) {
    const wallet = await solanaBalance(solanaAddress, USDC_SOLANA_MINT);
    const spendable = leg.routeSummary?.fromCash === true || (isBuy && op.kind === "rebalance") ? wallet : await freeUsdcMicro(db, ctx.userId, wallet);
    if (spendable < need) throw createHttpError(409, "Your Solana wallet doesn't hold enough USDC.", { code: "INSUFFICIENT_BALANCE" });
  }
  const expiresAt = new Date(Date.now() + 60_000);
  // Only an unclaimed leg takes a new quote: a leg that was claimed meanwhile (a submit in flight) keeps the transaction it was claimed with.
  const save = async (patch: Partial<typeof operationLegs.$inferInsert>) => {
    const rows = await db.update(operationLegs).set({ ...patch, quoteExpiresAt: expiresAt, updatedAt: sql`now()` }).where(and(eq(operationLegs.id, leg.id), eq(operationLegs.status, "PLANNED"))).returning({ id: operationLegs.id });
    if (rows.length !== 1) throw invalidTransition("This leg was already submitted.");
  };
  const response = (r: Pick<LegQuoteResponse, "estimatedOut" | "minOut" | "transaction"> & Partial<Pick<LegQuoteResponse, "approval">>): LegQuoteResponse =>
    ({ legId: leg.id, quoteExpiresAt: expiresAt.toISOString(), gasDrop: null, approval: null, ...r });

  if (leg.kind === "network_fee") {
    // The transfers are the fees recorded with the plan (network, manager, platform), never the schedule in force now. A pre-Spec-10 operation has no fee rows:
    // its leg is the single transfer of `amountIn` to the gas treasury, as before. With rows, they must add up to the leg, else nothing is built.
    const rows = await db.select({ recipient: operationFees.recipientAddress, amountMicro: operationFees.amountMicro }).from(operationFees)
      .where(eq(operationFees.operationId, op.id))
      .orderBy(sql`array_position(array['network','manager_entry','manager_rebalance','platform']::text[], ${operationFees.kind}::text)`);
    const charged = rows.filter((r) => BigInt(r.amountMicro) > 0n);
    if (rows.length && charged.reduce((t, r) => t + BigInt(r.amountMicro), 0n) !== BigInt(leg.amountIn)) throw createHttpError(503, "This route is unavailable. Plan again.", { code: "ROUTE_UNAVAILABLE" });
    if (!rows.length && !env.GAS_TREASURY_SOLANA_ADDRESS) throw createHttpError(503, "This route is unavailable. Plan again.", { code: "ROUTE_UNAVAILABLE" });
    const transfers = rows.length ? charged.map((c) => ({ recipient: c.recipient!, amountMicro: BigInt(c.amountMicro) })) : [{ recipient: env.GAS_TREASURY_SOLANA_ADDRESS!, amountMicro: BigInt(leg.amountIn) }];
    const built = await buildFeeTransfer({ owner: solanaAddress, transfers });
    await save({ builtMessageHash: built.messageHash });
    return response({ estimatedOut: null, minOut: null, transaction: { kind: "solana", serializedBase64: built.serializedBase64 } });
  }

  const [from, to] = await Promise.all([legDeployment(leg.fromDeploymentId), legDeployment(leg.toDeploymentId)]);
  // A recovery leg swaps the token that arrived (not a registry deployment: its address is in the route summary; null = the chain's native asset).
  const recoveryFrom = leg.recoveryOf ? ((leg.routeSummary?.fromToken ?? null) as string | null) : undefined;
  const fromToken = recoveryFrom !== undefined ? recoveryFrom : from ? from.address : USDC_SOLANA_MINT;
  const planned = (leg.expectedTx ?? {}) as { gasDropNative?: string; gasReserved?: boolean };
  let gasDrop: LegQuoteResponse["gasDrop"] = null;
  if (leg.gasPayer === "platform_gas_drop") {
    // The platform's gas follows only once the operation's network fee has settled (an EVM sell plan always puts the fee first).
    const fee = legs.find((l) => l.kind === "network_fee");
    if (fee?.status !== "SETTLED") return { legId: leg.id, estimatedOut: null, minOut: null, quoteExpiresAt: null, transaction: null, approval: null, gasDrop: { status: "pending", txHash: null } };
    // Selling the native asset: the wallet needs the amount sold plus gas.
    gasDrop = await sendGasDrop(leg.id, leg.fromChain, addressOn(addresses, leg.fromChain), BigInt(planned.gasDropNative ?? 0), fromToken ? 0n : BigInt(leg.amountIn));
    if (gasDrop.status !== "confirmed" && gasDrop.status !== "skipped") return { legId: leg.id, estimatedOut: null, minOut: null, quoteExpiresAt: null, transaction: null, approval: null, gasDrop };
  }

  const provider = routeProviderById(leg.provider ?? "")!;
  const q = await provider.quote({
    fromChain: leg.fromChain, fromToken, toChain: leg.toChain, toToken: to ? to.address : USDC_SOLANA_MINT, fromAmount: BigInt(leg.amountIn),
    slippageBps: op.slippageBps, fromAddress: addressOn(addresses, leg.fromChain), toAddress: addressOn(addresses, leg.toChain),
    svmSponsor: leg.fromChain === "solana" ? await platformAddress("solana", "solana_fee_payer") : undefined,
    deny: await routeDenyList(leg.toChain, addressOn(addresses, leg.toChain)),
  });
  // The plan's minimum is what the user agreed to: a fresh quote that returns less means the price moved, and a new plan (and consent) is needed.
  // A recovery has no plan to renew: the user signs this quote, bounded by the operation's slippage (the adapter checks it), and its minimum replaces the estimate's.
  if (leg.recoveryOf) await db.update(operationLegs).set({ minOut: q.minOut.toString() }).where(and(eq(operationLegs.id, leg.id), eq(operationLegs.status, "PLANNED")));
  else if (leg.minOut !== null && q.minOut < BigInt(leg.minOut)) throw createHttpError(409, "The price moved since the plan was made. Plan again.", { code: "PRICE_MOVED", details: { plannedMinOut: leg.minOut, quotedMinOut: q.minOut.toString() } });
  const base = { routeSummary: { ...(leg.routeSummary ?? {}), tool: q.toolSummary, routeFees: q.routeFees, priceImpact: q.priceImpact } };
  if (q.transaction.kind === "solana") {
    const exposure = sponsorExposure(q.transaction.serializedBase64); // refuses a transaction the platform fee payer would pay for beyond fees and token-account rent
    // A recovery's Solana fees were not reserved with the plan: reserve them now (per-chain lock and daily caps; refusal is 409 GAS_BUDGET_EXHAUSTED), once per leg.
    // A planned estimate leg reserved LI.FI's gas figure (and rent if the account was missing): if this transaction needs more, the reservation is topped up under the same lock and caps.
    await reserveLegGas(op, leg, "solana", exposure.lamports > q.gasNative ? exposure.lamports : q.gasNative);
    await save({ ...base, builtMessageHash: describeUnsigned(q.transaction.serializedBase64).messageHash });
  } else if (q.transaction.kind === "evm") {
    await save({ ...base, expectedTx: { ...planned, to: q.transaction.to.toLowerCase(), dataHash: sha256Hex(q.transaction.data), value: q.transaction.value } });
  } else {
    await save({ ...base, expectedTx: { ...planned, ...expectedBtcTx(q.transaction.psbtBase64, addressOn(addresses, "bitcoin"), BigInt(leg.amountIn)) } });
  }
  const approval = q.approvalAddress && fromToken ? { token: fromToken, spender: q.approvalAddress, amount: leg.amountIn } : null;
  const inputCount = q.transaction.kind === "bitcoin" ? psbtInputs(q.transaction.psbtBase64).length : 0;
  return { ...response({ estimatedOut: q.estimatedOut.toString(), minOut: q.minOut.toString(), transaction: q.transaction.kind === "bitcoin" ? { ...q.transaction, inputCount } : q.transaction, approval }), gasDrop };
}

/**
 * Brings what a Solana leg has reserved up to `needed`: a recovery leg reserves in full at its first quote (nothing was held at plan time), a planned estimate leg
 * only the shortfall over its recorded `reservedNative`. Adds to the operation's reservation so a later release stays exact. Refusal is 409 GAS_BUDGET_EXHAUSTED.
 */
async function reserveLegGas(op: Op, leg: Leg, chain: AssetChain, needed: bigint): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockOperation(tx, op.id);
    // A stop, expiry or completion may have happened since the quote began: a closed operation reserves nothing.
    if (locked.status !== "PLANNED" && locked.status !== "IN_PROGRESS") throw createHttpError(409, "This operation is no longer open.", { code: "INVALID_TRANSITION" });
    const [current] = await tx.select({ expectedTx: operationLegs.expectedTx, status: operationLegs.status }).from(operationLegs).where(eq(operationLegs.id, leg.id));
    const ex = (current!.expectedTx ?? {}) as { gasReserved?: boolean; reservedNative?: string };
    const have = ex.gasReserved === false ? 0n : ex.reservedNative !== undefined ? BigInt(ex.reservedNative) : null;
    if (current!.status !== "PLANNED" || have === null || needed <= have) return;
    const extra = needed - have;
    await reserveGas(tx, { userId: op.userId, chain, amountNative: extra });
    await tx.update(operations).set({ gasReserved: { ...locked.gasReserved, [chain]: (BigInt(locked.gasReserved[chain] ?? 0) + extra).toString() } }).where(eq(operations.id, op.id));
    await tx.update(operationLegs).set({ expectedTx: { ...ex, gasReserved: true, reservedNative: needed.toString() } }).where(eq(operationLegs.id, leg.id));
  });
}

async function legDeployment(id: string | null) {
  if (!id) return null;
  const [d] = await db.select({ address: instrumentDeployments.address }).from(instrumentDeployments).where(eq(instrumentDeployments.id, id));
  return d ?? null;
}

/** The claim became a send (or an unknown send outcome): the leg is SUBMITTED and the operation IN_PROGRESS. A leg the tracker already moved on is left alone. */
export async function markSubmitted(ctx: OpCtx | null, opId: string, legId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const op = await lockOperation(tx, opId);
    const [leg] = await tx.select().from(operationLegs).where(eq(operationLegs.id, legId));
    if (leg!.status !== "SUBMITTING") return;
    if (op.status === "PLANNED") await setOperationStatus(tx, ctx, op, "IN_PROGRESS");
    await setLegStatus(tx, ctx, leg!, "SUBMITTED");
  });
}

/**
 * Verifies the signed leg, CLAIMS it (SUBMITTING, with the deterministic transaction id, under the operation lock and only if the leg still holds
 * exactly the quote that was verified), and only then sends. A concurrent quote, cancel or second submit therefore either happens before the claim
 * (and this one fails) or finds a claimed leg (and is refused). A refused send releases the claim; an unknown outcome is SUBMITTED and tracked.
 */
export async function submitLeg(ctx: OpCtx, opId: string, legId: string, body: LegSubmit): Promise<OperationView> {
  const { op, leg } = await loadLeg(ctx, opId, legId);
  await assertOperable(ctx, op);
  if (leg.status !== "PLANNED") throw invalidTransition("This leg was already submitted.");
  if (!leg.quoteExpiresAt || leg.quoteExpiresAt <= new Date()) throw createHttpError(409, "The quote expired. Get a new quote and sign again.", { code: "QUOTE_EXPIRED" });
  const addresses = await userAddresses(db, ctx.userId);
  const mismatch = (message: string) => createHttpError(409, message, { code: "TX_MISMATCH" });
  const expected = (leg.expectedTx ?? {}) as { to?: string; dataHash?: string; value?: string; outputs?: PsbtOutput[]; inputs?: PsbtInput[] };

  // Verify only (nothing is sent yet); every path yields the transaction id and, where this server broadcasts, the send to perform after the claim.
  let sourceTx: string;
  let recentBlockhash: string | undefined;
  let send: (() => Promise<unknown>) | null = null;
  if (leg.fromChain === "solana") {
    if (!body.signedTx || !leg.builtMessageHash) throw createHttpError("Send the signed transaction.", { code: "VALIDATION_FAILED" });
    const signed = cosign(body.signedTx, leg.builtMessageHash);
    ({ signature: sourceTx, recentBlockhash } = signed);
    send = () => sendSolana(signed.raw);
  } else if (leg.fromChain === "bitcoin") {
    if (!body.signedPsbt || !expected.outputs || !expected.inputs) throw createHttpError("Send the signed PSBT.", { code: "VALIDATION_FAILED" });
    checkPsbt(body.signedPsbt, { outputs: expected.outputs, inputs: expected.inputs });
    const { rawHex, txid } = finalizePsbt(body.signedPsbt);
    sourceTx = txid;
    send = () => broadcastBitcoin(rawHex);
  } else {
    if (!body.txHash) throw createHttpError("Send the transaction hash.", { code: "VALIDATION_FAILED" });
    const tx = await evmTransaction(leg.fromChain, body.txHash);
    if (!tx) throw createHttpError("That transaction isn't visible yet. Try again in a moment.", { code: "VALIDATION_FAILED" });
    if (tx.from !== addressOn(addresses, leg.fromChain).toLowerCase() || tx.to !== expected.to || sha256Hex(tx.input) !== expected.dataHash || tx.value.toString() !== expected.value) throw mismatch("The transaction doesn't match the prepared one.");
    sourceTx = body.txHash.toLowerCase(); // hashes compare case-insensitively: one spelling under the unique index
  }

  try {
    await db.transaction(async (tx) => {
      const locked = await lockOperation(tx, op.id);
      if (locked.status !== "PLANNED" && locked.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${locked.status.toLowerCase()}.`);
      if (locked.status === "PLANNED" && locked.expiresAt <= new Date()) throw invalidTransition("This plan expired. Start again.");
      const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, leg.id));
      if (current!.status !== "PLANNED" || current!.builtMessageHash !== leg.builtMessageHash || JSON.stringify(current!.expectedTx) !== JSON.stringify(leg.expectedTx)) throw invalidTransition("This leg changed. Get a new quote.");
      await setLegStatus(tx, ctx, current!, "SUBMITTING", { sourceTx, submittedAt: sql`now()` as unknown as Date, expectedTx: recentBlockhash ? { ...(current!.expectedTx ?? {}), recentBlockhash } : current!.expectedTx });
    });
  } catch (err) {
    if (isUniqueViolation(err, "operation_legs_source_tx")) throw invalidTransition("That transaction is already recorded for another leg.");
    throw err;
  }

  try {
    await send?.();
  } catch (err) {
    // A definitive refusal (Solana preflight, Bitcoin node rejection): nothing was sent, so the claim is released and the user can sign a new quote.
    // Anything else (timeout, transport) leaves the outcome unknown: the leg stays claimed as SUBMITTED and the tracker decides.
    const refused = err instanceof SendTransactionError || (err as { code?: string }).code === "BROADCAST_REJECTED";
    if (refused) {
      await db.transaction(async (tx) => {
        await lockOperation(tx, op.id);
        const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, leg.id));
        if (current!.status === "SUBMITTING") await setLegStatus(tx, ctx, current!, "PLANNED", { sourceTx: null, submittedAt: null });
      });
      throw err instanceof SendTransactionError ? createHttpError(503, "The network rejected the transaction. Get a new quote.", { code: "ROUTE_UNAVAILABLE", cause: err }) : err;
    }
  }
  await markSubmitted(ctx, op.id, leg.id);
  await enqueue("track-leg", { legId: leg.id });
  return getOperation(ctx, op.id);
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

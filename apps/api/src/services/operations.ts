import { createHash } from "node:crypto";
import createHttpError from "http-errors";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  basketPositions, basketVersions, db, instrumentDeployments, instruments, investmentWallets, isUniqueViolation, operationLegs, operations,
  positionLedgerEntries, walletAddresses, type DbOrTx, type Tx,
} from "@repo/db";
import {
  ASSET_CHAINS, LEG_TRANSITIONS, OPERATION_TRANSITIONS, USDC_SOLANA_MINT, canTransition, micro, minOut, networkFeeMicro, splitInvestment,
  type AssetChain, type ChainFamily, type InvestRequest, type LegQuoteResponse, type LegSubmit, type OperationView, type SellRequest,
} from "@repo/validator";
import { env } from "../env";
import { bitcoinBalance, broadcastBitcoin, checkPsbt, expectedBtcTx, finalizePsbt, maxBtcMinerFee, psbtInputs, type PsbtInput, type PsbtOutput } from "../providers/bitcoin";
import { evmBalance, evmTransaction } from "../providers/evm-rpc";
import { routeProviderById } from "../providers/routes";
import type { LegQuote } from "../providers/routes/types";
import { SendTransactionError } from "@solana/web3.js";
import { buildFeeTransfer, cosign, describeUnsigned, sendSolana, solanaBalance, sponsorExposure } from "../providers/solana-tx";
import type { RequestMeta } from "../middleware/request-context";
import { enqueue } from "../queues";
import { writeAudit } from "./audit";
import { assertWalletsCanFund, platformAddress, releaseUnspentGas, reserveGas, sendGasDrop } from "./gas";
import { getInvestability } from "./investability";
import { getPrices } from "./pricing";

export interface OpCtx { userId: string; sessionId: string; meta: RequestMeta }
type Op = typeof operations.$inferSelect;
type Leg = typeof operationLegs.$inferSelect;
type Addresses = Partial<Record<ChainFamily, string>>;

const PLAN_TTL = "30 minutes";
const SOLANA_FEE_TRANSFER_LAMPORTS = 10_000n;
/** ponytail: a flat estimate for the network-fee transfer's own cost (one signature, no priority fee). */
const FEE_LEG_GAS_USD = 0.002;
/** Used for the rent estimate only when LI.FI's gas costs carry no native token price. */
const SOL_USD_FALLBACK = 150;
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
  return {
    id: op.id, kind: op.kind, status: op.status, basketId: op.basketId, positionId: op.positionId, amountUsdc: op.amountUsdc, sellPercent: op.sellPercent, slippageBps: op.slippageBps,
    networkFeeUsdc: op.networkFeeUsdc, expiresAt: op.expiresAt.toISOString(), createdAt: op.createdAt.toISOString(),
    legs: legs.map((l) => ({
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

const auditBase = (ctx: OpCtx | null, entityId: string) => ({
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
  if (to === "CANCELLED") await releaseUnspentGas(tx, op.id);
}

/** Locks the operation row. Every leg and operation transition happens under this lock. */
export async function lockOperation(tx: Tx, id: string): Promise<Op> {
  const [op] = await tx.select().from(operations).where(eq(operations.id, id)).for("update");
  if (!op) throw notFound();
  return op;
}

/** After a leg ends: COMPLETED when every leg settled; PARTIAL when an asset leg settled and another failed; FAILED when a leg failed and no asset leg settled. */
export async function refreshOperationStatus(tx: Tx, ctx: OpCtx | null, opId: string): Promise<void> {
  const op = await lockOperation(tx, opId);
  if (op.status !== "IN_PROGRESS") return;
  const legs = await tx.select({ kind: operationLegs.kind, status: operationLegs.status }).from(operationLegs).where(eq(operationLegs.operationId, opId));
  if (legs.every((l) => l.status === "SETTLED")) return setOperationStatus(tx, ctx, op, "COMPLETED");
  if (legs.some((l) => l.status === "FAILED")) return setOperationStatus(tx, ctx, op, legs.some((l) => l.kind !== "network_fee" && l.status === "SETTLED") ? "PARTIAL" : "FAILED");
}

/** Expired plans (nothing submitted within 30 minutes) are cancelled when next touched, which frees the user's one active-operation slot. */
async function cancelIfExpired(tx: Tx, ctx: OpCtx | null, op: Op): Promise<boolean> {
  if (op.status !== "PLANNED" || op.expiresAt > new Date()) return false;
  const [claimed] = await tx.select({ id: operationLegs.id }).from(operationLegs).where(and(eq(operationLegs.operationId, op.id), ne(operationLegs.status, "PLANNED"))).limit(1);
  if (claimed) return false; // a signed transaction is being sent: the plan is not abandoned
  await setOperationStatus(tx, ctx, op, "CANCELLED");
  return true;
}

async function usdcPrice(): Promise<string> {
  const [usdc] = await db.select({ instrumentId: instrumentDeployments.instrumentId }).from(instrumentDeployments)
    .where(and(eq(instrumentDeployments.chain, "solana"), eq(instrumentDeployments.address, USDC_SOLANA_MINT), eq(instrumentDeployments.status, "ACTIVE")));
  const price = usdc ? (await getPrices([usdc.instrumentId])).find((p) => p.kind === "market" && p.status === "ok" && !p.stale) : undefined;
  return price?.value && Number(price.value) > 0 ? price.value : "1"; // a stablecoin: without a fresh, positive market price the peg is used
}

interface LegDraft {
  kind: Leg["kind"]; fromChain: AssetChain; fromDeploymentId: string | null; toChain: AssetChain; toDeploymentId: string | null; amountIn: bigint; minOut: bigint | null;
  routeSummary: Record<string, unknown> | null; expectedTx: Record<string, unknown> | null; gasPayer: Leg["gasPayer"];
}

const gasPayerFor = (chain: AssetChain): Leg["gasPayer"] => (chain === "solana" ? "platform_fee_payer" : chain === "bitcoin" ? "user_btc_inputs" : "platform_gas_drop");

/** One quote per asset leg is taken at plan time only to estimate gas and outputs; quotes that are signed are fetched later, per leg. */
async function planQuote(i: { fromChain: AssetChain; fromToken: string | null; toChain: AssetChain; toToken: string | null; amount: bigint; slippageBps: number; addresses: Addresses }): Promise<LegQuote> {
  const provider = routeProviderById(env.ROUTE_PROVIDER_ORDER[0]!)!;
  return provider.quote({
    fromChain: i.fromChain, fromToken: i.fromToken, toChain: i.toChain, toToken: i.toToken, fromAmount: i.amount, slippageBps: i.slippageBps,
    fromAddress: addressOn(i.addresses, i.fromChain), toAddress: addressOn(i.addresses, i.toChain),
    svmSponsor: i.fromChain === "solana" ? await platformAddress("solana", "solana_fee_payer") : undefined,
  });
}

/**
 * What a Solana-source leg costs the platform: the decoded fee-payer exposure (signatures, priority fee, token-account rent) or LI.FI's own estimate if
 * higher, and the gas estimate in USD with the rent added on top (it is not known whether LI.FI's figure includes it). Refuses an unsponsorable transaction.
 */
function sponsoredCost(q: LegQuote): { lamports: bigint; usd: number } {
  const e = sponsorExposure((q.transaction as { serializedBase64: string }).serializedBase64);
  return { lamports: e.lamports > q.gasNative ? e.lamports : q.gasNative, usd: q.gasEstimateUsd + (Number(e.rentLamports) / 1e9) * (q.nativePriceUsd ?? SOL_USD_FALLBACK) };
}

/** Reserves platform-paid gas, then inserts the operation and its legs, all in one transaction (a refused budget leaves no operation). */
async function insertPlan(ctx: OpCtx, i: { op: Omit<typeof operations.$inferInsert, "userId" | "expiresAt" | "gasReserved">; legs: LegDraft[]; gas: Map<AssetChain, bigint> }): Promise<string> {
  await assertWalletsCanFund(i.gas);
  try {
    return await db.transaction(async (tx) => {
      const stale = await tx.select().from(operations).where(and(eq(operations.userId, ctx.userId), eq(operations.status, "PLANNED"), sql`${operations.expiresAt} <= now()`));
      for (const s of stale) await cancelIfExpired(tx, ctx, s);
      for (const [chain, amountNative] of i.gas) if (amountNative > 0n) await reserveGas(tx, { userId: ctx.userId, chain, amountNative });
      const [op] = await tx.insert(operations).values({ ...i.op, userId: ctx.userId, gasReserved: Object.fromEntries([...i.gas].filter(([, n]) => n > 0n).map(([c, n]) => [c, n.toString()])), expiresAt: sql`now() + ${PLAN_TTL}::interval` as unknown as Date }).returning({ id: operations.id });
      await tx.insert(operationLegs).values(i.legs.map((l, n) => ({
        operationId: op!.id, sequence: n + 1, kind: l.kind, fromChain: l.fromChain, fromDeploymentId: l.fromDeploymentId, toChain: l.toChain, toDeploymentId: l.toDeploymentId,
        amountIn: l.amountIn.toString(), minOut: l.minOut?.toString() ?? null, provider: l.kind === "network_fee" ? null : env.ROUTE_PROVIDER_ORDER[0]!, routeSummary: l.routeSummary,
        expectedTx: l.expectedTx, gasPayer: l.gasPayer,
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

const findByKey = async (userId: string, key: string) => (await db.select().from(operations).where(and(eq(operations.userId, userId), eq(operations.idempotencyKey, key))))[0];

const reused = () => createHttpError("This idempotency key was already used for a different request.", { code: "VALIDATION_FAILED" });

export async function createInvestPlan(ctx: OpCtx, body: InvestRequest): Promise<OperationView> {
  const amount = micro(body.amountUsdc);
  const existing = await findByKey(ctx.userId, body.idempotencyKey);
  if (existing) {
    if (existing.kind !== "invest" || existing.basketId !== body.basketId || existing.amountUsdc !== amount.toString()) throw reused();
    return operationView(db, existing);
  }

  const inv = await getInvestability(db, { id: body.basketId }, ctx.userId);
  if (!inv.investable) throw createHttpError(409, "This basket can't be invested in right now.", { code: "NOT_INVESTABLE", details: { reasons: inv.reasons } });
  const blockers = inv.eligibility?.reasons ?? [];
  for (const code of ["OPERATION_IN_PROGRESS", "BTC_ADDRESS_REQUIRED"] as const) {
    if (blockers.some((r) => r.code === code)) throw createHttpError(409, blockers.find((r) => r.code === code)!.message, { code, details: { reasons: blockers } });
  }
  if (blockers.length) throw createHttpError(409, "You can't invest yet.", { code: "NOT_ELIGIBLE", details: { reasons: blockers } });

  const [version] = await db.select({ increment: basketVersions.minimumIncrementUsdc }).from(basketVersions).where(eq(basketVersions.id, inv.versionId!));
  const invalidAmount = (message: string) => createHttpError(message, { code: "VALIDATION_FAILED" });
  if (!inv.minimumUsdc || amount < micro(inv.minimumUsdc)) throw invalidAmount(`The minimum investment is ${inv.minimumUsdc ?? "not set"} USDC.`);
  if (version?.increment && amount % micro(version.increment) !== 0n) throw invalidAmount(`The amount must be a multiple of ${version.increment} USDC.`);

  const addresses = await userAddresses(db, ctx.userId);
  if ((await solanaBalance(addressOn(addresses, "solana"), USDC_SOLANA_MINT)) < amount) throw createHttpError(409, "Your Solana wallet doesn't hold enough USDC.", { code: "INSUFFICIENT_BALANCE" });

  // Provisional split (no fee) to estimate gas, then the real split with the network fee taken out of the amount.
  const weights = inv.constituents.map((c) => ({ deploymentId: c.deployment.id, bps: c.weightBps }));
  const provisional = splitInvestment(amount, 0n, weights);
  const quotes = await Promise.all(inv.constituents.map((c, n) => planQuote({
    fromChain: "solana", fromToken: USDC_SOLANA_MINT, toChain: c.deployment.chain, toToken: c.deployment.address, amount: provisional[n]!.amountMicro, slippageBps: body.slippageBps, addresses,
  })));
  const costs = quotes.map(sponsoredCost);
  const fee = networkFeeMicro([FEE_LEG_GAS_USD, ...costs.map((c) => c.usd)], await usdcPrice());
  if (amount - fee <= 0n) throw invalidAmount("The amount doesn't cover the network fee.");
  const shares = splitInvestment(amount, fee, weights);
  if (shares.some((s) => s.amountMicro <= 0n)) throw invalidAmount("The amount is too small to split across this basket.");

  const legs: LegDraft[] = [{ kind: "network_fee", fromChain: "solana", fromDeploymentId: null, toChain: "solana", toDeploymentId: null, amountIn: fee, minOut: null, routeSummary: null, expectedTx: null, gasPayer: "platform_fee_payer" }];
  let solanaGas = SOLANA_FEE_TRANSFER_LAMPORTS;
  inv.constituents.forEach((c, n) => {
    const estimatedOut = (quotes[n]!.estimatedOut * shares[n]!.amountMicro) / provisional[n]!.amountMicro;
    solanaGas += costs[n]!.lamports;
    legs.push({
      kind: c.deployment.chain === "solana" ? "swap" : "cross_chain", fromChain: "solana", fromDeploymentId: null, toChain: c.deployment.chain, toDeploymentId: c.deployment.id,
      amountIn: shares[n]!.amountMicro, minOut: minOut(estimatedOut, body.slippageBps), routeSummary: { tool: quotes[n]!.toolSummary, estimatedOut: estimatedOut.toString(), symbol: c.symbol, decimals: c.deployment.decimals }, expectedTx: null, gasPayer: "platform_fee_payer",
    });
  });

  const id = await insertPlan(ctx, {
    op: { basketId: body.basketId, kind: "invest", amountUsdc: amount.toString(), slippageBps: body.slippageBps, networkFeeUsdc: fee.toString(), versionId: inv.versionId!, idempotencyKey: body.idempotencyKey },
    legs, gas: new Map([["solana", solanaGas]]),
  });
  return getOperation(ctx, id);
}

export async function createSellPlan(ctx: OpCtx, body: SellRequest): Promise<OperationView> {
  const existing = await findByKey(ctx.userId, body.idempotencyKey);
  if (existing) {
    if (existing.positionId !== body.positionId || existing.sellPercent !== body.percent) throw reused();
    return operationView(db, existing);
  }
  const [position] = await db.select().from(basketPositions).where(and(eq(basketPositions.id, body.positionId), eq(basketPositions.userId, ctx.userId)));
  if (!position) throw createHttpError("Position not found", { code: "NOT_FOUND" });
  const addresses = await userAddresses(db, ctx.userId);

  // Quantity per deployment: the smaller of the recorded holding and what the wallet still holds, never more.
  const holdings = await db.select({
    deploymentId: positionLedgerEntries.deploymentId, quantity: sql<string>`sum(${positionLedgerEntries.quantityDelta})`, chain: instrumentDeployments.chain, address: instrumentDeployments.address, decimals: instrumentDeployments.decimals, symbol: instruments.symbol,
  }).from(positionLedgerEntries).innerJoin(instrumentDeployments, eq(instrumentDeployments.id, positionLedgerEntries.deploymentId)).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId))
    .where(eq(positionLedgerEntries.positionId, position.id)).groupBy(positionLedgerEntries.deploymentId, instrumentDeployments.chain, instrumentDeployments.address, instrumentDeployments.decimals, instruments.symbol)
    .orderBy(asc(instrumentDeployments.chain), asc(positionLedgerEntries.deploymentId));
  const sells: { deploymentId: string; chain: AssetChain; address: string | null; symbol: string; decimals: number; quantity: bigint }[] = [];
  for (const h of holdings) {
    const wanted = (BigInt(h.quantity) * BigInt(body.percent)) / 100n;
    if (wanted <= 0n) continue;
    const balance = await walletBalance(addresses, h.chain, h.address);
    // Native Bitcoin pays the miner fee out of the same balance: a full sell keeps the fee ceiling back so the PSBT can be built.
    const spendable = h.chain === "bitcoin" ? (balance > maxBtcMinerFee(balance) ? balance - maxBtcMinerFee(balance) : 0n) : balance;
    const quantity = wanted < spendable ? wanted : spendable;
    if (quantity > 0n) sells.push({ deploymentId: h.deploymentId, chain: h.chain, address: h.address, symbol: h.symbol, decimals: h.decimals, quantity });
  }
  if (sells.length === 0) throw createHttpError("There is nothing to sell: your wallet holds none of this position's assets.", { code: "INSUFFICIENT_BALANCE" });

  const quotes = await Promise.all(sells.map((s) => planQuote({ fromChain: s.chain, fromToken: s.address, toChain: "solana", toToken: USDC_SOLANA_MINT, amount: s.quantity, slippageBps: body.slippageBps, addresses })));
  const costs = quotes.map((q, n) => (sells[n]!.chain === "solana" ? sponsoredCost(q) : { lamports: 0n, usd: q.gasEstimateUsd }));
  const fee = networkFeeMicro([FEE_LEG_GAS_USD, ...costs.map((c) => c.usd)], await usdcPrice());
  const legs: LegDraft[] = [];
  const gas = new Map<AssetChain, bigint>([["solana", SOLANA_FEE_TRANSFER_LAMPORTS]]);
  sells.forEach((s, n) => {
    const q = quotes[n]!;
    const payer = gasPayerFor(s.chain);
    // EVM sells: the planned drop is reserved with the plan; `sendGasDrop` later sends exactly this amount. Estimate x 1.5, and x 2 when an ERC-20
    // is sold (the exact-amount approval the client signs first is a second transaction that the quote's gas figure may not cover).
    const drop = payer === "platform_gas_drop" ? (q.gasNative * (s.address ? 4n : 3n)) / 2n : 0n;
    const gasChain = payer === "platform_gas_drop" ? s.chain : "solana";
    gas.set(gasChain, (gas.get(gasChain) ?? 0n) + (payer === "platform_gas_drop" ? drop : payer === "platform_fee_payer" ? costs[n]!.lamports : 0n));
    legs.push({
      kind: s.chain === "solana" ? "swap" : "cross_chain", fromChain: s.chain, fromDeploymentId: s.deploymentId, toChain: "solana", toDeploymentId: null, amountIn: s.quantity,
      minOut: minOut(q.estimatedOut, body.slippageBps), routeSummary: { tool: q.toolSummary, estimatedOut: q.estimatedOut.toString(), symbol: s.symbol, decimals: s.decimals },
      expectedTx: payer === "platform_gas_drop" ? { gasReserved: true, gasDropNative: drop.toString() } : null, gasPayer: payer,
    });
  });
  // The network fee goes FIRST when the wallet already holds that much USDC, so the platform is paid before it spends gas; otherwise it is last
  // (paid from the proceeds) and a fee the user never pays is an accepted loss within the caps.
  const feeLeg: LegDraft = { kind: "network_fee", fromChain: "solana", fromDeploymentId: null, toChain: "solana", toDeploymentId: null, amountIn: fee, minOut: null, routeSummary: null, expectedTx: null, gasPayer: "platform_fee_payer" };
  if ((await solanaBalance(addressOn(addresses, "solana"), USDC_SOLANA_MINT)) >= fee) legs.unshift(feeLeg);
  else legs.push(feeLeg);

  const id = await insertPlan(ctx, {
    op: {
      basketId: position.basketId, positionId: position.id, kind: position.status === "OPEN" ? "sell_to_usdc" : "sell_former", sellPercent: body.percent, slippageBps: body.slippageBps,
      networkFeeUsdc: fee.toString(), versionId: position.appliedVersionId, idempotencyKey: body.idempotencyKey,
    },
    legs, gas,
  });
  return getOperation(ctx, id);
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
  const { op, legs, leg } = await loadLeg(ctx, opId, legId);
  await assertOperable(ctx, op);
  if (leg.status !== "PLANNED") throw invalidTransition("This leg was already submitted.");
  // Strictly sequential: each earlier leg is settled, except that the first asset leg may follow a network fee that is on-chain.
  if (legs.some((l) => l.sequence < leg.sequence && !(l.status === "SETTLED" || (l.kind === "network_fee" && l.status === "PENDING_CHAIN")))) throw invalidTransition("Finish the previous leg first.");

  const addresses = await userAddresses(db, ctx.userId);
  const solanaAddress = addressOn(addresses, "solana");
  // The user's USDC must cover the plan before the first leg (invest) and the fee before the last (sell).
  const need = leg.sequence === 1 && op.kind === "invest" ? BigInt(op.amountUsdc!) : leg.kind === "network_fee" ? BigInt(leg.amountIn) : 0n;
  if (need > 0n && (await solanaBalance(solanaAddress, USDC_SOLANA_MINT)) < need) throw createHttpError(409, "Your Solana wallet doesn't hold enough USDC.", { code: "INSUFFICIENT_BALANCE" });
  const expiresAt = new Date(Date.now() + 60_000);
  // Only an unclaimed leg takes a new quote: a leg that was claimed meanwhile (a submit in flight) keeps the transaction it was claimed with.
  const save = async (patch: Partial<typeof operationLegs.$inferInsert>) => {
    const rows = await db.update(operationLegs).set({ ...patch, quoteExpiresAt: expiresAt, updatedAt: sql`now()` }).where(and(eq(operationLegs.id, leg.id), eq(operationLegs.status, "PLANNED"))).returning({ id: operationLegs.id });
    if (rows.length !== 1) throw invalidTransition("This leg was already submitted.");
  };
  const response = (r: Pick<LegQuoteResponse, "estimatedOut" | "minOut" | "transaction"> & Partial<Pick<LegQuoteResponse, "approval">>): LegQuoteResponse =>
    ({ legId: leg.id, quoteExpiresAt: expiresAt.toISOString(), gasDrop: null, approval: null, ...r });

  if (leg.kind === "network_fee") {
    const built = await buildFeeTransfer({ owner: solanaAddress, amountMicro: BigInt(leg.amountIn) });
    await save({ builtMessageHash: built.messageHash });
    return response({ estimatedOut: null, minOut: null, transaction: { kind: "solana", serializedBase64: built.serializedBase64 } });
  }

  const [from, to] = await Promise.all([legDeployment(leg.fromDeploymentId), legDeployment(leg.toDeploymentId)]);
  const planned = (leg.expectedTx ?? {}) as { gasDropNative?: string; gasReserved?: boolean };
  let gasDrop: LegQuoteResponse["gasDrop"] = null;
  if (leg.gasPayer === "platform_gas_drop") {
    // With the network fee paid first, the platform's gas follows only once that fee has settled; when the fee is last (the user had no USDC to prepay it) the drop is the accepted risk.
    const feeFirst = legs.find((l) => l.kind === "network_fee" && l.sequence < leg.sequence);
    if (feeFirst && feeFirst.status !== "SETTLED") return { legId: leg.id, estimatedOut: null, minOut: null, quoteExpiresAt: null, transaction: null, approval: null, gasDrop: { status: "pending", txHash: null } };
    // Selling the native asset: the wallet needs the amount sold plus gas.
    gasDrop = await sendGasDrop(leg.id, leg.fromChain, addressOn(addresses, leg.fromChain), BigInt(planned.gasDropNative ?? 0), from?.address ? 0n : BigInt(leg.amountIn));
    if (gasDrop.status !== "confirmed" && gasDrop.status !== "skipped") return { legId: leg.id, estimatedOut: null, minOut: null, quoteExpiresAt: null, transaction: null, approval: null, gasDrop };
  }

  const provider = routeProviderById(leg.provider ?? "")!;
  const q = await provider.quote({
    fromChain: leg.fromChain, fromToken: from ? from.address : USDC_SOLANA_MINT, toChain: leg.toChain, toToken: to ? to.address : USDC_SOLANA_MINT, fromAmount: BigInt(leg.amountIn),
    slippageBps: op.slippageBps, fromAddress: addressOn(addresses, leg.fromChain), toAddress: addressOn(addresses, leg.toChain),
    svmSponsor: leg.fromChain === "solana" ? await platformAddress("solana", "solana_fee_payer") : undefined,
  });
  // The plan's minimum is what the user agreed to: a fresh quote that returns less means the price moved, and a new plan (and consent) is needed.
  if (leg.minOut !== null && q.minOut < BigInt(leg.minOut)) throw createHttpError(409, "The price moved since the plan was made. Plan again.", { code: "PRICE_MOVED", details: { plannedMinOut: leg.minOut, quotedMinOut: q.minOut.toString() } });
  const base = { routeSummary: { ...(leg.routeSummary ?? {}), tool: q.toolSummary } };
  if (q.transaction.kind === "solana") {
    sponsorExposure(q.transaction.serializedBase64); // refuses a transaction the platform fee payer would pay for beyond fees and token-account rent
    await save({ ...base, builtMessageHash: describeUnsigned(q.transaction.serializedBase64).messageHash });
  } else if (q.transaction.kind === "evm") {
    await save({ ...base, expectedTx: { ...planned, to: q.transaction.to.toLowerCase(), dataHash: sha256Hex(q.transaction.data), value: q.transaction.value } });
  } else {
    await save({ ...base, expectedTx: { ...planned, ...expectedBtcTx(q.transaction.psbtBase64, addressOn(addresses, "bitcoin"), BigInt(leg.amountIn)) } });
  }
  const approval = q.approvalAddress && from?.address ? { token: from.address, spender: q.approvalAddress, amount: leg.amountIn } : null;
  const inputCount = q.transaction.kind === "bitcoin" ? psbtInputs(q.transaction.psbtBase64).length : 0;
  return { ...response({ estimatedOut: q.estimatedOut.toString(), minOut: q.minOut.toString(), transaction: q.transaction.kind === "bitcoin" ? { ...q.transaction, inputCount } : q.transaction, approval }), gasDrop };
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
    sourceTx = body.txHash;
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
    const legs = await tx.select({ kind: operationLegs.kind, status: operationLegs.status }).from(operationLegs).where(eq(operationLegs.operationId, opId));
    if (legs.some((l) => ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN"].includes(l.status))) throw invalidTransition("A transaction is still pending. Wait for it to finish.");
    if (op.status === "PLANNED") return setOperationStatus(tx, ctx, op, "CANCELLED");
    if (op.status === "IN_PROGRESS") return setOperationStatus(tx, ctx, op, legs.some((l) => l.status === "UNKNOWN" || (l.kind !== "network_fee" && l.status === "SETTLED")) ? "PARTIAL" : "FAILED");
    throw invalidTransition(`This operation is ${op.status.toLowerCase()}.`);
  });
  return getOperation(ctx, opId);
}

/** Leave the basket and keep the assets: the position closes (its ledger is kept as the former-basket record); no transaction is made. */
export async function leavePosition(ctx: OpCtx, positionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(basketPositions).where(and(eq(basketPositions.id, positionId), eq(basketPositions.userId, ctx.userId))).for("update");
    if (!p) throw createHttpError("Position not found", { code: "NOT_FOUND" });
    if (p.status !== "OPEN") throw invalidTransition("This position is already closed.");
    await tx.update(basketPositions).set({ status: "CLOSED", closedAt: sql`now()` }).where(eq(basketPositions.id, positionId));
    await writeAudit(tx, { ...auditBase(ctx, positionId), action: "position.left", entityType: "basket_position", entityId: positionId, metadata: { basketId: p.basketId } });
  });
}

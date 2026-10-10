import createHttpError from "http-errors";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { basketPositions, basketVersions, baskets, db, instrumentDeployments, instruments, investmentWallets, isUniqueViolation, operationLegs, operations, eligibilityDecisions, operationFees, positionLedgerEntries } from "@repo/db";
import { ASSET_CHAINS, USDC_DECIMALS, USDC_SOLANA_MINT, micro, networkFeeMicro, splitInvestment, type AssetChain, type AssetType, type BasketFees, type InvestRequest, type OperationView, type SellRequest } from "@repo/validator";
import { env } from "@/config/dotenv";
import { maxBtcMinerFee } from "@/providers/bitcoin";
import { routeProviderById } from "@/providers/routes";
import { logger } from "@repo/logger";
import { isBuildRefusal } from "@/providers/routes/lifi";
import type { LegEstimate, LegQuote, LegQuoteInput } from "@/providers/routes/types";
import { SOL_USD_FALLBACK, TOKEN_ACCOUNT_RENT_LAMPORTS, solanaBalance, sponsorExposure, tokenAccountMissing } from "@/providers/solana-tx";
import { writeAudit } from "@/modules/audit/audit.service";
import { assertWalletsCanFund, platformAddress, reserveGas } from "./gas.service";
import { assertAllowed, decisionOf, evaluateFor, isRwa, recordDecisions, type DecisionDraft } from "@/modules/eligibility/eligibility.service";
import { getInvestability } from "./investability.service";
import { planFees, type PlannedFee } from "@/modules/fees/fees.service";
import { getPrices, priceToMicro } from "@/modules/assets/pricing.service";
import { lifiToolKind, routeDenyList } from "@/modules/routing/routing.service";
import { type OpCtx, type Leg, PLAN_TTL, SOLANA_FEE_TRANSFER_LAMPORTS, FEE_LEG_GAS_USD, operationView, getOperation, auditBase, freeUsdcMicro, cancelIfExpired, usdcPrice } from "./operations.service";
import { type Addresses, userAddresses, addressOn } from "@/modules/auth/wallets.service";
import { walletBalance } from "./operations.service";

export interface LegDraft {
  kind: Leg["kind"]; fromChain: AssetChain; fromDeploymentId: string | null; toChain: AssetChain; toDeploymentId: string | null; amountIn: bigint; minOut: bigint | null;
  routeSummary: Record<string, unknown> | null; expectedTx: Record<string, unknown> | null; gasPayer: Leg["gasPayer"];
  /** Spec 11: the eligibility decision of an RWA leg, stored with the plan. */
  decision?: DecisionDraft;
}

export const gasPayerFor = (chain: AssetChain): Leg["gasPayer"] => (chain === "solana" ? "platform_fee_payer" : chain === "bitcoin" ? "user_btc_inputs" : "platform_gas_drop");

/** What a plan holds per leg: a quote (a built transaction) or an estimate (no transaction, no funded wallet needed). */
export type PlanQuote = LegQuote | LegEstimate;

/** How many unsponsorable Solana tools we skip on one quote before giving up (Titan, OKX, DFlow and similar currently fail the fee-payer check). */
const MAX_UNSPONSORABLE_SKIPS = 6;

/**
 * A Solana quote the platform can co-sign, or the original quote for other chains. An unsponsorable tool is denied for this request only and the next
 * cheapest route is taken; the fee-payer rules themselves do not change (ADR-014).
 */
export async function quoteSponsorable(input: LegQuoteInput): Promise<LegQuote> {
  const provider = routeProviderById(env.ROUTE_PROVIDER_ORDER[0]!)!;
  const deny = { bridges: [...(input.deny?.bridges ?? [])], exchanges: [...(input.deny?.exchanges ?? [])] };
  let last: unknown;
  for (let n = 0; n < MAX_UNSPONSORABLE_SKIPS; n++) {
    const q = await provider.quote({ ...input, deny });
    if (q.transaction.kind !== "solana") return q;
    try {
      sponsorExposure(q.transaction.serializedBase64);
      return q;
    } catch (err) {
      last = err;
      const tool = q.toolSummary.split(" > ")[0]?.trim() ?? "";
      if (!tool || (err as { code?: string }).code !== "ROUTE_UNAVAILABLE") throw err;
      const kind = await lifiToolKind(tool).catch(() => null);
      const list = kind === "bridge" ? deny.bridges : kind === "exchange" ? deny.exchanges : null;
      if (!list || list.includes(tool)) throw err;
      list.push(tool);
      logger.warn("skipping unsponsorable Solana route", { tool, kind });
    }
  }
  throw last;
}

/**
 * One quote per asset leg is taken at plan time only to estimate gas and outputs; quotes that are signed are fetched later, per leg. `estimate`: the wallet
 * does not hold the funds yet (a rebalance buy paid from sale proceeds), so LI.FI's balance-free route estimate is used. A quote LI.FI refuses because it
 * cannot build the transaction for this wallet (code 1001) falls back to an estimate as well. A built Solana transaction the fee payer must not sign is
 * skipped (that tool denied for this request) and the next route is taken.
 */
export async function planQuote(i: { fromChain: AssetChain; fromToken: string | null; toChain: AssetChain; toToken: string | null; toDecimals: number; amount: bigint; slippageBps: number; addresses: Addresses; estimate?: boolean }): Promise<PlanQuote> {
  const provider = routeProviderById(env.ROUTE_PROVIDER_ORDER[0]!)!;
  const toAddress = addressOn(i.addresses, i.toChain);
  const trade = { fromChain: i.fromChain, fromToken: i.fromToken, toChain: i.toChain, toToken: i.toToken, fromAmount: i.amount, slippageBps: i.slippageBps, toAddress, toDecimals: i.toDecimals, deny: await routeDenyList(i.toChain, toAddress) };
  if (i.estimate) return provider.estimate(trade);
  try {
    return await quoteSponsorable({ ...trade, fromAddress: addressOn(i.addresses, i.fromChain), svmSponsor: i.fromChain === "solana" ? await platformAddress("solana", "solana_fee_payer") : undefined });
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
function sponsoredCost(q: PlanQuote, rentLamports = 0n): { lamports: bigint; usd: number; estimated: boolean } {
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
      // Serialize with reassign_chain (which holds this row FOR UPDATE while it checks for open operations).
      await tx.select({ id: investmentWallets.id }).from(investmentWallets).where(and(eq(investmentWallets.userId, ctx.userId), eq(investmentWallets.status, "active"))).for("share");
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
  for (const code of ["OPERATION_IN_PROGRESS", "BTC_ADDRESS_REQUIRED", "CHAIN_NOT_LINKED", "DECLARATION_REQUIRED"] as const) {
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
    fromChain: "solana", fromToken: USDC_SOLANA_MINT, toChain: c.deployment.chain, toToken: c.deployment.address, toDecimals: c.deployment.decimals, amount: provisional[n]!.amountMicro, slippageBps: body.slippageBps, addresses,
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
    // Scale the plan quote to the fee-adjusted share. Store LI.FI's own toAmountMin (not slippageFloor(estimatedOut)): D-073 compares
    // the fresh quote's toAmountMin to this, and LI.FI's minimum often sits a hair under toAmount×(1−slippage) (minOutAccepted / ADR-017).
    const scale = shares[n]!.amountMicro;
    const base = provisional[n]!.amountMicro;
    const estimatedOut = (quotes[n]!.estimatedOut * scale) / base;
    solanaGas += costs[n]!.lamports;
    legs.push({
      kind: c.deployment.chain === "solana" ? "swap" : "cross_chain", fromChain: "solana", fromDeploymentId: null, toChain: c.deployment.chain, toDeploymentId: c.deployment.id,
      amountIn: scale, minOut: (quotes[n]!.minOut * scale) / base, routeSummary: { tool: quotes[n]!.toolSummary, estimatedOut: estimatedOut.toString(), symbol: c.symbol, decimals: c.deployment.decimals, routeFees: quotes[n]!.routeFees, priceImpact: quotes[n]!.priceImpact }, expectedTx: reservedExpectedTx(costs[n]!), gasPayer: "platform_fee_payer",
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
    minOut: q.minOut, routeSummary: { tool: q.toolSummary, estimatedOut: q.estimatedOut.toString(), symbol: s.symbol, decimals: s.decimals, routeFees: q.routeFees, priceImpact: q.priceImpact },
    expectedTx: payer === "platform_gas_drop" ? { gasReserved: true, gasDropNative: drop.toString() } : reservedExpectedTx(cost), gasPayer: payer,
  };
}

const restrictedNotice = (symbol: string) => `You can't sell ${symbol} through Bytesac in your region; it stays in your wallet.`;

/** The 409 for a wallet that cannot pay the fees up front (D-071). Shared by sell and rebalance plans; `offChain` adds the "before selling assets on X" clause. */
export function insufficientFee(fee: bigint, networkFee: bigint, offChain?: AssetChain): Error {
  const cents = (fee + 9_999n) / 10_000n; // rounded up to whole cents: "at least"
  return createHttpError(409, `Add at least $${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, "0")} USDC on Solana to pay the ${fee === networkFee ? "network fee" : "fees"}${offChain ? ` before selling assets on ${ASSET_CHAINS[offChain].label}` : ""}.`, { code: "INSUFFICIENT_BALANCE", details: { requiredUsdc: fee.toString() } });
}

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

  const quotes = await Promise.all(sells.map((s) => planQuote({ fromChain: s.chain, fromToken: s.address, toChain: "solana", toToken: USDC_SOLANA_MINT, toDecimals: USDC_DECIMALS, amount: s.quantity, slippageBps: body.slippageBps, addresses })));
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
  if (evmSell && feeUsdc < fee) throw insufficientFee(fee, fees.rows[0]!.amountMicro, evmSell.chain);
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

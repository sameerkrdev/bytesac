import createHttpError from "http-errors";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { basketPositions, basketVersionAssets, basketVersions, baskets, db, executionRoutes, instrumentDeployments, instruments, operationLegs, operations, positionCashEntries, positionDecisions, positionLedgerEntries } from "@repo/db";
import { logger } from "@repo/logger";
import { ASSET_CHAINS, MIN_TRADE_BPS_DEFAULT, RWA_ROUTE_METHODS, MIN_TRADE_USDC_DEFAULT, USDC_SOLANA_MINT, feePlacement, micro, minOut, networkFeeMicro, planRebalance, type AssetChain, type BasketFees, type OperationView, type RebalanceRequest, type RepairRequest, type SkipRequest, type SyncRequest, type SyncResult } from "@repo/validator";
import { maxBtcMinerFee } from "@/providers/bitcoin";
import { solanaBalance } from "@/providers/solana-tx";
import { writeAudit } from "@/modules/audit/audit.service";
import { planFees } from "@/modules/fees/fees.service";
import { assertAllowed, decisionOf, evaluateFor, isRwa } from "@/modules/eligibility/eligibility.service";
import { getInvestability } from "@/modules/operations/investability.service";
import { FEE_LEG_GAS_USD, SOLANA_FEE_TRANSFER_LAMPORTS, activeCustom, applyVersion, assertNoneInFlight, auditBase, freeUsdcMicro, getOperation, operationView, closeIfEmpty, hasOpenOperation, leavePosition, lockOperation, setOperationStatus, usdcPrice, type OpCtx } from "@/modules/operations/operations.service";
import { addressOn, userAddresses } from "@/modules/auth/wallets.service";
import { assertEligible, findByKey, insertPlan, legCost, planQuote, reservedExpectedTx, reused, sellLeg, type LegDraft } from "@/modules/operations/plan.service";
import { fanOutToHolders } from "@/modules/notifications/notifications.service";
import { getPrices, priceToMicro } from "@/modules/assets/pricing.service";
import { reconcilePositions } from "@/modules/portfolio/reconciliation.service";
import { latestRecon, valuePosition } from "@/modules/portfolio/valuation.service";
import { sum, stale } from "@/modules/portfolio/valuation.service";

/** Reconciliation rows older than this at plan time mean the balance could not be read just now. */
const FRESH_MS = 120_000;

/** Rebalance, repair and sync plans of one user are created one at a time. ponytail: holds one pool connection for the whole plan build (quotes and RPC included); a per-user queue if planners ever outnumber the pool. */
async function withPlanLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"plan:" + userId}))`);
    return fn();
  });
}

const repairRequired = () => createHttpError(409, "Your wallet holds less than this basket records. Buy back the difference or update your baskets first.", { code: "REPAIR_REQUIRED" });

async function ownOpenPosition(userId: string, positionId: string) {
  const [position] = await db.select().from(basketPositions).where(and(eq(basketPositions.id, positionId), eq(basketPositions.userId, userId), eq(basketPositions.status, "OPEN")));
  if (!position) throw createHttpError("Position not found", { code: "NOT_FOUND" });
  return position;
}

export async function createRebalancePlan(ctx: OpCtx, body: RebalanceRequest): Promise<OperationView | { aligned: true }> {
  return withPlanLock(ctx.userId, async () => {
    const [position] = await db.select().from(basketPositions).where(and(eq(basketPositions.id, body.positionId), eq(basketPositions.userId, ctx.userId)));
    const [basket] = position ? await db.select({ currentVersionId: baskets.currentVersionId, organizationId: baskets.organizationId }).from(baskets).where(eq(baskets.id, position.basketId)) : [];
    const existing = await findByKey(ctx.userId, body.idempotencyKey);
    if (existing) {
      if (existing.kind !== "rebalance" || existing.positionId !== body.positionId || existing.versionId !== (body.target === "latest" ? basket?.currentVersionId : position?.appliedVersionId)) throw reused();
      return operationView(db, existing);
    }
    if (!position || position.status !== "OPEN") throw createHttpError("Position not found", { code: "NOT_FOUND" });

    const startedAt = Date.now();
    await reconcilePositions(ctx.userId);
    if ((await latestRecon(db, { positionId: position.id })).some((r) => r.status === "SHORT")) throw repairRequired();

    if (body.target === "applied" && position.appliedVersionId !== basket!.currentVersionId) throw createHttpError(409, "The basket was updated: review the latest version instead.", { code: "VERSION_NOT_CURRENT" });
    const inv = await getInvestability(db, { id: position.basketId }, { userId: ctx.userId, ipCountry: ctx.meta.ipCountry });
    // Spec 11: only an RWA the plan buys or sells is evaluated (below); one that is merely held never refuses a plan. Spec 12: likewise an asset that is not investable
    // right now blocks only a plan that buys it (or sells it with no route, below); basket-level reasons (the basket is not open) still refuse.
    assertEligible({ ...inv, investable: !inv.reasons.some((r) => !r.instrumentId), eligibility: inv.eligibility && { ...inv.eligibility, reasons: inv.eligibility.reasons.filter((r) => !r.instrumentId || !inv.rwaDecisions.has(r.instrumentId)) } });
    const targetVersionId = inv.versionId!;

    const [version] = await db.select({ rebalance: basketVersions.rebalance, fees: basketVersions.fees, assetsRevision: basketVersions.assetsRevision }).from(basketVersions).where(eq(basketVersions.id, targetVersionId));
    const val = await valuePosition(db, position.id, inv.constituents.map((c) => c.instrumentId));
    const unpriced = val.holdings.find((h) => h.priceMicro === null) ?? inv.constituents.find((c) => !val.priceByInstrument.has(c.instrumentId));
    if (unpriced) throw stale(`No current price for ${unpriced.symbol}; the basket can't be valued right now.`);
    if (val.holdings.some((h) => !h.reconciledAt || h.reconciledAt.getTime() < startedAt - FRESH_MS)) throw stale("Your wallet balances could not be confirmed right now. Try again in a moment.");

    // The target weight of every asset of the version that is not investable right now: kept in the plan at its held deployment (so weights stay right),
    // never bought. One that is not held but would need a buy refuses the plan, naming it.
    const versionAssets = await db.select({ instrumentId: basketVersionAssets.instrumentId, bps: basketVersionAssets.targetWeightBps, symbol: instruments.symbol }).from(basketVersionAssets)
      .innerJoin(instruments, eq(instruments.id, basketVersionAssets.instrumentId)).where(and(eq(basketVersionAssets.versionId, targetVersionId), eq(basketVersionAssets.revision, version!.assetsRevision)));
    const unavailable = versionAssets.filter((a) => !inv.constituents.some((c) => c.instrumentId === a.instrumentId));
    const notBuyable = (a: { instrumentId: string; symbol: string }) => createHttpError(409, `${a.symbol} can't be bought right now.`, { code: "NOT_INVESTABLE", details: { reasons: inv.reasons.filter((r) => r.instrumentId === a.instrumentId) } });
    const heldTargets = unavailable.flatMap((a) => {
      const h = val.holdings.find((x) => x.instrumentId === a.instrumentId && x.quantity > 0n);
      return h ? [{ deploymentId: h.deploymentId, chain: h.chain, decimals: h.decimals, priceMicro: h.priceMicro!, bps: a.bps, symbol: a.symbol, instrumentId: a.instrumentId }] : [];
    });
    const input = {
      holdings: val.holdings.filter((h) => h.quantity > 0n).map((h) => ({ deploymentId: h.deploymentId, chain: h.chain, quantity: h.quantity, decimals: h.decimals, priceMicro: h.priceMicro! })),
      cashMicro: val.cashMicro,
      targets: [
        ...inv.constituents.map((c) => ({ deploymentId: c.deployment.id, chain: c.deployment.chain, decimals: c.deployment.decimals, priceMicro: val.priceByInstrument.get(c.instrumentId)!, bps: c.weightBps })),
        ...heldTargets.map(({ deploymentId, chain, decimals, priceMicro, bps }) => ({ deploymentId, chain, decimals, priceMicro, bps })),
      ],
      minTradeBps: version!.rebalance.minTradeBps ?? MIN_TRADE_BPS_DEFAULT,
      minTradeMicro: micro(version!.rebalance.minTradeUsdc ?? MIN_TRADE_USDC_DEFAULT),
      reserveMicro: 0n,
    };
    const plan = planRebalance(input);
    const blockedBuy = plan.buys.map((b) => heldTargets.find((t) => t.deploymentId === b.deploymentId)).find((t) => t);
    if (blockedBuy) throw notBuyable(blockedBuy);
    const unheld = unavailable.find((a) => !heldTargets.some((t) => t.instrumentId === a.instrumentId) && a.bps >= input.minTradeBps && (plan.valueMicro * BigInt(a.bps)) / 10_000n >= input.minTradeMicro);
    if (unheld) throw notBuyable(unheld);
    // Sells never exceed what the wallet holds (Bitcoin keeps the miner-fee ceiling back, as a sell does).
    const sells = plan.sells.flatMap((s) => {
      const h = val.holdings.find((x) => x.deploymentId === s.deploymentId)!;
      const balance = h.walletBalance ?? 0n;
      const spendable = h.chain === "bitcoin" ? (balance > maxBtcMinerFee(balance) ? balance - maxBtcMinerFee(balance) : 0n) : balance;
      const quantity = s.quantity < spendable ? s.quantity : spendable;
      return quantity > 0n ? [{ instrumentId: h.instrumentId, deploymentId: h.deploymentId, chain: h.chain, address: h.address, symbol: h.symbol, decimals: h.decimals, quantity }] : [];
    });

    if (sells.length === 0 && plan.buys.length === 0) {
      await db.transaction((tx) => applyVersion(tx, ctx, { positionId: position.id, userId: ctx.userId, versionId: targetVersionId }));
      return { aligned: true as const };
    }

    const addresses = await userAddresses(db, ctx.userId);
    // A sale needs an ACTIVE or PAUSED deployment (an exit ignores route status) and any route the provider can quote; otherwise the plan is refused, naming the asset.
    const sellDeployments = sells.length ? await db.select({ id: instrumentDeployments.id, status: instrumentDeployments.status }).from(instrumentDeployments).where(inArray(instrumentDeployments.id, sells.map((s) => s.deploymentId))) : [];
    const noSellRoute = (s: { instrumentId: string; symbol: string }) => createHttpError(409, `${s.symbol} can't be sold through Bytesac right now: no route is available.`, {
      code: "NOT_INVESTABLE", details: { reasons: [{ instrumentId: s.instrumentId, code: "NO_ROUTE", message: `${s.symbol}: no route is available.` }] },
    });
    for (const s of sells) if (!["ACTIVE", "PAUSED"].includes(sellDeployments.find((d) => d.id === s.deploymentId)?.status ?? "")) throw noSellRoute(s);
    const sellQuotes = await Promise.all(sells.map((s) => planQuote({ fromChain: s.chain, fromToken: s.address, toChain: "solana", toToken: USDC_SOLANA_MINT, amount: s.quantity, slippageBps: body.slippageBps, addresses })
      .catch((err: unknown) => { throw (err as { code?: string }).code === "ROUTE_UNAVAILABLE" && !/price impact/i.test((err as Error).message) ? noSellRoute(s) : err; })));
    const buyConstituents = plan.buys.map((b) => inv.constituents.find((c) => c.deployment.id === b.deploymentId)!);
    const buyQuotes = await Promise.all(plan.buys.map((b, n) => planQuote({
      fromChain: "solana", fromToken: USDC_SOLANA_MINT, toChain: b.chain, toToken: buyConstituents[n]!.deployment.address, amount: b.amountMicro, slippageBps: body.slippageBps, addresses,
      // Funded by sale proceeds that are not in the wallet yet: LI.FI's balance-free estimate, never a quote (execution takes a real quote per leg).
      estimate: true,
    })));
    const solanaOwner = addressOn(addresses, "solana");
    const sellCosts = await Promise.all(sellQuotes.map((q, n) => (sells[n]!.chain === "solana" ? legCost(q, "solana", USDC_SOLANA_MINT, solanaOwner) : { lamports: 0n, usd: q.gasEstimateUsd, estimated: false })));
    const buyCosts = await Promise.all(buyQuotes.map((q, n) => legCost(q, plan.buys[n]!.chain, buyConstituents[n]!.deployment.address, solanaOwner)));
    // The traded value T: planned sells plus the buys funded from existing basket cash. Only applying a newer manager version carries the manager's rebalance fee.
    const traded = sum(plan.sells.map((s) => s.valueMicro)) + (val.cashMicro < sum(plan.buys.map((b) => b.amountMicro)) ? val.cashMicro : sum(plan.buys.map((b) => b.amountMicro)));
    const price = await usdcPrice();
    const fees = await planFees(db, {
      networkMicro: networkFeeMicro([FEE_LEG_GAS_USD, ...sellCosts.map((c) => c.usd), ...buyCosts.map((c) => c.usd)], price), operation: targetVersionId !== position.appliedVersionId ? "rebalance_apply" : "rebalance_drift",
      platformBaseMicro: traded, usdcPrice: price, solPriceUsd: [...sellQuotes.filter((_, n) => sells[n]!.chain === "solana"), ...buyQuotes].find((q) => q.nativePriceUsd)?.nativePriceUsd, manager: body.target === "latest" && targetVersionId !== position.appliedVersionId ? { kind: "manager_rebalance", fee: (version!.fees as BasketFees).rebalance, baseMicro: traded } : null,
      organizationId: basket!.organizationId, basketId: position.basketId,
    });
    const fee = fees.totalMicro;

    const walletUsdc = await solanaBalance(addressOn(addresses, "solana"), USDC_SOLANA_MINT);
    const placement = feePlacement({ freeMicro: await freeUsdcMicro(db, ctx.userId, walletUsdc), cashMicro: val.cashMicro, feeMicro: fee, sellChains: sells.map((s) => s.chain) });
    if (!placement) {
      const cents = (fee + 9_999n) / 10_000n; // rounded up to whole cents: "at least"
      const off = sells.find((s) => s.chain !== "solana");
      throw createHttpError(409, `Add at least $${(cents / 100n).toString()}.${(cents % 100n).toString().padStart(2, "0")} USDC on Solana to pay the ${fee === fees.rows[0]!.amountMicro ? "network fee" : "fees"}${off ? ` before selling assets on ${ASSET_CHAINS[off.chain].label}` : ""}.`, { code: "INSUFFICIENT_BALANCE", details: { requiredUsdc: fee.toString() } });
    }
    // Fees paid from basket cash are held back from the buys.
    const buys = placement.fromCash ? planRebalance({ ...input, reserveMicro: fee }).buys : plan.buys;
    if (sells.length === 0 && buys.length === 0) throw createHttpError("Nothing left to trade once the fees are paid.", { code: "VALIDATION_FAILED" });

    // Spec 11 section 7: each RWA sell leg is evaluated for selling and each RWA buy leg for acquiring; one not ALLOWED refuses the plan (nothing is stored).
    const sellTypes = sells.length ? await db.select({ id: instruments.id, assetType: instruments.assetType }).from(instruments).where(inArray(instruments.id, sells.map((s) => s.instrumentId))) : [];
    const sellDecisions = await evaluateFor(db, { userId: ctx.userId, ipCountry: ctx.meta.ipCountry, items: sells.flatMap((s) => { const assetType = sellTypes.find((t) => t.id === s.instrumentId)!.assetType; return isRwa(assetType) ? [{ instrumentId: s.instrumentId, assetType, deploymentId: s.deploymentId, action: "sell" as const }] : []; }) });
    const bought = new Set(buys.map((b) => buyConstituents[plan.buys.findIndex((p) => p.deploymentId === b.deploymentId)]!.instrumentId));
    assertAllowed(new Map([...sellDecisions, ...[...inv.rwaDecisions].filter(([id]) => bought.has(id) && !sellDecisions.has(id))]));

    const gas = new Map<AssetChain, bigint>([["solana", SOLANA_FEE_TRANSFER_LAMPORTS + fees.rentLamports]]);
    const feeLeg: LegDraft = { kind: "network_fee", fromChain: "solana", fromDeploymentId: null, toChain: "solana", toDeploymentId: null, amountIn: fee, minOut: null, routeSummary: placement.fromCash ? { fromCash: true } : null, expectedTx: reservedExpectedTx({ lamports: SOLANA_FEE_TRANSFER_LAMPORTS + fees.rentLamports }), gasPayer: "platform_fee_payer" };
    const legs: LegDraft[] = placement.at === "first" ? [feeLeg] : [];
    sells.forEach((s, n) => legs.push({ ...sellLeg(s, sellQuotes[n]!, sellCosts[n]!, body.slippageBps, gas), decision: decisionOf(sellDecisions, s.instrumentId, "sell") }));
    if (placement.at === "after_sells") legs.push(feeLeg);
    for (const b of buys) {
      const n = plan.buys.findIndex((p) => p.deploymentId === b.deploymentId);
      const c = buyConstituents[n]!;
      const estimatedOut = (buyQuotes[n]!.estimatedOut * b.amountMicro) / plan.buys[n]!.amountMicro;
      gas.set("solana", gas.get("solana")! + buyCosts[n]!.lamports);
      legs.push({
        kind: c.deployment.chain === "solana" ? "swap" : "cross_chain", fromChain: "solana", fromDeploymentId: null, toChain: c.deployment.chain, toDeploymentId: c.deployment.id, amountIn: b.amountMicro,
        minOut: (buyQuotes[n]!.minOut * b.amountMicro) / plan.buys[n]!.amountMicro, routeSummary: { tool: buyQuotes[n]!.toolSummary, estimatedOut: estimatedOut.toString(), symbol: c.symbol, decimals: c.deployment.decimals, planned: true, routeFees: buyQuotes[n]!.routeFees, priceImpact: buyQuotes[n]!.priceImpact },
        expectedTx: reservedExpectedTx(buyCosts[n]!), gasPayer: "platform_fee_payer",
        decision: decisionOf(inv.rwaDecisions, c.instrumentId, "acquire"),
      });
    }

    const id = await insertPlan(ctx, {
      op: { basketId: position.basketId, positionId: position.id, kind: "rebalance", sellPercent: null, amountUsdc: null, slippageBps: body.slippageBps, networkFeeUsdc: fees.rows[0]!.amountMicro.toString(), versionId: targetVersionId, idempotencyKey: body.idempotencyKey },
      legs, gas, fees: fees.rows,
    });
    return getOperation(ctx, id);
  });
}

/** Buy back what the wallet lost of one deployment, for every OPEN position that was short on it: one plan, never one per basket (spec section 4.5). */
export async function createRepairPlan(ctx: OpCtx, body: RepairRequest): Promise<OperationView> {
  return withPlanLock(ctx.userId, async () => {
    const existing = await findByKey(ctx.userId, body.idempotencyKey);
    if (existing) {
      if (existing.kind !== "repair" || existing.deploymentId !== body.deploymentId) throw reused();
      return operationView(db, existing);
    }
    await assertNoneInFlight(db, ctx.userId, body.deploymentId);
    const startedAt = Date.now();
    await reconcilePositions(ctx.userId);
    const short = (await latestRecon(db, { userId: ctx.userId })).filter((r) => r.deploymentId === body.deploymentId && r.status === "SHORT")
      .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime() || (a.positionId < b.positionId ? -1 : 1));
    if (short.length === 0) throw createHttpError("This asset is not short in any of your baskets.", { code: "VALIDATION_FAILED" });
    if (short.some((r) => r.checkedAt.getTime() < startedAt - FRESH_MS)) throw stale("Your wallet balances could not be confirmed right now. Try again in a moment.");

    const [d] = (await db.select({ instrumentId: instrumentDeployments.instrumentId, assetType: instruments.assetType, permissioned: instrumentDeployments.permissioned, method: executionRoutes.method, chain: instrumentDeployments.chain, address: instrumentDeployments.address, decimals: instrumentDeployments.decimals, symbol: instruments.symbol })
      .from(instrumentDeployments).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId))
      .innerJoin(executionRoutes, and(eq(executionRoutes.deploymentId, instrumentDeployments.id), eq(executionRoutes.status, "ACTIVE")))
      .where(and(eq(instrumentDeployments.id, body.deploymentId), eq(instrumentDeployments.status, "ACTIVE"))).orderBy(asc(executionRoutes.createdAt), asc(executionRoutes.id)))
      // Spec 11: a tokenized asset is bought back only on a permissionless token with a synchronous secondary-market route.
      .filter((r) => !isRwa(r.assetType) || (!r.permissioned && RWA_ROUTE_METHODS.includes(r.method)));
    if (!d) throw createHttpError(409, "There is no active route to buy this asset right now.", { code: "NOT_INVESTABLE" });
    const eligibility = await evaluateFor(db, { userId: ctx.userId, ipCountry: ctx.meta.ipCountry, items: isRwa(d.assetType) ? [{ instrumentId: d.instrumentId, assetType: d.assetType, deploymentId: body.deploymentId, action: "acquire" }] : [] });
    assertAllowed(eligibility);
    const price = (await getPrices([d.instrumentId])).find((p) => p.kind === "market" && p.status === "ok" && !p.stale && p.value);
    const priceMicro = price ? priceToMicro(price.value!) : null;
    if (!priceMicro) throw stale("The market price is unavailable right now. Try again in a moment.");

    const shares = Object.fromEntries(short.map((r) => [r.positionId, (r.ledger - r.allocated).toString()]));
    const total = sum(short.map((r) => r.ledger - r.allocated));
    // The market value of the shortfall plus the slippage allowance, rounded up once.
    const den = 10n ** BigInt(d.decimals) * 10_000n;
    const buy = (total * priceMicro * BigInt(10_000 + body.slippageBps) + den - 1n) / den;

    const addresses = await userAddresses(db, ctx.userId);
    const q = await planQuote({ fromChain: "solana", fromToken: USDC_SOLANA_MINT, toChain: d.chain, toToken: d.address, amount: buy, slippageBps: body.slippageBps, addresses });
    const cost = await legCost(q, d.chain, d.address, addressOn(addresses, "solana"));
    const usdc = await usdcPrice();
    const fees = await planFees(db, { networkMicro: networkFeeMicro([FEE_LEG_GAS_USD, cost.usd], usdc), operation: "repair", platformBaseMicro: buy, usdcPrice: usdc, solPriceUsd: q.nativePriceUsd, manager: null, organizationId: null, basketId: null });
    const fee = fees.totalMicro;
    const free = await freeUsdcMicro(db, ctx.userId, await solanaBalance(addressOn(addresses, "solana"), USDC_SOLANA_MINT));
    if (free < fee + buy) throw createHttpError(409, "Your Solana wallet doesn't hold enough free USDC for the buy-back and the fees (basket cash is not available).", { code: "INSUFFICIENT_BALANCE", details: { requiredUsdc: (fee + buy).toString() } });

    const legs: LegDraft[] = [
      { kind: "network_fee", fromChain: "solana", fromDeploymentId: null, toChain: "solana", toDeploymentId: null, amountIn: fee, minOut: null, routeSummary: null, expectedTx: reservedExpectedTx({ lamports: SOLANA_FEE_TRANSFER_LAMPORTS + fees.rentLamports }), gasPayer: "platform_fee_payer" },
      {
        kind: d.chain === "solana" ? "swap" : "cross_chain", fromChain: "solana", fromDeploymentId: null, toChain: d.chain, toDeploymentId: body.deploymentId, amountIn: buy, minOut: minOut(q.estimatedOut, body.slippageBps),
        routeSummary: { tool: q.toolSummary, estimatedOut: q.estimatedOut.toString(), symbol: d.symbol, decimals: d.decimals, routeFees: q.routeFees, priceImpact: q.priceImpact }, expectedTx: reservedExpectedTx(cost), gasPayer: "platform_fee_payer",
        decision: decisionOf(eligibility, d.instrumentId, "acquire"),
      },
    ];
    const id = await insertPlan(ctx, {
      op: { basketId: null, positionId: null, deploymentId: body.deploymentId, repairShares: shares, kind: "repair", slippageBps: body.slippageBps, networkFeeUsdc: fees.rows[0]!.amountMicro.toString(), versionId: short[0]!.appliedVersionId, idempotencyKey: body.idempotencyKey },
      legs, gas: new Map<AssetChain, bigint>([["solana", SOLANA_FEE_TRANSFER_LAMPORTS + cost.lamports + fees.rentLamports]]), fees: fees.rows,
    });
    return getOperation(ctx, id);
  });
}

/**
 * Sync: no transaction, the user tells which basket gave up how much of an asset (or of basket cash) that left the wallet. The shortfall is compared with
 * what the user saw (the latest stored reconciliation) before this reconciles again: a different total is 409 SHORTFALL_CHANGED with the fresh figures.
 */
export async function syncShortfall(ctx: OpCtx, body: SyncRequest): Promise<SyncResult> {
  return withPlanLock(ctx.userId, async () => {
    const assetId = body.asset === "cash" ? null : body.asset.deploymentId;
    const earlier = await db.select().from(positionDecisions).where(and(eq(positionDecisions.actorUserId, ctx.userId), eq(positionDecisions.kind, "sync"), sql`${positionDecisions.data}->>'idempotencyKey' = ${body.idempotencyKey}`));
    if (earlier.length) {
      const done = earlier.map((r) => ({ positionId: r.positionId, quantity: String(r.data.quantity) })).sort((a, b) => (a.positionId < b.positionId ? -1 : 1));
      const asked = body.split.map((s) => ({ positionId: s.positionId, quantity: BigInt(s.quantity).toString() })).sort((a, b) => (a.positionId < b.positionId ? -1 : 1));
      if (JSON.stringify(done) !== JSON.stringify(asked) || earlier.some((r) => r.data.asset !== (assetId ?? "cash"))) throw reused();
      return { synced: done };
    }

    await assertNoneInFlight(db, ctx.userId, assetId ?? "cash");
    await reconcilePositions(ctx.userId);
    const rows = (await latestRecon(db, { userId: ctx.userId })).filter((r) => r.deploymentId === assetId && r.status === "SHORT");
    const invalid = (message: string) => createHttpError(message, { code: "VALIDATION_FAILED" });
    const split = new Map(body.split.map((s) => [s.positionId, BigInt(s.quantity)]));
    if (split.size !== body.split.length) throw invalid("List each basket once.");
    // The form submits the exact total and positions it showed: a different set or total means the shortfall changed since, and the fresh figures come back.
    const total = sum(rows.map((r) => r.ledger - r.allocated));
    if (split.size !== rows.length || rows.some((r) => !split.has(r.positionId)) || sum([...split.values()]) !== total) {
      const positions = rows.map((r) => ({ positionId: r.positionId, ledger: r.ledger.toString(), shortfall: (r.ledger - r.allocated).toString() }));
      throw createHttpError(409, "Your wallet changed while you were editing. Review the new figures and save again.", { code: "SHORTFALL_CHANGED", details: { totalShortfall: total.toString(), positions } });
    }
    if (rows.some((r) => split.get(r.positionId)! > r.ledger)) throw invalid("A basket can't give up more than it records.");

    await db.transaction(async (tx) => {
      for (const [positionId, quantity] of split) {
        const [decision] = await tx.insert(positionDecisions).values({ positionId, kind: "sync", data: { idempotencyKey: body.idempotencyKey, asset: assetId ?? "cash", quantity: quantity.toString() }, actorUserId: ctx.userId }).returning({ id: positionDecisions.id });
        if (quantity > 0n && assetId) await tx.insert(positionLedgerEntries).values({ positionId, deploymentId: assetId, quantityDelta: (-quantity).toString(), reason: "sync", decisionId: decision!.id });
        if (quantity > 0n && !assetId) await tx.insert(positionCashEntries).values({ positionId, amountMicro: (-quantity).toString(), reason: "sync", decisionId: decision!.id });
        await writeAudit(tx, { ...auditBase(ctx, positionId), action: "position.synced", entityType: "basket_position", entityId: positionId, metadata: { asset: assetId ?? "cash", quantity: quantity.toString() } });
        await closeIfEmpty(tx, ctx, positionId); // accepting the loss of the last of a position closes it
      }
    });
    // Record the new state right away so the shortfall shows as resolved; a provider outage here only delays that to the next reconciliation.
    await reconcilePositions(ctx.userId).catch((err) => logger.warn("reconciliation after sync failed", { errMessage: err instanceof Error ? err.message : "unknown" }));
    return { synced: [...split].map(([positionId, quantity]) => ({ positionId, quantity: quantity.toString() })).sort((a, b) => (a.positionId < b.positionId ? -1 : 1)) };
  });
}

const DUST_MICRO = 1_000_000n; // $1

/**
 * "Close position" for dust: allowed while the whole position (holdings at fresh prices plus basket cash) is worth under $1 and anything without a price is
 * below one display unit. It behaves like Leave: no transaction, the remaining tokens and cash become outside-basket. Anything larger is refused.
 */
export async function closeDustPosition(ctx: OpCtx, positionId: string): Promise<void> {
  await ownOpenPosition(ctx.userId, positionId);
  if (await hasOpenOperation(db, positionId)) throw createHttpError(409, "Finish or cancel the current operation on this position first.", { code: "OPERATION_IN_PROGRESS" });
  const val = await valuePosition(db, positionId);
  if (val.valueMicro >= DUST_MICRO || val.holdings.some((h) => h.priceMicro === null && h.quantity >= 10n ** BigInt(h.decimals))) {
    throw createHttpError(409, "This position is worth $1 or more. Sell it, or leave the basket to keep what it holds.", { code: "INVALID_TRANSITION" });
  }
  await leavePosition(ctx, positionId, "position.closed");
}

/** Skipping the current version is recorded once per (position, version); the position keeps its applied version and Apply stays available. */
export async function skipVersion(ctx: OpCtx, positionId: string, body: SkipRequest): Promise<void> {
  const position = await ownOpenPosition(ctx.userId, positionId);
  const [basket] = await db.select({ currentVersionId: baskets.currentVersionId }).from(baskets).where(eq(baskets.id, position.basketId));
  if (body.versionId !== basket!.currentVersionId || body.versionId === position.appliedVersionId) throw createHttpError(409, "Only the basket's newest version, when you have not applied it, can be skipped.", { code: "VERSION_NOT_CURRENT" });
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(positionDecisions).values({ positionId, kind: "skip", versionId: body.versionId, data: {}, actorUserId: ctx.userId }).onConflictDoNothing().returning({ id: positionDecisions.id });
    if (inserted.length) await writeAudit(tx, { ...auditBase(ctx, positionId), action: "position.version_skipped", entityType: "basket_position", entityId: positionId, metadata: { versionId: body.versionId } });
  });
}

/** Keep the current weights as the allocation to leave alone: drift prompts stop until a weight moves a threshold away from this snapshot. */
export async function keepCustom(ctx: OpCtx, positionId: string): Promise<void> {
  const position = await ownOpenPosition(ctx.userId, positionId);
  await reconcilePositions(ctx.userId);
  if ((await latestRecon(db, { positionId })).some((r) => r.status === "SHORT")) throw repairRequired();
  const val = await valuePosition(db, positionId);
  if (!val.fresh) throw stale("A market price is unavailable right now. Try again in a moment.");
  const weights: Record<string, number> = {};
  for (const h of val.holdings) weights[h.instrumentId] = h.weightBps;
  await db.transaction(async (tx) => {
    await tx.insert(positionDecisions).values({ positionId, kind: "keep_custom", data: { weights }, actorUserId: ctx.userId });
    await tx.update(basketPositions).set({ allocationStatus: "CUSTOMIZED", allocationCheckedAt: sql`now()` }).where(eq(basketPositions.id, position.id));
    await writeAudit(tx, { ...auditBase(ctx, positionId), action: "position.custom_kept", entityType: "basket_position", entityId: positionId, metadata: { weights } });
  });
}

export async function revertCustom(ctx: OpCtx, positionId: string): Promise<void> {
  await ownOpenPosition(ctx.userId, positionId);
  if (!(await activeCustom(db, positionId))) return;
  await db.transaction(async (tx) => {
    await tx.insert(positionDecisions).values({ positionId, kind: "revert_custom", data: { reason: "user" }, actorUserId: ctx.userId });
    // The next reconciliation recomputes drift against the applied version.
    await tx.update(basketPositions).set({ allocationStatus: "ALIGNED", allocationCheckedAt: sql`now()` }).where(eq(basketPositions.id, positionId));
    await writeAudit(tx, { ...auditBase(ctx, positionId), action: "position.custom_reverted", entityType: "basket_position", entityId: positionId, metadata: {} });
  });
}

/**
 * A new version became current: open plans of the basket that nothing was sent for are cancelled (their gas reservation is released) because they target
 * an out-of-date version; a plan that is already running continues to its own target. Holders of open positions then get one notice each.
 */
export async function onVersionPublished(basketId: string, versionId: string): Promise<void> {
  const planned = await db.select({ id: operations.id }).from(operations).where(and(eq(operations.basketId, basketId), eq(operations.kind, "rebalance"), eq(operations.status, "PLANNED"), ne(operations.versionId, versionId)));
  for (const { id } of planned) {
    await db.transaction(async (tx) => {
      const op = await lockOperation(tx, id);
      const [claimed] = await tx.select({ id: operationLegs.id }).from(operationLegs).where(and(eq(operationLegs.operationId, id), ne(operationLegs.status, "PLANNED"))).limit(1);
      if (op.status !== "PLANNED" || claimed) return; // a signed transaction is being sent: it runs on
      await setOperationStatus(tx, null, op, "CANCELLED");
      await writeAudit(tx, { ...auditBase(null, id), action: "operation.superseded", entityType: "operation", entityId: id, metadata: { newVersionId: versionId } });
    });
  }
  await fanOutToHolders(basketId, "rebalance_available", { versionId }, `rebalance:${versionId}`);
}

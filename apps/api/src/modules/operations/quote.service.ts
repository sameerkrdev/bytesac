import { createHash } from "node:crypto";
import createHttpError from "http-errors";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, instrumentDeployments, instruments, operationLegs, operations, operationFees } from "@repo/db";
import { USDC_DECIMALS, USDC_SOLANA_MINT, scaleBuys, type AssetChain, type LegQuoteResponse } from "@repo/validator";
import { env } from "@/config/dotenv";
import { logger } from "@repo/logger";
import { expectedBtcTx, psbtInputs } from "@/providers/bitcoin";
import { routeProviderById } from "@/providers/routes";
import type { LegQuote } from "@/providers/routes/types";
import { buildFeeTransfer, describeUnsigned, solanaBalance, sponsorExposure } from "@/providers/solana-tx";
import { quoteSponsorable } from "./plan.service";
import { platformAddress, reserveGas, sendGasDrop } from "./gas.service";
import { assertAllowed, evaluateFor, isRwa, recordDecisions } from "@/modules/eligibility/eligibility.service";
import { routeDenyList } from "@/modules/routing/routing.service";
import { type OpCtx, type Op, type Leg, hasGroups, notFound, invalidTransition, setLegStatus, basketCashMicro, freeUsdcMicro, lockOperation, refreshOperationStatus, cancelIfExpired } from "./operations.service";
import { type Addresses, userAddresses, addressOn } from "@/modules/auth/wallets.service";

export async function loadLeg(ctx: OpCtx, opId: string, legId: string) {
  const [op] = await db.select().from(operations).where(and(eq(operations.id, opId), eq(operations.userId, ctx.userId)));
  const legs = op ? await db.select().from(operationLegs).where(eq(operationLegs.operationId, opId)).orderBy(asc(operationLegs.sequence)) : [];
  const leg = legs.find((l) => l.id === legId);
  if (!op || !leg) throw notFound();
  return { op, legs, leg };
}

/** An operation that is over (or expired before its first submission) takes no more quotes or signatures. */
export async function assertOperable(ctx: OpCtx, op: Op): Promise<void> {
  if (op.status !== "PLANNED" && op.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${op.status.toLowerCase()}.`);
  if (op.status === "PLANNED" && op.expiresAt <= new Date()) {
    await db.transaction(async (tx) => { await cancelIfExpired(tx, ctx, await lockOperation(tx, op.id)); });
    throw invalidTransition("This plan expired. Start again.");
  }
}

export const sha256Hex = (s: string) => createHash("sha256").update(s.toLowerCase()).digest("hex");

/** Spec 11: an RWA leg (the asset bought, or the asset sold) is evaluated again at every quote, per leg or in a group: rules or the declaration may have changed since the plan. Earlier settled legs stand. */
export async function assertLegAllowed(ctx: OpCtx, op: Op, leg: Leg): Promise<void> {
  const rwaDeploymentId = leg.kind === "network_fee" ? null : (leg.fromDeploymentId ?? leg.toDeploymentId);
  const [rwa] = rwaDeploymentId ? await db.select({ instrumentId: instrumentDeployments.instrumentId, assetType: instruments.assetType }).from(instrumentDeployments).innerJoin(instruments, eq(instruments.id, instrumentDeployments.instrumentId)).where(eq(instrumentDeployments.id, rwaDeploymentId)) : [];
  if (rwa && isRwa(rwa.assetType)) {
    const action = leg.fromDeploymentId ? "sell" : "acquire";
    const results = await evaluateFor(db, { userId: ctx.userId, ipCountry: ctx.meta.ipCountry, items: [{ ...rwa, deploymentId: rwaDeploymentId!, action }] });
    await recordDecisions(db, [{ operationId: op.id, legId: leg.id, userId: ctx.userId, ipCountry: ctx.meta.ipCountry, instrumentId: rwa.instrumentId, action, result: results.get(rwa.instrumentId)! }]);
    assertAllowed(results);
  }
}

export async function quoteLeg(ctx: OpCtx, opId: string, legId: string): Promise<LegQuoteResponse> {
  let { op, legs, leg } = await loadLeg(ctx, opId, legId);
  await assertOperable(ctx, op);
  if (await hasGroups(op.id)) throw invalidTransition("Continue this investment on the website.");
  if (leg.status !== "PLANNED") throw invalidTransition("This leg was already submitted.");
  // Strictly sequential: each earlier leg is settled, except that the first asset leg may follow a network fee that is on-chain.
  // A leg that failed with a recovery (the funds arrived as another token) does not hold the legs after it back; its recovery goes last, once every other leg is final.
  if (leg.recoveryOf
    ? legs.some((l) => l.id !== leg.id && !l.recoveryOf && l.status !== "SETTLED" && l.status !== "FAILED")
    : legs.some((l) => l.sequence < leg.sequence && !(l.status === "SETTLED" || l.recoveryToken || (l.kind === "network_fee" && l.status === "PENDING_CHAIN")))) throw invalidTransition("Finish the previous leg first.");

  await assertLegAllowed(ctx, op, leg);

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
    const rows = await db.select({ kind: operationFees.kind, recipient: operationFees.recipientAddress, amountMicro: operationFees.amountMicro }).from(operationFees)
      .where(eq(operationFees.operationId, op.id))
      .orderBy(sql`array_position(array['network','manager_entry','manager_rebalance','platform']::text[], ${operationFees.kind}::text)`);
    // A group's fee leg (spec 22 B-06) carries the per-kind amounts it charges; the plan's single fee leg charges every row.
    const feeCharges = (leg.routeSummary?.feeCharges ?? null) as Record<string, string> | null;
    const charged = rows.map((r) => ({ ...r, amountMicro: feeCharges ? (feeCharges[r.kind] ?? "0") : r.amountMicro })).filter((r) => BigInt(r.amountMicro) > 0n);
    if (rows.length && charged.reduce((t, r) => t + BigInt(r.amountMicro), 0n) !== BigInt(leg.amountIn)) throw createHttpError(503, "This route is unavailable. Plan again.", { code: "ROUTE_UNAVAILABLE" });
    if (!rows.length && !env.GAS_TREASURY_SOLANA_ADDRESS) throw createHttpError(503, "This route is unavailable. Plan again.", { code: "ROUTE_UNAVAILABLE" });
    const transfers = rows.length ? charged.map((c) => ({ recipient: c.recipient!, amountMicro: BigInt(c.amountMicro) })) : [{ recipient: env.GAS_TREASURY_SOLANA_ADDRESS!, amountMicro: BigInt(leg.amountIn) }];
    const built = await buildFeeTransfer({ owner: solanaAddress, payer: leg.gasPayer === "platform_fee_payer" ? "platform" : "user", transfers });
    // preparedBase64 lets submit accept wallet ComputeBudget padding while still matching this quote's transfers (ADR-014).
    await save({ builtMessageHash: built.messageHash, expectedTx: { ...(leg.expectedTx ?? {}), preparedBase64: built.serializedBase64 } });
    return response({ estimatedOut: null, minOut: null, transaction: { kind: "solana", serializedBase64: built.serializedBase64 } });
  }

  let gasDrop: LegQuoteResponse["gasDrop"] = null;
  if (leg.gasPayer === "platform_gas_drop") {
    // The platform's gas follows only once the operation's network fee has settled (an EVM sell plan always puts the fee first).
    const fee = legs.find((l) => l.kind === "network_fee");
    if (fee?.status !== "SETTLED") return { legId: leg.id, estimatedOut: null, minOut: null, quoteExpiresAt: null, transaction: null, approval: null, gasDrop: { status: "pending", txHash: null } };
    // Selling the native asset: the wallet needs the amount sold plus gas.
    const planned = (leg.expectedTx ?? {}) as { gasDropNative?: string };
    gasDrop = await sendGasDrop(leg.id, leg.fromChain, addressOn(addresses, leg.fromChain), BigInt(planned.gasDropNative ?? 0), sourceToken(leg, await legDeployment(leg.fromDeploymentId)) ? 0n : BigInt(leg.amountIn));
    if (gasDrop.status !== "confirmed" && gasDrop.status !== "skipped") return { legId: leg.id, estimatedOut: null, minOut: null, quoteExpiresAt: null, transaction: null, approval: null, gasDrop };
  }

  const { patch, response: quoted } = await quoteAssetLeg(op, leg, addresses);
  await save(patch);
  return { ...response(quoted), gasDrop };
}

/** The token a leg spends: a recovery leg swaps the token that arrived (its address is in the route summary; null = the chain's native asset), any other leg its deployment's, a buy USDC. */
const sourceToken = (leg: Leg, from: { address: string | null } | null): string | null =>
  leg.recoveryOf ? ((leg.routeSummary?.fromToken ?? null) as string | null) : from ? from.address : USDC_SOLANA_MINT;

/**
 * One fresh quote for an asset leg, shared by the per-leg endpoint and the signing group. Returns the provider quote, the leg columns the quote sets (the caller
 * saves them while the leg is still PLANNED) and the parts of the response that do not depend on how it is saved. A leg planned with the platform as fee payer
 * (before user-paid Solana gas) still quotes with `svmSponsor` and reserves platform gas; every other Solana leg is quoted for the user as fee payer.
 */
export async function quoteAssetLeg(op: Op, leg: Leg, addresses: Addresses): Promise<{ q: LegQuote; patch: Partial<typeof operationLegs.$inferInsert>; response: Pick<LegQuoteResponse, "estimatedOut" | "minOut" | "transaction" | "approval"> }> {
  const [from, to] = await Promise.all([legDeployment(leg.fromDeploymentId), legDeployment(leg.toDeploymentId)]);
  const fromToken = sourceToken(leg, from);
  let planned = (leg.expectedTx ?? {}) as Record<string, unknown>;
  const input = {
    fromChain: leg.fromChain, fromToken, toChain: leg.toChain, toToken: to ? to.address : USDC_SOLANA_MINT, toDecimals: to ? to.decimals : USDC_DECIMALS, fromAmount: BigInt(leg.amountIn),
    slippageBps: op.slippageBps, fromAddress: addressOn(addresses, leg.fromChain), toAddress: addressOn(addresses, leg.toChain), deny: await routeDenyList(leg.toChain, addressOn(addresses, leg.toChain)),
  };
  const legacy = leg.fromChain === "solana" && leg.gasPayer === "platform_fee_payer";
  const q = legacy ? await quoteSponsorable({ ...input, svmSponsor: await platformAddress("solana", "solana_fee_payer") }) : await routeProviderById(env.ROUTE_PROVIDER_ORDER[0]!)!.quote(input);
  // A recovery has no plan floor: store the fresh quote's minimum. D-073 PRICE_MOVED is temporarily disabled for the pilot (2026-10-11): a worse
  // fresh quote is accepted, the stored floor is lowered to match, and the confirm step shows those figures before the wallet opens. Re-enable the
  // 409 below (and the invest test) when pilot signing is stable.
  const lowered = !!leg.recoveryOf || (leg.minOut !== null && q.minOut < BigInt(leg.minOut));
  if (lowered && !leg.recoveryOf) logger.warn("D-073 waived: accepting fresh minOut below plan", { legId: leg.id, plannedMinOut: leg.minOut, quotedMinOut: q.minOut.toString() });
  const patch: Partial<typeof operationLegs.$inferInsert> = { routeSummary: { ...(leg.routeSummary ?? {}), tool: q.toolSummary, routeFees: q.routeFees, priceImpact: q.priceImpact }, ...(lowered ? { minOut: q.minOut.toString() } : {}) };
  if (q.transaction.kind === "solana") {
    if (legacy) {
      const exposure = sponsorExposure(q.transaction.serializedBase64); // refuses a transaction the platform fee payer would pay for beyond fees and token-account rent
      // A recovery's Solana fees were not reserved with the plan: reserve them now (per-chain lock and daily caps; refusal is 409 GAS_BUDGET_EXHAUSTED), once per leg.
      // A planned estimate leg reserved LI.FI's gas figure (and rent if the account was missing): if this transaction needs more, the reservation is topped up under the same lock and caps.
      planned = (await reserveLegGas(op, leg, "solana", exposure.lamports > q.gasNative ? exposure.lamports : q.gasNative)) ?? planned; // the top-up rewrote the leg's expectedTx: keep it
    }
    Object.assign(patch, { builtMessageHash: describeUnsigned(q.transaction.serializedBase64).messageHash, expectedTx: { ...planned, preparedBase64: q.transaction.serializedBase64 } });
  } else if (q.transaction.kind === "evm") {
    Object.assign(patch, { expectedTx: { ...planned, to: q.transaction.to.toLowerCase(), dataHash: sha256Hex(q.transaction.data), value: q.transaction.value } });
  } else {
    Object.assign(patch, { expectedTx: { ...planned, ...expectedBtcTx(q.transaction.psbtBase64, addressOn(addresses, "bitcoin"), BigInt(leg.amountIn)) } });
  }
  const approval = q.approvalAddress && fromToken ? { token: fromToken, spender: q.approvalAddress, amount: leg.amountIn } : null;
  const transaction = q.transaction.kind === "bitcoin" ? { ...q.transaction, inputCount: psbtInputs(q.transaction.psbtBase64).length } : q.transaction;
  return { q, patch, response: { estimatedOut: q.estimatedOut.toString(), minOut: q.minOut.toString(), transaction, approval } };
}

/**
 * Brings what a Solana leg has reserved up to `needed`: a recovery leg reserves in full at its first quote (nothing was held at plan time), a planned estimate leg
 * only the shortfall over its recorded `reservedNative`. Adds to the operation's reservation so a later release stays exact. Refusal is 409 GAS_BUDGET_EXHAUSTED.
 * Returns the leg's new expectedTx when it changed (the caller must build on it, not on the copy it loaded before), else null.
 */
async function reserveLegGas(op: Op, leg: Leg, chain: AssetChain, needed: bigint): Promise<Record<string, unknown> | null> {
  return db.transaction(async (tx) => {
    const locked = await lockOperation(tx, op.id);
    // A stop, expiry or completion may have happened since the quote began: a closed operation reserves nothing.
    if (locked.status !== "PLANNED" && locked.status !== "IN_PROGRESS") throw createHttpError(409, "This operation is no longer open.", { code: "INVALID_TRANSITION" });
    const [current] = await tx.select({ expectedTx: operationLegs.expectedTx, status: operationLegs.status }).from(operationLegs).where(eq(operationLegs.id, leg.id));
    const ex = (current!.expectedTx ?? {}) as { gasReserved?: boolean; reservedNative?: string };
    const have = ex.gasReserved === false ? 0n : ex.reservedNative !== undefined ? BigInt(ex.reservedNative) : null;
    if (current!.status !== "PLANNED" || have === null || needed <= have) return null;
    const extra = needed - have;
    await reserveGas(tx, { userId: op.userId, chain, amountNative: extra });
    await tx.update(operations).set({ gasReserved: { ...locked.gasReserved, [chain]: (BigInt(locked.gasReserved[chain] ?? 0) + extra).toString() } }).where(eq(operations.id, op.id));
    const expectedTx = { ...ex, gasReserved: true, reservedNative: needed.toString() };
    await tx.update(operationLegs).set({ expectedTx }).where(eq(operationLegs.id, leg.id));
    return expectedTx;
  });
}

async function legDeployment(id: string | null) {
  if (!id) return null;
  const [d] = await db.select({ address: instrumentDeployments.address, decimals: instrumentDeployments.decimals }).from(instrumentDeployments).where(eq(instrumentDeployments.id, id));
  return d ?? null;
}

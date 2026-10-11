import createHttpError from "http-errors";
import { asc, eq } from "drizzle-orm";
import { db, operationLegs, operations } from "@repo/db";
import { USDC_SOLANA_MINT, type ContinueRequest, type OperationView } from "@repo/validator";
import { writeAudit } from "@/modules/audit/audit.service";
import { FEE_TRANSFER_USER_LAMPORTS, solanaBalance } from "@/providers/solana-tx";
import { addressOn, userAddresses } from "@/modules/auth/wallets.service";
import { type Leg, type OpCtx, auditBase, freeUsdcMicro, getOperation, hasGroups, invalidTransition, lockOperation, notFound, plannedFloor, refreshOperationStatus, releaseQuotedGroups, setLegStatus, userLamports } from "./operations.service";
import { assertSolFor } from "./plan.service";

const shareOf = (l: Pick<Leg, "feeShare">) => Object.values(l.feeShare ?? {}).reduce((t, v) => t + BigInt(v), 0n);

/**
 * Continue an unfinished batched investment (spec 22 B-08, section 8.2): skips the legs the user gave up on, makes a retry leg for every failed one (same
 * amount, fee share and fee coverage), applies a new slippage, and checks that the wallet still covers the rest (Invest what's available scales it down).
 * Nothing is sent: the website then asks for a new group. Runs once per idempotency key.
 */
export async function continueOperation(ctx: OpCtx, opId: string, body: ContinueRequest): Promise<OperationView> {
  const owner = addressOn(await userAddresses(db, ctx.userId), "solana");
  await db.transaction(async (tx) => {
    const op = await lockOperation(tx, opId);
    if (op.userId !== ctx.userId) throw notFound();
    if (op.lastContinueKey === body.idempotencyKey) return; // a replay answers the same view, even if that Continue ended the investment
    if (op.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${op.status.toLowerCase()}.`);
    if (!(await hasGroups(opId))) throw invalidTransition("Nothing to continue.");
    const legs = await tx.select().from(operationLegs).where(eq(operationLegs.operationId, opId)).orderBy(asc(operationLegs.sequence));
    if (legs.some((l) => ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN", "UNKNOWN"].includes(l.status))) throw createHttpError(409, "A transaction of this investment is still being confirmed. Wait for it to finish.", { code: "OPERATION_IN_PROGRESS" });
    await releaseQuotedGroups(tx, opId); // an unsigned batch is stale once the legs, amounts or slippage change

    const isAsset = (l: Leg) => l.kind !== "network_fee" && !l.recoveryOf;
    const replaced = new Set(legs.filter((l) => l.retryOf).map((l) => l.retryOf));
    const skip = new Set(body.skipLegIds ?? []);
    for (const id of skip) {
      const l = legs.find((x) => x.id === id);
      if (!l || !isAsset(l) || replaced.has(l.id) || !(l.status === "PLANNED" || (l.status === "FAILED" && l.failureReason !== "SKIPPED"))) throw createHttpError(400, "That transaction can't be skipped.", { code: "VALIDATION_FAILED" });
      if (l.status === "PLANNED") await setLegStatus(tx, ctx, l, "FAILED", { failureReason: "SKIPPED", groupId: null });
      else await tx.update(operationLegs).set({ failureReason: "SKIPPED" }).where(eq(operationLegs.id, l.id)); // FAILED to FAILED is not a transition
    }

    let sequence = Math.max(...legs.map((l) => l.sequence));
    let retries = 0;
    for (const l of legs) {
      if (!isAsset(l) || l.status !== "FAILED" || replaced.has(l.id) || skip.has(l.id) || l.failureReason === "SKIPPED" || l.failureReason === "DESTINATION_SWAP_FAILED" || l.recoveryToken) continue;
      const { tool: _t, routeFees: _f, priceImpact: _p, quoted: _q, ...route } = l.routeSummary ?? {};
      await tx.insert(operationLegs).values({
        operationId: opId, sequence: ++sequence, kind: l.kind, fromChain: l.fromChain, fromDeploymentId: l.fromDeploymentId, toChain: l.toChain, toDeploymentId: l.toDeploymentId, amountIn: l.amountIn, minOut: plannedFloor(l),
        provider: l.provider, routeSummary: route, expectedTx: { userLamports: userLamports(l).toString() }, gasPayer: l.gasPayer, feeShare: l.feeShare, feeCoveredBy: l.feeCoveredBy, retryOf: l.id,
      });
      retries += 1;
    }
    if (body.slippageBps) await tx.update(operations).set({ slippageBps: body.slippageBps }).where(eq(operations.id, opId));

    // The rest of the investment must still be affordable: USDC for the legs and the fee shares not yet charged, SOL for the network fees.
    let remaining = (await tx.select().from(operationLegs).where(eq(operationLegs.operationId, opId)).orderBy(asc(operationLegs.sequence))).filter((l) => isAsset(l) && l.status === "PLANNED");
    let scaled = false;
    if (remaining.length) {
      const need = remaining.reduce((t, l) => t + BigInt(l.amountIn) + (l.feeCoveredBy ? 0n : shareOf(l)), 0n);
      const held = await freeUsdcMicro(tx, ctx.userId, await solanaBalance(owner, USDC_SOLANA_MINT));
      if (held < need) {
        if (!body.scaleToAvailable) throw createHttpError(409, "Your Solana wallet doesn't hold enough USDC.", { code: "INSUFFICIENT_BALANCE", details: { usdcRequiredMicro: need.toString(), usdcHeldMicro: held.toString() } });
        // Floor every amount and uncovered share by held / need; the rounding remainder goes to the largest amount, so the total is exactly what is available.
        const amounts = remaining.map((l) => (BigInt(l.amountIn) * held) / need);
        const shares = remaining.map((l) => Object.fromEntries(Object.entries(l.feeCoveredBy ? {} : (l.feeShare ?? {})).map(([k, v]) => [k, ((BigInt(v) * held) / need)])));
        const given = amounts.reduce((t, a) => t + a, 0n) + shares.reduce((t, s) => t + Object.values(s).reduce((u, v) => u + v, 0n), 0n);
        const largest = remaining.reduce((best, l, i) => (BigInt(l.amountIn) > BigInt(remaining[best]!.amountIn) ? i : best), 0);
        amounts[largest] = amounts[largest]! + (held - given);
        for (const [i, l] of remaining.entries()) {
          if (amounts[i] === 0n) await setLegStatus(tx, ctx, l, "FAILED", { failureReason: "SKIPPED", groupId: null });
          else await tx.update(operationLegs).set({
            amountIn: amounts[i]!.toString(), minOut: l.minOut === null ? null : ((BigInt(l.minOut) * amounts[i]!) / BigInt(l.amountIn)).toString(),
            feeShare: l.feeCoveredBy ? l.feeShare : Object.fromEntries(Object.entries(shares[i]!).map(([k, v]) => [k, v.toString()])),
          }).where(eq(operationLegs.id, l.id));
        }
        remaining = remaining.filter((_, i) => amounts[i] !== 0n);
        scaled = true;
      }
      if (remaining.length) await assertSolFor(owner, (remaining.some((l) => !l.feeCoveredBy && shareOf(l) > 0n) ? FEE_TRANSFER_USER_LAMPORTS : 0n) + remaining.reduce((t, l) => t + userLamports(l), 0n));
    }

    await tx.update(operations).set({ lastContinueKey: body.idempotencyKey }).where(eq(operations.id, opId));
    await refreshOperationStatus(tx, ctx, opId); // only skips left: it stops (PARTIAL or FAILED)
    await writeAudit(tx, { ...auditBase(ctx, opId), action: "operation.continued", entityType: "operation", entityId: opId, metadata: { retries, skips: skip.size, slippageBps: body.slippageBps ?? null, scaled } });
  });
  return getOperation(ctx, opId);
}

import createHttpError from "http-errors";
import { SendTransactionError } from "@solana/web3.js";
import { and, asc, eq, inArray, isNull, notExists, sql } from "drizzle-orm";
import { db, isUniqueViolation, operationFees, operationGroups, operationLegs, operations } from "@repo/db";
import { GROUP_SEND_WINDOW_MS, K_SIGN_ALL, SOL_BUFFER_LAMPORTS, USDC_SOLANA_MINT, approvalsEstimate, type GroupRequest, type GroupResponse, type GroupSubmit, type OperationView } from "@repo/validator";
import { logger } from "@repo/logger";
import { enqueue } from "@/config/queues";
import { blockhashUsable, buildFeeTransfer, connection, sendSolana, solanaBalance, solanaNeed, solanaConfirmed, verifyUserSigned } from "@/providers/solana-tx";
import { addressOn, userAddresses } from "@/modules/auth/wallets.service";
import { type Leg, type OpCtx, freeUsdcMicro, getOperation, invalidTransition, lockOperation, notFound, setLegStatus } from "./operations.service";
import { assertSolFor } from "./plan.service";
import { assertLegAllowed, assertOperable, quoteAssetLeg } from "./quote.service";
import { markSubmitted } from "./submit.service";

const IN_FLIGHT = ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN", "UNKNOWN"] as const;
const inProgress = () => createHttpError(409, "A transaction of this investment is still being confirmed. Wait for it to finish.", { code: "OPERATION_IN_PROGRESS" });
const hasShare = (l: Pick<Leg, "feeShare">) => Object.values(l.feeShare ?? {}).some((v) => BigInt(v) > 0n);
const preparedOf = (l: Pick<Leg, "expectedTx">) => (l.expectedTx as { preparedBase64: string }).preparedBase64;
/** What a leg's fresh group quote stored in its route summary (see `requestGroup`), for the response and its idempotent replay. */
type Quoted = { estimatedOut: string; minOut: string; plannedMinOut: string | null };

/**
 * Forms a signing group (spec 22 section 6.2): the next chunk of PLANNED Solana legs plus one fee transaction charging their uncovered fee shares. The legs are
 * quoted in parallel; one that cannot be quoted is left out with its error. Tier `single` (one popup per transaction, spec 22 section 5.2) first signs one
 * fee-only group charging the uncovered shares of every PLANNED Solana leg, then one leg per group. Nothing is signed or sent here.
 */
export async function requestGroup(ctx: OpCtx, opId: string, body: GroupRequest): Promise<GroupResponse> {
  const [op0] = await db.select().from(operations).where(and(eq(operations.id, opId), eq(operations.userId, ctx.userId)));
  if (!op0) throw notFound();
  await assertOperable(ctx, op0);
  if (op0.kind !== "invest") throw invalidTransition("Only a first investment is signed in batches.");
  const addresses = await userAddresses(db, ctx.userId);
  const owner = addressOn(addresses, "solana");

  const prep = await db.transaction(async (tx) => {
    const op = await lockOperation(tx, opId);
    if (op.status !== "PLANNED" && op.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${op.status.toLowerCase()}.`);
    const groups = await tx.select().from(operationGroups).where(eq(operationGroups.operationId, opId));
    const same = groups.find((g) => g.idempotencyKey === body.idempotencyKey);
    if (same) return { replay: same, op, take: [] as Leg[], feeOnly: null };
    const legs = await tx.select().from(operationLegs).where(eq(operationLegs.operationId, opId)).orderBy(asc(operationLegs.sequence));
    if (!groups.length && legs.some((l) => l.status !== "PLANNED")) throw invalidTransition("This investment is being signed one transaction at a time.");
    if (legs.some((l) => l.kind === "network_fee" && (IN_FLIGHT as readonly string[]).includes(l.status))) throw inProgress();
    // A claimed group whose legs are all past the claim (a send that ended) no longer holds the chain's one open slot.
    await tx.update(operationGroups).set({ status: "SENT", updatedAt: sql`now()` })
      .where(and(eq(operationGroups.operationId, opId), eq(operationGroups.status, "CLAIMED"), notExists(db.select().from(operationLegs).where(and(eq(operationLegs.groupId, operationGroups.id), eq(operationLegs.status, "SUBMITTING"))))));
    const expired = await tx.update(operationGroups).set({ status: "EXPIRED", updatedAt: sql`now()` }).where(and(eq(operationGroups.operationId, opId), eq(operationGroups.chain, body.chain), eq(operationGroups.status, "QUOTED"))).returning({ id: operationGroups.id });
    if (expired.length) await tx.update(operationLegs).set({ groupId: null, updatedAt: sql`now()` }).where(and(inArray(operationLegs.groupId, expired.map((g) => g.id)), eq(operationLegs.status, "PLANNED")));
    const candidates = legs.filter((l) => l.kind !== "network_fee" && l.status === "PLANNED" && l.fromChain === "solana" && !l.recoveryOf);
    if (!candidates.length) throw invalidTransition("Nothing is left to sign.");
    if (candidates.some((l) => l.gasPayer === "platform_fee_payer")) throw invalidTransition("This plan was made before user-paid gas. Plan again.");
    const uncovered = candidates.filter((l) => !l.feeCoveredBy && hasShare(l));
    // `single`: the fee transaction alone first (it charges every uncovered leg), then one leg per group; otherwise a chunk plus its fee.
    const feeOnly = body.tier === "single" && uncovered.length > 0;
    return { replay: null, op, take: feeOnly ? [] : candidates.slice(0, body.tier === "single" ? 1 : K_SIGN_ALL - (uncovered.length ? 1 : 0)), feeOnly: feeOnly ? uncovered : null };
  });
  if (prep.replay) {
    if (prep.replay.status !== "QUOTED") throw invalidTransition(`This batch is ${prep.replay.status.toLowerCase()}.`);
    return groupView(prep.replay, [], owner);
  }
  const { op, take, feeOnly } = prep;

  // Height first: a blockhash fetched by the quotes below is at least this fresh, so the send gate only errs towards releasing early.
  const quoteBlockHeight = await connection.getBlockHeight("confirmed");
  const settled = await Promise.allSettled(take.map(async (leg) => {
    await assertLegAllowed(ctx, op, leg);
    const r = await quoteAssetLeg(op, leg, addresses);
    if (r.q.transaction.kind !== "solana") throw createHttpError(503, "This route is unavailable. Plan again.", { code: "ROUTE_UNAVAILABLE" });
    return { leg, ...r, serializedBase64: r.q.transaction.serializedBase64 };
  }));
  const quoted = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const errors = settled.flatMap((r, n) => (r.status === "rejected"
    ? [{ legId: take[n]!.id, error: { code: String((r.reason as { code?: string }).code ?? "ROUTE_UNAVAILABLE"), message: createHttpError.isHttpError(r.reason) ? r.reason.message : "This route is unavailable." } }]
    : []));
  if (take.length && !quoted.length) throw (settled.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;

  // The fee transaction charges the uncovered shares of the legs that were quoted (or, fee-only, of every leg it covers), in network, manager, platform order.
  const charged = (feeOnly ?? quoted.map((q) => q.leg)).filter((l) => !l.feeCoveredBy);
  const sums = new Map<string, bigint>();
  for (const leg of charged) for (const [kind, v] of Object.entries(leg.feeShare ?? {})) sums.set(kind, (sums.get(kind) ?? 0n) + BigInt(v));
  const rows = await db.select({ kind: operationFees.kind, recipient: operationFees.recipientAddress }).from(operationFees).where(eq(operationFees.operationId, op.id))
    .orderBy(sql`array_position(array['network','manager_entry','manager_rebalance','platform']::text[], ${operationFees.kind}::text)`);
  const transfers = rows.flatMap((r) => (sums.get(r.kind) && r.recipient ? [{ recipient: r.recipient, amountMicro: sums.get(r.kind)! }] : []));
  const feeMicro = [...sums.values()].reduce((t, v) => t + v, 0n);
  if (transfers.reduce((t, x) => t + x.amountMicro, 0n) !== feeMicro) throw createHttpError(503, "This route is unavailable. Plan again.", { code: "ROUTE_UNAVAILABLE" });
  const feeTx = feeMicro > 0n ? await buildFeeTransfer({ owner, payer: "user", transfers }) : null;

  const usdcRequired = feeMicro + quoted.reduce((t, { leg }) => t + BigInt(leg.amountIn), 0n);
  const usdcHeld = await freeUsdcMicro(db, ctx.userId, await solanaBalance(owner, USDC_SOLANA_MINT));
  if (usdcHeld < usdcRequired) throw createHttpError(409, "Your Solana wallet doesn't hold enough USDC.", { code: "INSUFFICIENT_BALANCE", details: { usdcRequiredMicro: usdcRequired.toString(), usdcHeldMicro: usdcHeld.toString() } });
  await assertSolFor(owner, await solanaNeed([...quoted.map((q) => q.serializedBase64), ...(feeTx ? [feeTx.serializedBase64] : [])], owner));

  let group: typeof operationGroups.$inferSelect;
  try {
    group = await db.transaction(async (tx) => {
      const locked = await lockOperation(tx, op.id);
      if (locked.status !== "PLANNED" && locked.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${locked.status.toLowerCase()}.`);
      const now = Date.now();
      const quoteExpiresAt = new Date(now + 60_000);
      const ids = [...new Set([...quoted.map((q) => q.leg.id), ...charged.map((l) => l.id)])];
      const current = await tx.select().from(operationLegs).where(inArray(operationLegs.id, ids));
      if (current.length !== ids.length || current.some((l) => l.status !== "PLANNED" || l.groupId)) throw invalidTransition("This investment changed. Get new quotes.");

      // The fee leg: the plan's own (still PLANNED, in no group) when there is one, else a new one after the last leg.
      let feeLegId: string | null = null;
      if (feeTx) {
        const feeLeg = { amountIn: feeMicro.toString(), gasPayer: "user_solana" as const, builtMessageHash: feeTx.messageHash, quoteExpiresAt, updatedAt: sql`now()` as unknown as Date,
          routeSummary: { feeCharges: Object.fromEntries([...sums].map(([k, v]) => [k, v.toString()])), covers: charged.map((l) => l.id) } };
        const all = await tx.select().from(operationLegs).where(eq(operationLegs.operationId, op.id)).orderBy(asc(operationLegs.sequence));
        const plan = all.find((l) => l.kind === "network_fee" && l.status === "PLANNED" && !l.groupId);
        const expectedTx = { ...(plan?.expectedTx ?? {}), preparedBase64: feeTx.serializedBase64 };
        if (plan) await tx.update(operationLegs).set({ ...feeLeg, expectedTx }).where(eq(operationLegs.id, plan.id));
        feeLegId = plan?.id ?? (await tx.insert(operationLegs).values({
          ...feeLeg, operationId: op.id, sequence: Math.max(...all.map((l) => l.sequence)) + 1, kind: "network_fee", fromChain: "solana", toChain: "solana", expectedTx,
        }).returning({ id: operationLegs.id }))[0]!.id;
      }
      const [row] = await tx.insert(operationGroups).values({
        operationId: op.id, chain: body.chain, tier: body.tier, status: "QUOTED", feeLegId, quoteBlockHeight, expiresAt: quoteExpiresAt, sendBy: new Date(now + GROUP_SEND_WINDOW_MS),
        walletName: body.walletName ?? null, idempotencyKey: body.idempotencyKey,
      }).returning();
      if (feeLegId) await tx.update(operationLegs).set({ groupId: row!.id }).where(eq(operationLegs.id, feeLegId));
      for (const { leg, patch, response } of quoted) {
        const stored: Quoted = { estimatedOut: response.estimatedOut!, minOut: response.minOut!, plannedMinOut: leg.minOut };
        // The lowered floor (D-073 waived) is stored at the claim, not here: a group the user never signs must not hide "Accept new prices" from the next one.
        const { minOut: _lowered, ...rest } = patch;
        const rows = await tx.update(operationLegs).set({ ...rest, routeSummary: { ...patch.routeSummary, quoted: stored }, groupId: row!.id, quoteExpiresAt, updatedAt: sql`now()` })
          .where(and(eq(operationLegs.id, leg.id), eq(operationLegs.status, "PLANNED"), isNull(operationLegs.groupId))).returning({ id: operationLegs.id });
        if (rows.length !== 1) throw invalidTransition("This investment changed. Get new quotes.");
      }
      await tx.update(operations).set({ needsActionSince: null }).where(eq(operations.id, op.id));
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err, "operation_groups_one_open") || isUniqueViolation(err, "operation_groups_key")) throw inProgress();
    throw err;
  }
  const view = await groupView(group, errors, owner);
  logger.info("group.quoted", { walletName: group.walletName, chain: group.chain, tier: group.tier, legs: quoted.length, approvals: view.approvalsEstimate });
  return view;
}

/** The response for a stored group, rebuilt from its legs' stored transactions and quotes (the same for a fresh request and an idempotent repeat). */
async function groupView(group: typeof operationGroups.$inferSelect, errors: { legId: string; error: { code: string; message: string } }[], owner: string): Promise<GroupResponse> {
  const all = await db.select().from(operationLegs).where(eq(operationLegs.operationId, group.operationId)).orderBy(asc(operationLegs.sequence));
  const mine = all.filter((l) => l.groupId === group.id);
  const fee = mine.find((l) => l.kind === "network_fee");
  const assets = mine.filter((l) => l.kind !== "network_fee");
  const quotedOf = (l: Leg) => l.routeSummary!.quoted as Quoted;
  const transactions = [...(fee ? [{ legId: fee.id, kind: "fee" as const, serializedBase64: preparedOf(fee) }] : []), ...assets.map((l) => ({ legId: l.id, kind: "asset" as const, serializedBase64: preparedOf(l) }))];
  const remaining = all.filter((l) => l.kind !== "network_fee" && l.status === "PLANNED" && l.fromChain === "solana" && !l.recoveryOf).length;
  return {
    groupId: group.id, status: "quoted", expiresAt: group.expiresAt.toISOString(), sendBy: group.sendBy.toISOString(),
    priceMoved: assets.some((l) => quotedOf(l).plannedMinOut !== null && BigInt(quotedOf(l).minOut) < BigInt(quotedOf(l).plannedMinOut!)),
    approvalsEstimate: approvalsEstimate({ tier: group.tier, solanaLegs: remaining, charged: !!fee }),
    solRequiredLamports: ((await solanaNeed(transactions.map((x) => x.serializedBase64), owner)) + SOL_BUFFER_LAMPORTS).toString(),
    transactions,
    legs: [
      ...assets.map((l) => ({
        legId: l.id, estimatedOut: quotedOf(l).estimatedOut, minOut: quotedOf(l).minOut, plannedMinOut: quotedOf(l).plannedMinOut,
        routeFees: (l.routeSummary!.routeFees ?? []) as GroupResponse["legs"][number]["routeFees"], priceImpact: typeof l.routeSummary!.priceImpact === "number" ? l.routeSummary!.priceImpact : null, error: null,
      })),
      ...errors.map((e) => ({ legId: e.legId, estimatedOut: null, minOut: null, plannedMinOut: all.find((l) => l.id === e.legId)?.minOut ?? null, routeFees: [], priceImpact: null, error: e.error })),
    ],
  };
}

/**
 * Verifies every signed transaction of the group before anything changes, CLAIMS them all in one transaction (the group and each leg must still be exactly what
 * was verified), then sends: the fee first, waiting for it to confirm, then the buys in order, each gated by its own blockhash. A refused send stops the rest and
 * releases them unsent; an unknown outcome is never resent (the leg is SUBMITTED and tracked). The send loop runs in the request (D-018), never in a job.
 */
export async function submitGroup(ctx: OpCtx, opId: string, groupId: string, body: GroupSubmit): Promise<OperationView> {
  const [op] = await db.select().from(operations).where(and(eq(operations.id, opId), eq(operations.userId, ctx.userId)));
  if (!op) throw notFound();
  const [group] = await db.select().from(operationGroups).where(and(eq(operationGroups.id, groupId), eq(operationGroups.operationId, op.id)));
  if (!group) throw notFound();
  const legs = await db.select().from(operationLegs).where(eq(operationLegs.groupId, group.id)).orderBy(asc(operationLegs.sequence));
  const fee = legs.find((l) => l.kind === "network_fee") ?? null;
  const assets = legs.filter((l) => l.kind !== "network_fee");
  const owner = addressOn(await userAddresses(db, ctx.userId), "solana");

  if (group.status !== "QUOTED") throw invalidTransition(`This batch is ${group.status.toLowerCase()}.`);
  if (group.sendBy <= new Date()) {
    // The legs leave the expired group with it, or no later group could take them.
    await db.transaction(async (tx) => {
      await lockOperation(tx, op.id);
      const expired = await tx.update(operationGroups).set({ status: "EXPIRED", updatedAt: sql`now()` }).where(and(eq(operationGroups.id, group.id), eq(operationGroups.status, "QUOTED"))).returning({ id: operationGroups.id });
      if (expired.length) await tx.update(operationLegs).set({ groupId: null, updatedAt: sql`now()` }).where(and(eq(operationLegs.groupId, group.id), eq(operationLegs.status, "PLANNED")));
    });
    logger.info("group.expired", { tier: group.tier, walletName: group.walletName });
    throw createHttpError(409, "These quotes expired. Get new quotes.", { code: "GROUP_EXPIRED" });
  }
  // Exactly the group's legs, each once (mapped by legId: the wallet may return them in any order).
  const mismatch = () => createHttpError(409, "The signed batch doesn't match the prepared one.", { code: "TX_MISMATCH" });
  const byLeg = new Map(body.signed.map((s) => [s.legId, s.signedTx]));
  if (byLeg.size !== body.signed.length || byLeg.size !== legs.length || legs.some((l) => !byLeg.has(l.id))) throw mismatch();
  // Verify everything before claiming anything.
  const verified = new Map(legs.map((l) => {
    try {
      return [l.id, verifyUserSigned(byLeg.get(l.id)!, { owner, storedMessageHash: l.builtMessageHash!, preparedBase64: (l.expectedTx as { preparedBase64?: string } | null)?.preparedBase64 })] as const;
    } catch (err) {
      throw createHttpError.isHttpError(err) ? err : mismatch(); // bytes that are not a transaction at all
    }
  }));

  try {
    await db.transaction(async (tx) => {
      const locked = await lockOperation(tx, op.id);
      if (locked.status !== "PLANNED" && locked.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${locked.status.toLowerCase()}.`);
      const claimed = await tx.update(operationGroups).set({ status: "CLAIMED", updatedAt: sql`now()` }).where(and(eq(operationGroups.id, group.id), eq(operationGroups.status, "QUOTED"))).returning({ id: operationGroups.id });
      if (claimed.length !== 1) throw invalidTransition("This batch was already submitted.");
      for (const l of legs) {
        const v = verified.get(l.id)!;
        const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, l.id));
        if (current!.status !== "PLANNED" || current!.groupId !== group.id || current!.builtMessageHash !== l.builtMessageHash) throw invalidTransition("This batch changed. Get new quotes.");
        const fresh = (current!.routeSummary?.quoted as Quoted | undefined)?.minOut; // what the user signed against; below the plan's floor only when they accepted the new prices
        const lowered = fresh !== undefined && current!.minOut !== null && BigInt(fresh) < BigInt(current!.minOut);
        await setLegStatus(tx, ctx, current!, "SUBMITTING", { sourceTx: v.signature, submittedAt: sql`now()` as unknown as Date, ...(lowered ? { minOut: fresh } : {}), expectedTx: { ...(current!.expectedTx ?? {}), recentBlockhash: v.recentBlockhash, signedBase64: Buffer.from(v.raw).toString("base64") } });
      }
    });
  } catch (err) {
    if (isUniqueViolation(err, "operation_legs_source_tx")) throw invalidTransition("That transaction is already recorded for another leg.");
    throw err;
  }

  // Unsent legs go back to PLANNED with their bytes cleared (Continue re-quotes; old bytes are never reused).
  const release = async (ids: string[], reason: string, stoppedBy?: string) => {
    if (!ids.length) return;
    await db.transaction(async (tx) => {
      await lockOperation(tx, op.id);
      for (const id of ids) {
        const [current] = await tx.select().from(operationLegs).where(eq(operationLegs.id, id));
        if (current!.status !== "SUBMITTING") continue;
        const { preparedBase64: _p, signedBase64: _s, recentBlockhash: _r, ...rest } = (current!.expectedTx ?? {}) as Record<string, unknown>;
        await setLegStatus(tx, ctx, current!, "PLANNED", { sourceTx: null, submittedAt: null, builtMessageHash: null, quoteExpiresAt: null, groupId: null, expectedTx: rest, lastError: id === stoppedBy ? reason : reason === "QUOTE_STALE" ? "QUOTE_STALE" : "STOPPED" });
      }
      // Something was sent before the stop: the investment now waits for the user (nothing sent keeps a plain plan).
      await tx.update(operations).set({ needsActionSince: sql`coalesce(${operations.needsActionSince}, now())` }).where(and(eq(operations.id, op.id), eq(operations.status, "IN_PROGRESS")));
    });
    for (const _ of ids) logger.info("leg.released", { reason: reason === "QUOTE_STALE" ? "QUOTE_STALE" : "STOPPED" });
  };
  const refused = (err: unknown) => err instanceof SendTransactionError || (err as { code?: string }).code === "BROADCAST_REJECTED";
  const send = async (l: Leg): Promise<{ r: "sent" | "unknown" } | { r: "refused"; message: string }> => {
    try {
      await sendSolana(verified.get(l.id)!.raw);
      return { r: "sent" };
    } catch (err) {
      // unknown: the leg stays claimed and is tracked, never resent
      return refused(err) ? { r: "refused", message: (err instanceof Error ? err.message : "refused").slice(0, 300) } : { r: "unknown" };
    }
  };
  const done = async (l: Leg) => { await markSubmitted(ctx, op.id, l.id); await enqueue("track-leg", { legId: l.id }); };
  const finish = async () => {
    await db.update(operationGroups).set({ status: "SENT", updatedAt: sql`now()` }).where(eq(operationGroups.id, group.id));
    return getOperation(ctx, op.id);
  };

  if (fee) {
    const s = await send(fee);
    if (s.r === "refused") {
      await release(legs.map((l) => l.id), `FEE_REFUSED: ${s.message}`, fee.id);
      await db.update(operationGroups).set({ status: "RELEASED", updatedAt: sql`now()` }).where(eq(operationGroups.id, group.id));
      throw createHttpError(503, "The network rejected the fee transaction. Nothing was sent. Get new quotes.", { code: "ROUTE_UNAVAILABLE" });
    }
    await done(fee);
    const waitMs = Math.max(0, Math.min(30_000, group.sendBy.getTime() - Date.now()));
    if (!(s.r === "sent" && (await solanaConfirmed(verified.get(fee.id)!.signature, waitMs)))) {
      await release(assets.map((l) => l.id), "FEE_UNCONFIRMED");
      return finish();
    }
  }
  for (const [n, l] of assets.entries()) {
    if (!(await blockhashUsable(verified.get(l.id)!.recentBlockhash, group.quoteBlockHeight!).catch(() => false))) {
      await release(assets.slice(n).map((x) => x.id), "QUOTE_STALE");
      break;
    }
    const s = await send(l);
    if (s.r === "refused") {
      await release(assets.slice(n).map((x) => x.id), `PREFLIGHT_REFUSED: ${s.message}`, l.id);
      break;
    }
    await done(l);
  }
  return finish();
}

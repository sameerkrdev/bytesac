import createHttpError from "http-errors";
import { SendTransactionError, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { and, asc, eq, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import { db, isUniqueViolation, operationFees, operationGroups, operationLegs, operations, type Tx } from "@repo/db";
import { GROUP_SEND_WINDOW_MS, K_SIGN_ALL, K_SIGN_AND_SEND, SOL_BUFFER_LAMPORTS, USDC_SOLANA_MINT, approvalsEstimate, type GroupRequest, type GroupResponse, type GroupSent, type GroupSubmit, type OperationView } from "@repo/validator";
import { logger } from "@repo/logger";
import { enqueue } from "@/config/queues";
import { writeAudit } from "@/modules/audit/audit.service";
import { blockhashUsable, buildFeeTransfer, connection, landedMatchesPrepared, sendSolana, solanaBalance, solanaNeed, solanaConfirmed, verifyUserSigned } from "@/providers/solana-tx";
import { addressOn, userAddresses } from "@/modules/auth/wallets.service";
import { type Leg, type OpCtx, auditBase, freeUsdcMicro, getOperation, invalidTransition, lockOperation, notFound, setLegStatus, userLamports } from "./operations.service";
import { assertSolFor } from "./plan.service";
import { assertLegAllowed, assertOperable, quoteAssetLeg } from "./quote.service";
import { markSubmitted } from "./submit.service";

const IN_FLIGHT = ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN", "UNKNOWN"] as const;
/** `fee_confirming`: the previous fee transaction is on its way and not confirmed yet; the web retries (spec 22 B-26). */
const inProgress = (reason?: "fee_confirming") => createHttpError(409, "A transaction of this investment is still being confirmed. Wait for it to finish.", { code: "OPERATION_IN_PROGRESS", ...(reason ? { details: { reason } } : {}) });
const groupExpired = () => createHttpError(409, "These quotes expired. Get new quotes.", { code: "GROUP_EXPIRED" });
/** The group's send window ended: it is EXPIRED and its legs leave it, or no later group could take them. Under the operation lock. */
async function expireGroup(tx: Tx, groupId: string, tier: string, walletName: string | null): Promise<void> {
  const expired = await tx.update(operationGroups).set({ status: "EXPIRED", updatedAt: sql`now()` }).where(and(eq(operationGroups.id, groupId), eq(operationGroups.status, "QUOTED"))).returning({ id: operationGroups.id });
  if (expired.length) await tx.update(operationLegs).set({ groupId: null, updatedAt: sql`now()` }).where(and(eq(operationLegs.groupId, groupId), eq(operationLegs.status, "PLANNED")));
  logger.info("group.expired", { tier, walletName });
}
const hasShare = (l: Pick<Leg, "feeShare">) => Object.values(l.feeShare ?? {}).some((v) => BigInt(v) > 0n);
const preparedOf = (l: Pick<Leg, "expectedTx">) => (l.expectedTx as { preparedBase64: string }).preparedBase64;
/** What a leg's fresh group quote stored in its route summary (see `requestGroup`), for the response and its idempotent replay. */
type Quoted = { estimatedOut: string; minOut: string; plannedMinOut: string | null };
/** The floor a leg had before its group was claimed: a released leg goes back to it, so the next group still asks before signing below it (D-073 waived). */
const plannedFloor = (l: Leg) => (l.routeSummary?.quoted as Quoted | undefined)?.plannedMinOut ?? l.minOut;

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

  // B-26: the next group waits for the previous fee transaction to be confirmed on chain, not settled. Read before the lock; a fee that is not in this map blocks without a reason.
  const feeLegs = await db.select({ id: operationLegs.id, sourceTx: operationLegs.sourceTx, status: operationLegs.status, expectedTx: operationLegs.expectedTx, tier: operationGroups.tier }).from(operationLegs)
    .leftJoin(operationGroups, eq(operationGroups.id, operationLegs.groupId)).where(and(eq(operationLegs.operationId, opId), eq(operationLegs.kind, "network_fee"), inArray(operationLegs.status, ["SUBMITTED", "PENDING_CHAIN"]), isNotNull(operationLegs.sourceTx)));
  const statuses = feeLegs.length ? (await connection.getSignatureStatuses(feeLegs.map((l) => l.sourceTx!), { searchTransactionHistory: true }).catch(() => null))?.value ?? [] : [];
  const feeState = new Map<string, "confirmed" | "failed" | "pending" | "mismatch">(feeLegs.map((l, n) => [l.id, statuses[n]?.err ? "failed" : statuses[n]?.confirmationStatus === "confirmed" || statuses[n]?.confirmationStatus === "finalized" ? "confirmed" : "pending"]));
  // A signature the wallet reported (sign-and-send) unlocks the next group only once it is proven to be our prepared transaction; the tracker proves it for PENDING_CHAIN.
  await Promise.all(feeLegs.filter((l) => l.tier === "sign_and_send" && l.status === "SUBMITTED" && feeState.get(l.id) === "confirmed").map(async (l) => {
    const matches = await landedMatchesPrepared(l.sourceTx!, (l.expectedTx as { preparedBase64?: string } | null)?.preparedBase64 ?? "", owner).catch(() => null);
    feeState.set(l.id, matches === null ? "pending" : matches ? "confirmed" : "mismatch");
  }));

  const prep = await db.transaction(async (tx) => {
    const op = await lockOperation(tx, opId);
    if (op.status !== "PLANNED" && op.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${op.status.toLowerCase()}.`);
    const groups = await tx.select().from(operationGroups).where(eq(operationGroups.operationId, opId));
    const same = groups.find((g) => g.idempotencyKey === body.idempotencyKey);
    if (same) return { replay: same, op, take: [] as Leg[], feeOnly: null, covering: new Set<string>() };
    const legs = await tx.select().from(operationLegs).where(eq(operationLegs.operationId, opId)).orderBy(asc(operationLegs.sequence));
    if (!groups.length && legs.some((l) => l.status !== "PLANNED")) throw invalidTransition("This investment is being signed one transaction at a time.");
    const blocking = legs.filter((l) => l.kind === "network_fee" && (IN_FLIGHT as readonly string[]).includes(l.status) && feeState.get(l.id) !== "confirmed");
    if (blocking.some((l) => feeState.get(l.id) === "mismatch")) throw createHttpError(409, "The reported fee transaction is not the prepared one.", { code: "TX_MISMATCH" });
    if (blocking.length) throw inProgress(blocking.every((l) => feeState.get(l.id) === "pending") ? "fee_confirming" : undefined);
    // A claimed group whose legs are all past the claim (a send that ended) no longer holds the chain's one open slot.
    await tx.update(operationGroups).set({ status: "SENT", updatedAt: sql`now()` })
      .where(and(eq(operationGroups.operationId, opId), eq(operationGroups.status, "CLAIMED"), notExists(db.select().from(operationLegs).where(and(eq(operationLegs.groupId, operationGroups.id), eq(operationLegs.status, "SUBMITTING"))))));
    const expired = await tx.update(operationGroups).set({ status: "EXPIRED", updatedAt: sql`now()` }).where(and(eq(operationGroups.operationId, opId), eq(operationGroups.chain, body.chain), eq(operationGroups.status, "QUOTED"))).returning({ id: operationGroups.id });
    if (expired.length) await tx.update(operationLegs).set({ groupId: null, updatedAt: sql`now()` }).where(and(inArray(operationLegs.groupId, expired.map((g) => g.id)), eq(operationLegs.status, "PLANNED")));
    const candidates = legs.filter((l) => l.kind !== "network_fee" && l.status === "PLANNED" && l.fromChain === "solana" && !l.recoveryOf);
    if (!candidates.length) throw invalidTransition("Nothing is left to sign.");
    if (candidates.some((l) => l.gasPayer === "platform_fee_payer")) throw invalidTransition("This plan was made before user-paid gas. Plan again.");
    // A leg is covered once a fee that lists it is on its way (not PLANNED, not FAILED); waiting for SETTLED would charge it twice now that groups proceed at `confirmed`.
    const covering = new Set(legs.filter((l) => l.kind === "network_fee" && l.status !== "PLANNED" && l.status !== "FAILED").flatMap((l) => ((l.routeSummary?.covers ?? []) as string[])));
    const isUncovered = (l: Leg) => !l.feeCoveredBy && !covering.has(l.id) && hasShare(l);
    const uncovered = candidates.filter(isUncovered);
    // `single`: the fee transaction alone first (it charges every uncovered leg), then one leg per group. `sign_and_send`: the fee alone first for the next K legs, then those legs
    // with no fee (the wallet signs and sends the fee as its own approval, B-27). `sign_all`: a chunk plus its fee.
    const window = body.tier === "sign_and_send" ? candidates.slice(0, K_SIGN_AND_SEND) : candidates;
    const feeFor = body.tier === "single" ? uncovered : body.tier === "sign_and_send" ? window.filter(isUncovered) : [];
    const take = feeFor.length ? [] : window.slice(0, body.tier === "single" ? 1 : body.tier === "sign_and_send" ? K_SIGN_AND_SEND : K_SIGN_ALL - (uncovered.length ? 1 : 0));
    return { replay: null, op, take, feeOnly: feeFor.length ? feeFor : null, covering };
  });
  if (prep.replay) {
    if (prep.replay.status !== "QUOTED") throw invalidTransition(`This batch is ${prep.replay.status.toLowerCase()}.`);
    return groupView(prep.replay, [], owner);
  }
  const { op, take, feeOnly, covering } = prep;

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
  const charged = (feeOnly ?? quoted.map((q) => q.leg)).filter((l) => !l.feeCoveredBy && !covering.has(l.id));
  const sums = new Map<string, bigint>();
  for (const leg of charged) for (const [kind, v] of Object.entries(leg.feeShare ?? {})) sums.set(kind, (sums.get(kind) ?? 0n) + BigInt(v));
  const rows = await db.select({ kind: operationFees.kind, recipient: operationFees.recipientAddress }).from(operationFees).where(eq(operationFees.operationId, op.id))
    .orderBy(sql`array_position(array['network','manager_entry','manager_rebalance','platform']::text[], ${operationFees.kind}::text)`);
  const transfers = rows.flatMap((r) => (sums.get(r.kind) && r.recipient ? [{ recipient: r.recipient, amountMicro: sums.get(r.kind)! }] : []));
  const feeMicro = [...sums.values()].reduce((t, v) => t + v, 0n);
  if (transfers.reduce((t, x) => t + x.amountMicro, 0n) !== feeMicro) throw createHttpError(503, "This route is unavailable. Plan again.", { code: "ROUTE_UNAVAILABLE" });
  const feeTx = feeMicro > 0n ? await buildFeeTransfer({ owner, payer: "user", transfers }) : null;

  // A fee-only group also needs the buys it pays for to be fundable: its fee is not refunded (D-090), so it is never charged for buys the wallet cannot make.
  const funded = feeOnly ?? quoted.map((q) => q.leg);
  const usdcRequired = feeMicro + funded.reduce((t, l) => t + BigInt(l.amountIn), 0n);
  const usdcHeld = await freeUsdcMicro(db, ctx.userId, await solanaBalance(owner, USDC_SOLANA_MINT));
  if (usdcHeld < usdcRequired) throw createHttpError(409, "Your Solana wallet doesn't hold enough USDC.", { code: "INSUFFICIENT_BALANCE", details: { usdcRequiredMicro: usdcRequired.toString(), usdcHeldMicro: usdcHeld.toString() } });
  await assertSolFor(owner, (await solanaNeed([...quoted.map((q) => q.serializedBase64), ...(feeTx ? [feeTx.serializedBase64] : [])], owner)) + (feeOnly ?? []).reduce((t, l) => t + userLamports(l), 0n));

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
    await db.transaction(async (tx) => {
      await lockOperation(tx, op.id);
      await expireGroup(tx, group.id, group.tier, group.walletName);
    });
    throw groupExpired();
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
        await setLegStatus(tx, ctx, current!, "PLANNED", {
          sourceTx: null, submittedAt: null, builtMessageHash: null, quoteExpiresAt: null, groupId: null, expectedTx: rest, minOut: plannedFloor(current!),
          lastError: id === stoppedBy ? reason : reason === "QUOTE_STALE" ? "QUOTE_STALE" : "STOPPED",
        });
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
    if (!(s.r === "sent" && (await solanaConfirmed(verified.get(fee.id)!.signature, waitMs, verified.get(fee.id)!.raw)))) {
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

/** A signature as the wallet returns it: base58 of exactly 64 bytes. */
const isSignature = (value: string): boolean => {
  try {
    return bs58.decode(value).length === 64;
  } catch {
    return false;
  }
};

/**
 * Sign-and-send step 1 (spec 22 section 6.4, B-27): CLAIMS the group's legs before the wallet signs and sends anything (claim before send): each goes PLANNED to
 * SUBMITTING with no signature, the group to CLAIMED. A claim after `sendBy` expires the group. Under the operation lock, so of two concurrent claims one wins.
 */
export async function claimGroup(ctx: OpCtx, opId: string, groupId: string): Promise<OperationView> {
  const [op] = await db.select().from(operations).where(and(eq(operations.id, opId), eq(operations.userId, ctx.userId)));
  if (!op) throw notFound();
  const expired = await db.transaction(async (tx) => {
    const locked = await lockOperation(tx, op.id);
    if (locked.status !== "PLANNED" && locked.status !== "IN_PROGRESS") throw invalidTransition(`This operation is ${locked.status.toLowerCase()}.`);
    const [group] = await tx.select().from(operationGroups).where(and(eq(operationGroups.id, groupId), eq(operationGroups.operationId, op.id)));
    if (!group) throw notFound();
    if (group.tier !== "sign_and_send" || group.status !== "QUOTED") throw invalidTransition(`This batch is ${group.tier === "sign_and_send" ? group.status.toLowerCase() : "not sign-and-send"}.`);
    if (group.sendBy <= new Date()) {
      await expireGroup(tx, group.id, group.tier, group.walletName);
      return true;
    }
    const legs = await tx.select().from(operationLegs).where(eq(operationLegs.groupId, group.id)).orderBy(asc(operationLegs.sequence));
    if (!legs.length || legs.some((l) => l.status !== "PLANNED" || !l.builtMessageHash)) throw invalidTransition("This batch changed. Get new quotes.");
    await tx.update(operationGroups).set({ status: "CLAIMED", updatedAt: sql`now()` }).where(eq(operationGroups.id, group.id));
    for (const l of legs) {
      const fresh = (l.routeSummary?.quoted as Quoted | undefined)?.minOut; // what the user is about to sign against; below the plan's floor only when they accepted the new prices
      const lowered = fresh !== undefined && l.minOut !== null && BigInt(fresh) < BigInt(l.minOut);
      await setLegStatus(tx, ctx, l, "SUBMITTING", { sourceTx: null, submittedAt: sql`now()` as unknown as Date, ...(lowered ? { minOut: fresh } : {}) });
    }
    await tx.update(operations).set({ needsActionSince: null }).where(eq(operations.id, op.id));
    return false;
  });
  if (expired) throw groupExpired();
  return getOperation(ctx, op.id);
}

/**
 * Sign-and-send step 2: records the signatures the wallet returned. Each must belong to a claimed leg of this group that has none yet, appear once, and decode
 * to 64 bytes; otherwise nothing is recorded. A subset is allowed: the legs left without a signature stay claimed for the sweep (never released here, the wallet
 * may have sent them). The group is SENT once every leg has its signature. The recorded legs are then SUBMITTED and tracked from chain evidence.
 */
export async function sentGroup(ctx: OpCtx, opId: string, groupId: string, body: GroupSent): Promise<OperationView> {
  const [op] = await db.select().from(operations).where(and(eq(operations.id, opId), eq(operations.userId, ctx.userId)));
  if (!op) throw notFound();
  if (body.signatures.some((s) => !isSignature(s.signature))) throw createHttpError(400, "A signature is not valid.", { code: "VALIDATION_FAILED" });
  // A signature for a claim the sweep already marked NOT_LANDED is refused below, but it may have landed after all: kept for ops (audit, never the log).
  const late = await db.select({ id: operationLegs.id }).from(operationLegs)
    .where(and(eq(operationLegs.operationId, op.id), eq(operationLegs.groupId, groupId), inArray(operationLegs.id, body.signatures.map((s) => s.legId)), eq(operationLegs.status, "FAILED"), eq(operationLegs.failureReason, "NOT_LANDED")));
  if (late.length) {
    logger.error("a wallet reported a signature for a claim the sweep marked NOT_LANDED", { operationId: op.id, legIds: late.map((l) => l.id) });
    await db.transaction(async (tx) => {
      for (const l of late) await writeAudit(tx, { ...auditBase(ctx, l.id), action: "leg.signature_after_not_landed", entityType: "operation_leg", entityId: l.id, metadata: { operationId: op.id, signature: body.signatures.find((s) => s.legId === l.id)!.signature } });
    });
  }
  try {
    await db.transaction(async (tx) => {
      await lockOperation(tx, op.id);
      const [group] = await tx.select().from(operationGroups).where(and(eq(operationGroups.id, groupId), eq(operationGroups.operationId, op.id)));
      if (!group) throw notFound();
      if (group.tier !== "sign_and_send" || group.status !== "CLAIMED") throw invalidTransition(`This batch is ${group.status.toLowerCase()}.`);
      const legs = await tx.select().from(operationLegs).where(eq(operationLegs.groupId, group.id));
      const open = new Map(legs.filter((l) => l.status === "SUBMITTING" && !l.sourceTx).map((l) => [l.id, l]));
      const { signatures } = body;
      if (new Set(signatures.map((s) => s.legId)).size !== signatures.length || new Set(signatures.map((s) => s.signature)).size !== signatures.length || signatures.some((s) => !open.has(s.legId))) {
        throw createHttpError(409, "The signatures don't match the claimed batch.", { code: "TX_MISMATCH" });
      }
      for (const s of signatures) {
        const leg = open.get(s.legId)!;
        // The proof accepts only the prepared blockhash, so a signature that never lands fails once it expires (and the wallet's own grace passed, see `trackOnce`).
        const recentBlockhash = VersionedTransaction.deserialize(Buffer.from(preparedOf(leg), "base64")).message.recentBlockhash;
        await tx.update(operationLegs).set({ sourceTx: s.signature, expectedTx: { ...(leg.expectedTx ?? {}), recentBlockhash, walletSentAt: new Date().toISOString() }, updatedAt: sql`now()` })
          .where(and(eq(operationLegs.id, s.legId), eq(operationLegs.status, "SUBMITTING"), isNull(operationLegs.sourceTx)));
      }
      if (signatures.length === open.size) await tx.update(operationGroups).set({ status: "SENT", updatedAt: sql`now()` }).where(eq(operationGroups.id, group.id));
    });
  } catch (err) {
    if (isUniqueViolation(err, "operation_legs_source_tx")) throw invalidTransition("That transaction is already recorded for another leg.");
    throw err;
  }
  for (const s of body.signatures) {
    await markSubmitted(ctx, op.id, s.legId);
    await enqueue("track-leg", { legId: s.legId });
  }
  return getOperation(ctx, op.id);
}

/**
 * Sign-and-send: the wallet clearly refused (the user rejected the popup). Legs claimed without a signature go back to PLANNED with their bytes cleared; legs that
 * have a signature are never touched. A group that is not CLAIMED has nothing to release (a repeat answers the same view).
 */
export async function releaseGroup(ctx: OpCtx, opId: string, groupId: string): Promise<OperationView> {
  const [op] = await db.select().from(operations).where(and(eq(operations.id, opId), eq(operations.userId, ctx.userId)));
  if (!op) throw notFound();
  await db.transaction(async (tx) => {
    await lockOperation(tx, op.id);
    const [group] = await tx.select().from(operationGroups).where(and(eq(operationGroups.id, groupId), eq(operationGroups.operationId, op.id)));
    if (!group) throw notFound();
    if (group.status !== "CLAIMED") return;
    const legs = await tx.select().from(operationLegs).where(eq(operationLegs.groupId, group.id));
    for (const l of legs.filter((x) => x.status === "SUBMITTING" && !x.sourceTx)) {
      const { preparedBase64: _p, signedBase64: _s, recentBlockhash: _r, ...rest } = (l.expectedTx ?? {}) as Record<string, unknown>;
      await setLegStatus(tx, ctx, l, "PLANNED", { submittedAt: null, builtMessageHash: null, quoteExpiresAt: null, groupId: null, expectedTx: rest, minOut: plannedFloor(l), lastError: "WALLET_REJECTED" });
    }
    await tx.update(operationGroups).set({ status: legs.some((l) => l.sourceTx) ? "SENT" : "RELEASED", updatedAt: sql`now()` }).where(eq(operationGroups.id, group.id));
  });
  return getOperation(ctx, op.id);
}

import createHttpError from "http-errors";
import { eq, sql } from "drizzle-orm";
import { db, isUniqueViolation, operationLegs } from "@repo/db";
import type { LegSubmit, OperationView } from "@repo/validator";
import { broadcastBitcoin, checkPsbt, finalizePsbt, type PsbtInput, type PsbtOutput } from "@/providers/bitcoin";
import { evmTransaction } from "@/providers/evm-rpc";
import { SendTransactionError } from "@solana/web3.js";
import { cosign, sendSolana } from "@/providers/solana-tx";
import { enqueue } from "@/config/queues";
import { type OpCtx, invalidTransition, getOperation, setLegStatus, setOperationStatus, lockOperation } from "./operations.service";
import { userAddresses, addressOn } from "@/modules/auth/wallets.service";
import { loadLeg, assertOperable, sha256Hex } from "./quote.service";

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
    const preparedBase64 = (leg.expectedTx as { preparedBase64?: string } | null)?.preparedBase64;
    const signed = cosign(body.signedTx, leg.builtMessageHash, preparedBase64);
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

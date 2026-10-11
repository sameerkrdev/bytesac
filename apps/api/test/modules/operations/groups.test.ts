import { randomUUID } from "node:crypto";
import createHttpError from "http-errors";
import { ComputeBudgetProgram, PublicKey, SendTransactionError, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@repo/logger";
import { lifi } from "@/providers/routes/lifi";
import * as solanaTx from "@/providers/solana-tx";
import { connection } from "@/providers/solana-tx";
import { trackLeg } from "@/modules/portfolio/tracking.service";
import { adminSql, resetDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { balanceKey, mockChains } from "../../helpers/chain-mocks";
import { USDC_MINT } from "../../helpers/execution";
import { addRecovery, arrange, groupReq, groupRows, legs, opRow, post, quoted, sentSignatures, sends, signAll, submit, walletSign, type Tx, type Wallet } from "../../helpers/groups";

/** The logger's `info(message, meta)` calls (winston types the first overload as an object). */
const spyInfo = () => vi.spyOn(logger, "info") as unknown as { mock: { calls: [string, Record<string, unknown>][] } };

/** What a wallet does to a transaction: decompile it, change the instructions (or the payer) and sign the result. */
const rewrite = (serializedBase64: string, wallet: Wallet, change: (ix: TransactionMessage["instructions"]) => TransactionMessage["instructions"], payer?: PublicKey) => {
  const message = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64")).message;
  const decompiled = TransactionMessage.decompile(message);
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer ?? decompiled.payerKey, recentBlockhash: decompiled.recentBlockhash, instructions: change(decompiled.instructions) }).compileToV0Message());
  if (!payer) tx.sign([wallet.keypair]);
  return Buffer.from(tx.serialize()).toString("base64");
};

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("request a group", () => {
  it("builds the fee first plus one transaction per leg, all with the user as fee payer, and records the fee charges", async () => {
    const { user, op, group } = await quoted();
    expect(group.transactions.map((t) => t.kind)).toEqual(["fee", "asset", "asset", "asset", "asset"]);
    for (const t of group.transactions) expect(VersionedTransaction.deserialize(Buffer.from(t.serializedBase64, "base64")).message.staticAccountKeys[0]!.toBase58()).toBe(user.solanaAddress);
    expect(Math.abs(Date.parse(group.sendBy) - Date.now() - 40_000)).toBeLessThan(5_000);
    expect(group.approvalsEstimate).toBe(1);
    expect(group.priceMoved).toBe(false);
    const rows = await legs(op.id);
    const fee = rows.find((l) => l.kind === "network_fee")!;
    const buys = rows.filter((l) => l.kind !== "network_fee");
    expect(fee.id).toBe(op.legs[0].id); // the plan's own fee leg is reused
    expect(fee.group_id).toBe(group.groupId);
    expect(fee.route_summary!.feeCharges).toEqual({ manager_entry: buys.reduce((t, l) => t + BigInt(l.fee_share!.manager_entry!), 0n).toString() });
    expect(fee.amount_in).toBe(fee.route_summary!.feeCharges!.manager_entry);
    expect(fee.route_summary!.covers).toEqual(buys.map((l) => l.id));
    expect(buys.every((l) => l.group_id === group.groupId && l.status === "PLANNED" && l.built_message_hash)).toBe(true);
    expect(await groupRows(op.id)).toMatchObject([{ status: "QUOTED", fee_leg_id: fee.id, wallet_name: "TestWallet", tier: "sign_all", quote_block_height: "1000" }]);
  });

  it("chunks a 14-leg basket: 11 legs plus the fee, then the rest once the fee settled; the fee charges add up to the plan's fee", async () => {
    const { user, wallet, chain, op } = await arrange({ legs: 14 });
    const first = (await groupReq(user.h, op.id)).body;
    expect(first.transactions).toHaveLength(12);
    const planFee = op.legs[0].amountIn;
    const feeSig = (await submit(user.h, op.id, first.groupId, signAll(first.transactions, wallet))).body.legs.find((l: { kind: string }) => l.kind === "network_fee").sourceTx;
    chain.solanaFinality.set(feeSig, "finalized");
    vi.spyOn(connection, "getParsedTransaction").mockResolvedValue({ blockTime: 1_800_000_000 } as never);
    await trackLeg(first.transactions[0].legId);
    const second = (await groupReq(user.h, op.id, { idempotencyKey: "grp-bbbbbbbb" })).body;
    expect(second.transactions.map((t: Tx) => t.kind)).toEqual(["fee", "asset", "asset", "asset"]);
    const rows = await legs(op.id);
    const feeLegs = rows.filter((l) => l.kind === "network_fee");
    expect(feeLegs).toHaveLength(2);
    expect(new Set(feeLegs[0]!.route_summary!.covers).size).toBe(11);
    expect(new Set(feeLegs[1]!.route_summary!.covers).size).toBe(3);
    expect(feeLegs.reduce((t, l) => t + BigInt(l.amount_in), 0n).toString()).toBe(planFee);
    expect(rows.filter((l) => l.kind !== "network_fee" && l.fee_covered_by === feeLegs[0]!.id)).toHaveLength(11);
  });

  it("charges no fee for legs whose fee is already covered (a retry)", async () => {
    const { user, op } = await arrange();
    await adminSql`UPDATE app.operation_legs SET fee_covered_by = ${op.legs[0].id} WHERE operation_id = ${op.id} AND kind <> 'network_fee'`;
    const res = await groupReq(user.h, op.id);
    expect(res.status).toBe(200);
    expect(res.body.transactions.map((t: Tx) => t.kind)).toEqual(["asset", "asset", "asset", "asset"]);
    expect((await groupRows(op.id))[0]!.fee_leg_id).toBeNull();
    expect((await legs(op.id)).find((l) => l.kind === "network_fee")!.group_id).toBeNull();
  });

  it("leaves a leg whose quote fails out of the group and the fee; with every quote failing it answers that error and creates no group (Review Focus 5)", async () => {
    const { user, basket, op } = await arrange();
    const original = vi.mocked(lifi.quote).getMockImplementation()!;
    const bad = basket.deployments[1]!.address;
    vi.mocked(lifi.quote).mockImplementation(async (i) => {
      if (i.toToken === bad) throw createHttpError(503, "gone", { code: "ROUTE_UNAVAILABLE" });
      return original(i);
    });
    const res = await groupReq(user.h, op.id);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(4);
    const failed = res.body.legs.filter((l: { error: unknown }) => l.error);
    expect(failed).toHaveLength(1);
    expect(failed[0].error.code).toBe("ROUTE_UNAVAILABLE");
    const rows = await legs(op.id);
    const excluded = rows.find((l) => l.id === failed[0].legId)!;
    expect(excluded).toMatchObject({ status: "PLANNED", group_id: null });
    const fee = rows.find((l) => l.kind === "network_fee")!;
    expect(fee.amount_in).toBe(rows.filter((l) => l.kind !== "network_fee" && l.id !== excluded.id).reduce((t, l) => t + BigInt(l.fee_share!.manager_entry!), 0n).toString());
    expect(fee.route_summary!.covers).not.toContain(excluded.id);

    await resetDb();
    const fresh = await arrange();
    vi.mocked(lifi.quote).mockImplementation(async () => { throw createHttpError(503, "gone", { code: "ROUTE_UNAVAILABLE" }); });
    const none = await groupReq(fresh.user.h, fresh.op.id);
    expect(none.status).toBe(503);
    expect(none.body.error.code).toBe("ROUTE_UNAVAILABLE");
    expect(await groupRows(fresh.op.id)).toHaveLength(0);
  });

  it("rechecks the SOL requirement and answers SOL_REQUIRED without creating a group", async () => {
    const { user, chain, op } = await arrange();
    chain.balances.set(balanceKey(user.solanaAddress, null), 1_000n);
    const res = await groupReq(user.h, op.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SOL_REQUIRED");
    expect(res.body.error.details).toMatchObject({ lamportsHeld: "1000" });
    expect(await groupRows(op.id)).toHaveLength(0);
  });

  it("refuses when the USDC no longer covers the legs and the fee", async () => {
    const { user, chain, op } = await arrange();
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 100_000_000n);
    const res = await groupReq(user.h, op.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE");
    expect(res.body.error.details).toEqual({ usdcRequiredMicro: "500000000", usdcHeldMicro: "100000000" });
  });

  it("is idempotent per key; a new key expires the open group and quotes again", async () => {
    const { user, chain, op, group } = await quoted();
    const quotesBefore = chain.quotes.length;
    const again = await groupReq(user.h, op.id);
    expect(again.body).toEqual(group);
    expect(chain.quotes).toHaveLength(quotesBefore);
    const next = await groupReq(user.h, op.id, { idempotencyKey: "grp-bbbbbbbb" });
    expect(next.status).toBe(200);
    expect(next.body.groupId).not.toBe(group.groupId);
    expect((await groupRows(op.id)).map((g) => g.status)).toEqual(["EXPIRED", "QUOTED"]);
    expect((await legs(op.id)).every((l) => l.group_id === next.body.groupId)).toBe(true);
  });

  it("is refused once the per-leg path was used, and per-leg quotes are refused once a group exists", async () => {
    const perLeg = await arrange();
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${perLeg.op.legs[0].id}`;
    const refused = await groupReq(perLeg.user.h, perLeg.op.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("INVALID_TRANSITION");

    await resetDb();
    const { user, op, group } = await quoted();
    const q = await post(user.h, `/v1/operations/${op.id}/legs/${group.transactions[1]!.legId}/quote`);
    expect(q.status).toBe(409);
    expect(q.body.error.code).toBe("INVALID_TRANSITION");
  });

  it("counts each leg of a group against the quote rate limit: 60 per minute is 5 groups of 12", async () => {
    const { user, op } = await arrange();
    for (let n = 0; n < 5; n += 1) expect((await groupReq(user.h, op.id)).status).toBe(200);
    const limited = await groupReq(user.h, op.id);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("logs the batch with the wallet name and tier and no address (telemetry)", async () => {
    const info = spyInfo();
    const { user } = await quoted();
    const line = info.mock.calls.find(([message]) => message === "group.quoted")!;
    expect(line[1]).toMatchObject({ walletName: "TestWallet", chain: "solana", tier: "sign_all", legs: 4, approvals: 1 });
    expect(JSON.stringify(line)).not.toContain(user.solanaAddress);
  });

  it("cancel releases a quoted group: a plan is cancelled, a running investment stops", async () => {
    const a = await quoted();
    expect((await post(a.user.h, `/v1/operations/${a.op.id}/cancel`)).body.status).toBe("CANCELLED");
    expect((await groupRows(a.op.id))[0]!.status).toBe("RELEASED");
    expect((await legs(a.op.id)).every((l) => l.group_id === null)).toBe(true);

    await resetDb();
    const b = await quoted();
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${b.op.id}`;
    expect((await post(b.user.h, `/v1/operations/${b.op.id}/cancel`)).body.status).toBe("FAILED");
    expect((await groupRows(b.op.id))[0]!.status).toBe("RELEASED");
  });
});

describe("the plan's minimum amounts (D-073 waived: the user accepts new prices)", () => {
  it("a group left unsigned does not lower the plan's floor: the next group for the same quote is still priceMoved (review I4); signing lowers it", async () => {
    const { user, wallet, chain, op } = await arrange();
    const plannedMin = (await legs(op.id)).filter((l) => l.kind !== "network_fee").map((l) => l.min_out);
    chain.quoteOut = { numerator: 99n, denominator: 100n };
    const first = (await groupReq(user.h, op.id)).body;
    expect(first.priceMoved).toBe(true);
    expect((await legs(op.id)).filter((l) => l.kind !== "network_fee").map((l) => l.min_out)).toEqual(plannedMin); // quoting alone changes no floor
    const second = (await groupReq(user.h, op.id, { idempotencyKey: "grp-bbbbbbbb" })).body;
    expect(second.priceMoved).toBe(true);
    expect(second.legs.map((l: { plannedMinOut: string }) => l.plannedMinOut)).toEqual(plannedMin);
    expect((await submit(user.h, op.id, second.groupId, signAll(second.transactions, wallet))).status).toBe(200);
    const signed = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(signed.map((l) => l.min_out)).toEqual(second.legs.map((l: { minOut: string }) => l.minOut));
    expect(signed.every((l, n) => BigInt(l.min_out!) < BigInt(plannedMin[n]!))).toBe(true);
  });
});

describe("tier single (one popup per transaction)", () => {
  it("forms a fee-only group charging every leg first, then one asset leg per group with no fee (review I5)", async () => {
    const { user, wallet, chain, op } = await arrange();
    const first = await groupReq(user.h, op.id, { tier: "single" });
    expect(first.status).toBe(200);
    expect(first.body.transactions.map((t: Tx) => t.kind)).toEqual(["fee"]);
    expect(first.body.legs).toEqual([]);
    expect(first.body.approvalsEstimate).toBe(5); // four legs and the fee
    const rows = await legs(op.id);
    expect(new Set(rows.find((l) => l.kind === "network_fee")!.route_summary!.covers)).toEqual(new Set(rows.filter((l) => l.kind !== "network_fee").map((l) => l.id)));
    expect(rows.find((l) => l.kind === "network_fee")!.amount_in).toBe(op.legs[0].amountIn);
    const feeSig = (await submit(user.h, op.id, first.body.groupId, signAll(first.body.transactions, wallet))).body.legs.find((l: { kind: string }) => l.kind === "network_fee").sourceTx;
    chain.solanaFinality.set(feeSig, "finalized");
    vi.spyOn(connection, "getParsedTransaction").mockResolvedValue({ blockTime: 1_800_000_000 } as never);
    await trackLeg(first.body.transactions[0].legId);
    const second = (await groupReq(user.h, op.id, { tier: "single", idempotencyKey: "grp-bbbbbbbb" })).body;
    expect(second.transactions.map((t: Tx) => t.kind)).toEqual(["asset"]);
    expect(second.approvalsEstimate).toBe(4);
    expect((await groupRows(op.id)).map((g) => g.fee_leg_id === null)).toEqual([false, true]);
  });

  it("refuses a plan made before user-paid gas (platform fee payer legs) rather than quoting transactions that cannot be verified", async () => {
    const { user, op } = await arrange();
    await adminSql`UPDATE app.operation_legs SET gas_payer = 'platform_fee_payer' WHERE id = ${op.legs[1].id}`;
    const res = await groupReq(user.h, op.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("recovery on a grouped investment (review I7)", () => {
  it("a recovery leg is quoted and submitted per leg while other legs are PLANNED; an asset leg still needs a group", async () => {
    const { user, wallet, op } = await quoted();
    const rows = await legs(op.id);
    const recoveryId = await addRecovery(op.id, rows[1]!);
    expect((await post(user.h, `/v1/operations/${op.id}/legs/${rows[2]!.id}/quote`)).status).toBe(409); // a buy is signed through its group
    const q = await post(user.h, `/v1/operations/${op.id}/legs/${recoveryId}/quote`);
    expect(q.status).toBe(200);
    expect(q.body.transaction.kind).toBe("solana");
    const res = await post(user.h, `/v1/operations/${op.id}/legs/${recoveryId}/submit`, { signedTx: walletSign(q.body.transaction.serializedBase64, wallet) });
    expect(res.status).toBe(200);
    expect(sends()).toHaveLength(1);
    expect((await legs(op.id)).find((l) => l.id === recoveryId)!.status).toBe("SUBMITTED");
    expect((await post(user.h, `/v1/operations/${op.id}/legs/${rows[2]!.id}/submit`, { signedTx: "AAAAAAAA" })).status).toBe(409);
  });

  it("waits only for nothing to be in flight: a buy that is still SUBMITTED holds the recovery back", async () => {
    const { user, op } = await quoted();
    const rows = await legs(op.id);
    const recoveryId = await addRecovery(op.id, rows[1]!);
    await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = 'sig-x' WHERE id = ${rows[2]!.id}`;
    const q = await post(user.h, `/v1/operations/${op.id}/legs/${recoveryId}/quote`);
    expect(q.status).toBe(409);
    expect(q.body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("submit a group", () => {
  it("sends the fee, waits for it to confirm, then the buys in order; every leg is SUBMITTED and tracked", async () => {
    const { user, wallet, op, group } = await quoted();
    const res = await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet));
    expect(res.status).toBe(200);
    const after = await legs(op.id);
    expect(after.every((l) => l.status === "SUBMITTED" && l.source_tx)).toBe(true);
    const expectedOrder = [after.find((l) => l.kind === "network_fee")!, ...after.filter((l) => l.kind !== "network_fee")].map((l) => l.source_tx);
    expect(sentSignatures()).toEqual(expectedOrder);
    expect(vi.mocked(connection.getSignatureStatuses).mock.calls[0]![0]).toEqual([expectedOrder[0]]);
    expect((await groupRows(op.id))[0]!.status).toBe("SENT");
    expect(res.body.status).toBe("IN_PROGRESS");
    expect(fakes.queue.jobs.filter((j) => j.name === "track-leg").map((j) => (j.data as { legId: string }).legId)).toEqual(group.transactions.map((t) => t.legId));
  });

  it("maps the signed transactions by legId: any order is accepted and the send order is still fee, then sequence (Review Focus 1)", async () => {
    const { user, wallet, op, group } = await quoted();
    const res = await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet).reverse());
    expect(res.status).toBe(200);
    const after = await legs(op.id);
    expect(sentSignatures()).toEqual([after.find((l) => l.kind === "network_fee")!.source_tx, ...after.filter((l) => l.kind !== "network_fee").map((l) => l.source_tx)]);
  });

  it("refuses a missing, an extra, a foreign or a duplicated leg: nothing is claimed or sent (Review Focus 1)", async () => {
    const { user, wallet, op, group } = await quoted();
    const signed = signAll(group.transactions, wallet);
    for (const bad of [signed.slice(1), [...signed, { legId: randomUUID(), signedTx: signed[0]!.signedTx }], [...signed.slice(0, 4), { legId: randomUUID(), signedTx: signed[4]!.signedTx }], [...signed, signed[1]!]]) {
      const res = await submit(user.h, op.id, group.groupId, bad);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("TX_MISMATCH");
    }
    expect(sends()).toHaveLength(0);
    expect((await legs(op.id)).every((l) => l.status === "PLANNED" && l.source_tx === null)).toBe(true);
    expect((await groupRows(op.id))[0]!.status).toBe("QUOTED");
    const garbage = await submit(user.h, op.id, group.groupId, signed.map((s, n) => (n === 2 ? { ...s, signedTx: "AAAAAAAA" } : s)));
    expect(garbage.body.error.code).toBe("TX_MISMATCH");
  });

  it("accepts ComputeBudget-only rewrites; a changed fee payer refuses the whole group with nothing claimed (Review Focus 4)", async () => {
    const { user, wallet, op, group } = await quoted();
    const padded = group.transactions.map((t, n) => ({
      legId: t.legId,
      signedTx: n === 1 || n === 2 ? rewrite(t.serializedBase64, wallet, (ix) => [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }), ...ix]) : walletSign(t.serializedBase64, wallet),
    }));
    const swapped = padded.map((s, n) => (n === 3 ? { ...s, signedTx: rewrite(group.transactions[3]!.serializedBase64, wallet, (ix) => ix, new PublicKey(Buffer.alloc(32, 7))) } : s));
    const refused = await submit(user.h, op.id, group.groupId, swapped);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("TX_MISMATCH");
    expect(sends()).toHaveLength(0);
    expect((await legs(op.id)).every((l) => l.status === "PLANNED")).toBe(true);
    expect((await submit(user.h, op.id, group.groupId, padded)).status).toBe(200);
    expect(sends()).toHaveLength(5);
  });

  it("two identical submits at once: one wins, the other is 409, and every transaction is sent once (Review Focus 2)", async () => {
    const { user, wallet, op, group } = await quoted();
    const signed = signAll(group.transactions, wallet);
    const results = await Promise.all([submit(user.h, op.id, group.groupId, signed), submit(user.h, op.id, group.groupId, signed)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(sends()).toHaveLength(5);
  });

  it("a fee that fails preflight sends no buy, releases every claim and answers 503 (Review Focus 3)", async () => {
    const { user, wallet, op, group } = await quoted();
    vi.mocked(connection.sendRawTransaction).mockRejectedValueOnce(new SendTransactionError({ action: "send", signature: "", transactionMessage: "insufficient funds" }));
    const res = await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("ROUTE_UNAVAILABLE");
    expect(sends()).toHaveLength(1);
    const rows = await legs(op.id);
    expect(rows.every((l) => l.status === "PLANNED" && l.source_tx === null && l.built_message_hash === null && l.group_id === null && !l.expected_tx?.preparedBase64)).toBe(true);
    expect(rows.find((l) => l.kind === "network_fee")!.last_error).toMatch(/^FEE_REFUSED: /);
    expect((await groupRows(op.id))[0]!.status).toBe("RELEASED");
    expect((await opRow(op.id)).status).toBe("PLANNED");
  });

  it("a fee that does not confirm in time keeps the fee tracked and releases the buys unsent; the investment needs action", async () => {
    const { user, wallet, op, group } = await quoted();
    const confirmed = vi.spyOn(solanaTx, "solanaConfirmed").mockResolvedValue(false);
    const res = await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet));
    expect(res.status).toBe(200);
    expect(confirmed.mock.calls[0]![1]).toBeGreaterThan(0);
    expect(confirmed.mock.calls[0]![1]).toBeLessThanOrEqual(30_000);
    const rows = await legs(op.id);
    expect(rows.find((l) => l.kind === "network_fee")!.status).toBe("SUBMITTED");
    expect(rows.filter((l) => l.kind !== "network_fee").every((l) => l.status === "PLANNED" && l.last_error === "STOPPED" && l.source_tx === null)).toBe(true);
    expect(sends()).toHaveLength(1);
    expect((await opRow(op.id)).needs_action_since).not.toBeNull();
  });

  it("a buy that fails preflight stops the rest: it carries the refusal, the later ones STOPPED", async () => {
    const { user, wallet, op, group } = await quoted();
    vi.mocked(connection.sendRawTransaction).mockImplementation(async (raw) => {
      if (sends().length === 3) throw new SendTransactionError({ action: "send", signature: "", transactionMessage: "slippage exceeded" });
      return bs58.encode(VersionedTransaction.deserialize(raw as Uint8Array).signatures[0]!);
    });
    expect((await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet))).status).toBe(200);
    const buys = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(buys.map((l) => l.status)).toEqual(["SUBMITTED", "PLANNED", "PLANNED", "PLANNED"]);
    expect(buys[1]!.last_error).toMatch(/^PREFLIGHT_REFUSED: /);
    expect(buys.slice(2).map((l) => l.last_error)).toEqual(["STOPPED", "STOPPED"]);
    expect(sends()).toHaveLength(3);
    expect((await opRow(op.id)).needs_action_since).not.toBeNull();
  });

  it("an unknown send outcome is tracked, never resent, and the later buys are still sent", async () => {
    const { user, wallet, op, group } = await quoted();
    vi.mocked(connection.sendRawTransaction).mockImplementation(async (raw) => {
      if (sends().length === 3) throw new Error("timeout");
      return bs58.encode(VersionedTransaction.deserialize(raw as Uint8Array).signatures[0]!);
    });
    expect((await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet))).status).toBe(200);
    expect((await legs(op.id)).map((l) => l.status)).toEqual(["SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED", "SUBMITTED"]);
    expect(sends()).toHaveLength(5);
    expect(new Set(sentSignatures()).size).toBe(5);
  });
});

describe("the blockhash gate and the send window", () => {
  it("a blockhash that is no longer valid releases that buy and every later one as QUOTE_STALE", async () => {
    const info = spyInfo();
    const { user, wallet, op, group } = await quoted();
    vi.mocked(connection.isBlockhashValid).mockResolvedValueOnce({ context: { slot: 1 }, value: true }).mockResolvedValueOnce({ context: { slot: 1 }, value: true }).mockResolvedValueOnce({ context: { slot: 1 }, value: false });
    expect((await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet))).status).toBe(200);
    const buys = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(buys.map((l) => l.status)).toEqual(["SUBMITTED", "SUBMITTED", "PLANNED", "PLANNED"]);
    expect(buys.slice(2).map((l) => l.last_error)).toEqual(["QUOTE_STALE", "QUOTE_STALE"]);
    expect(sends()).toHaveLength(3);
    expect(info.mock.calls.filter(([message]) => message === "leg.released")).toHaveLength(2);
  });

  it("a block height past the quote height plus 130 releases from that buy on", async () => {
    const { user, wallet, op, group } = await quoted();
    vi.mocked(connection.getBlockHeight).mockResolvedValueOnce(1_000).mockResolvedValueOnce(1_130).mockResolvedValueOnce(1_131);
    expect((await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet))).status).toBe(200);
    const buys = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(buys.map((l) => l.status)).toEqual(["SUBMITTED", "SUBMITTED", "PLANNED", "PLANNED"]);
    expect(buys[2]!.last_error).toBe("QUOTE_STALE");
  });

  it("a submit after sendBy is 409 GROUP_EXPIRED with nothing claimed", async () => {
    const info = spyInfo();
    const { user, wallet, op, group } = await quoted();
    await adminSql`UPDATE app.operation_groups SET send_by = now() - interval '1 second'`;
    const res = await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("GROUP_EXPIRED");
    expect(sends()).toHaveLength(0);
    expect((await groupRows(op.id))[0]!.status).toBe("EXPIRED");
    expect((await legs(op.id)).every((l) => l.status === "PLANNED")).toBe(true);
    expect(info.mock.calls.some(([message]) => message === "group.expired")).toBe(true);
  });

  it("after GROUP_EXPIRED at submit, a new group request quotes the same legs (200) and reuses the plan's fee leg (review C1)", async () => {
    const { user, wallet, op, group } = await quoted();
    await adminSql`UPDATE app.operation_groups SET send_by = now() - interval '1 second'`;
    expect((await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet))).body.error.code).toBe("GROUP_EXPIRED");
    expect((await legs(op.id)).every((l) => l.group_id === null)).toBe(true); // nothing points at the expired group
    const next = await groupReq(user.h, op.id, { idempotencyKey: "grp-bbbbbbbb" });
    expect(next.status).toBe(200);
    expect(next.body.transactions.map((t: Tx) => t.kind)).toEqual(["fee", "asset", "asset", "asset", "asset"]);
    expect(next.body.transactions[0].legId).toBe(op.legs[0].id);
    expect((await groupRows(op.id)).map((g) => g.status)).toEqual(["EXPIRED", "QUOTED"]);
    expect((await submit(user.h, op.id, next.body.groupId, signAll(next.body.transactions, wallet))).status).toBe(200);
  });

  it("once claimed, running past sendBy does not stop the buys while their blockhash is valid", async () => {
    const { user, wallet, op, group } = await quoted();
    await adminSql`UPDATE app.operation_groups SET send_by = now() + interval '2 seconds'`;
    vi.mocked(connection.sendRawTransaction).mockImplementationOnce(async (raw) => {
      await new Promise((resolve) => setTimeout(resolve, 2_300)); // the fee send takes longer than the window
      return bs58.encode(VersionedTransaction.deserialize(raw as Uint8Array).signatures[0]!);
    });
    expect((await submit(user.h, op.id, group.groupId, signAll(group.transactions, wallet))).status).toBe(200);
    expect((await legs(op.id)).every((l) => l.status === "SUBMITTED")).toBe(true);
    expect(sends()).toHaveLength(5);
  }, 20_000);
});

describe("solanaConfirmed", () => {
  it("is true for confirmed or finalized, false for a failed transaction, and false when nothing shows up within the wait", async () => {
    const chain = mockChains();
    chain.signatureStatus.set("fin", "finalized");
    chain.signatureStatus.set("bad", "failed");
    chain.signatureStatus.set("gone", "none");
    expect(await solanaTx.solanaConfirmed("ok", 0)).toBe(true);
    expect(await solanaTx.solanaConfirmed("fin", 0)).toBe(true);
    expect(await solanaTx.solanaConfirmed("bad", 5_000)).toBe(false);
    const started = Date.now();
    expect(await solanaTx.solanaConfirmed("gone", 700)).toBe(false);
    expect(Date.now() - started).toBeGreaterThanOrEqual(500);
    expect(vi.mocked(connection.getSignatureStatuses).mock.calls.length).toBeGreaterThanOrEqual(4);
  });
});

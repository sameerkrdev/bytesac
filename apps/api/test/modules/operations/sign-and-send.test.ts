import { randomUUID } from "node:crypto";
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@repo/logger";
import { connection } from "@/providers/solana-tx";
import { trackLeg, trackStaleClaims } from "@/modules/portfolio/tracking.service";
import { adminSql, resetDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { arrange, groupReq, groupRows, legs, opRow, post, walletSign, type H, type LegRow, type Tx, type Wallet } from "../../helpers/groups";

// Spec 22 B-27 / section 6.4: the wallet signs and sends; the server claims first, records the signatures it is told, and resolves the rest from the chain.

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

const req = (extra: object = {}) => ({ tier: "sign_and_send", ...extra });
const step = (h: H, opId: string, groupId: string, name: "claim" | "sent" | "release", body?: object) => post(h, `/v1/operations/${opId}/groups/${groupId}/${name}`, body);
/** What the wallet's signAndSend would return for a transaction: its first signature, base58. */
const signatureOf = (t: Tx, wallet: Wallet) => bs58.encode(VersionedTransaction.deserialize(Buffer.from(walletSign(t.serializedBase64, wallet), "base64")).signatures[0]!);
const sentBody = (txs: Tx[], wallet: Wallet) => ({ signatures: txs.map((t) => ({ legId: t.legId, signature: signatureOf(t, wallet) })) });
const kinds = (txs: Tx[]) => txs.map((t) => t.kind);

/** A plan whose fee shares are all covered, so a sign-and-send group is the asset chunk itself (as after a confirmed fee). */
async function arrangeAssets(over: { legs?: number } = {}) {
  const ctx = await arrange(over);
  await adminSql`UPDATE app.operation_legs SET fee_covered_by = ${ctx.op.legs[0].id} WHERE operation_id = ${ctx.op.id} AND kind <> 'network_fee'`;
  const group = (await groupReq(ctx.user.h, ctx.op.id, req())).body as { groupId: string; transactions: Tx[] };
  return { ...ctx, group };
}

describe("sign-and-send groups, fee first", () => {
  it("forms the fee alone, then the asset chunk, then the rest: claim and sent record signatures and track the legs", async () => {
    const { user, wallet, chain, op } = await arrange({ legs: 14 });
    const assetIds = (await legs(op.id)).filter((l) => l.kind !== "network_fee").map((l) => l.id);

    const g1 = await groupReq(user.h, op.id, req());
    expect(g1.status).toBe(200);
    expect(kinds(g1.body.transactions)).toEqual(["fee"]);
    expect(g1.body.legs).toEqual([]);
    expect((await legs(op.id)).find((l) => l.kind === "network_fee")!.route_summary!.covers).toEqual(assetIds.slice(0, 12));
    expect((await groupRows(op.id))[0]).toMatchObject({ tier: "sign_and_send", status: "QUOTED" });

    const claim = await step(user.h, op.id, g1.body.groupId, "claim");
    expect(claim.status).toBe(200);
    expect((await legs(op.id)).find((l) => l.id === g1.body.transactions[0].legId)).toMatchObject({ status: "SUBMITTING", source_tx: null });
    expect((await groupRows(op.id))[0]!.status).toBe("CLAIMED");

    const feeSent = sentBody(g1.body.transactions, wallet);
    const sent = await step(user.h, op.id, g1.body.groupId, "sent", feeSent);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe("IN_PROGRESS");
    expect((await legs(op.id)).find((l) => l.id === g1.body.transactions[0].legId)).toMatchObject({ status: "SUBMITTED", source_tx: feeSent.signatures[0]!.signature });
    expect((await groupRows(op.id))[0]!.status).toBe("SENT");
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: g1.body.transactions[0].legId } });

    // The fee is not on chain yet: the next group waits.
    chain.signatureStatus.set(feeSent.signatures[0]!.signature, "none");
    const waiting = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }));
    expect(waiting.status).toBe(409);
    expect(waiting.body.error.details).toEqual({ reason: "fee_confirming" });
    chain.signatureStatus.delete(feeSent.signatures[0]!.signature);

    const g2 = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-cccccccc" }));
    expect(g2.status).toBe(200);
    expect(g2.body.transactions).toHaveLength(12);
    expect(new Set(kinds(g2.body.transactions))).toEqual(new Set(["asset"]));
    expect(g2.body.transactions.map((t: Tx) => t.legId)).toEqual(assetIds.slice(0, 12));
    expect((await step(user.h, op.id, g2.body.groupId, "claim")).status).toBe(200);
    expect((await legs(op.id)).filter((l) => l.status === "SUBMITTING")).toHaveLength(12);
    expect((await step(user.h, op.id, g2.body.groupId, "sent", sentBody(g2.body.transactions, wallet))).status).toBe(200);
    expect((await legs(op.id)).filter((l) => l.status === "SUBMITTED" && l.kind !== "network_fee")).toHaveLength(12);

    // The last two legs are not covered by the first fee: a fee for them alone, then they follow.
    const g3 = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-dddddddd" }));
    expect(kinds(g3.body.transactions)).toEqual(["fee"]);
    const fee3 = (await legs(op.id)).find((l) => l.id === g3.body.transactions[0].legId)!;
    expect(fee3.route_summary!.covers).toEqual(assetIds.slice(12));
    await step(user.h, op.id, g3.body.groupId, "claim");
    await step(user.h, op.id, g3.body.groupId, "sent", sentBody(g3.body.transactions, wallet));
    const g4 = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-eeeeeeee" }));
    expect(g4.body.transactions.map((t: Tx) => t.legId)).toEqual(assetIds.slice(12));
    expect(kinds(g4.body.transactions)).toEqual(["asset", "asset"]);
  });
});

describe("/sent validation (Review Focus 3)", () => {
  /** Nothing was recorded: every leg of the group is still claimed without a signature. */
  const untouched = async (opId: string, ids: string[]) => {
    const rows = (await legs(opId)).filter((l) => ids.includes(l.id));
    expect(rows.every((l) => l.status === "SUBMITTING" && l.source_tx === null)).toBe(true);
    expect((await groupRows(opId))[0]!.status).toBe("CLAIMED");
  };

  it("refuses a foreign leg, a duplicate leg, a duplicate signature, a malformed signature and a group that is not claimed; records nothing", async () => {
    const { user, wallet, op, group } = await arrangeAssets();
    const ids = group.transactions.map((t) => t.legId);
    const [a, b] = sentBody(group.transactions, wallet).signatures as [{ legId: string; signature: string }, { legId: string; signature: string }];

    expect((await step(user.h, op.id, group.groupId, "sent", { signatures: [a] })).status).toBe(409); // not claimed yet
    expect((await step(user.h, op.id, group.groupId, "claim")).status).toBe(200);

    const bad: [number, object][] = [
      [409, { signatures: [{ legId: randomUUID(), signature: a.signature }] }],
      [409, { signatures: [a, { legId: a.legId, signature: b.signature }] }],
      [409, { signatures: [a, { legId: b.legId, signature: a.signature }] }],
      [400, { signatures: [{ legId: a.legId, signature: bs58.encode(Buffer.alloc(63, 7)) }] }], // 63 bytes
      [400, { signatures: [{ legId: a.legId, signature: "0".repeat(86) }] }], // not base58
      [400, { signatures: [{ legId: a.legId, signature: "short" }] }],
    ];
    for (const [status, body] of bad) {
      expect((await step(user.h, op.id, group.groupId, "sent", body)).status).toBe(status);
      await untouched(op.id, ids);
    }
    expect(fakes.queue.jobs.filter((j) => j.name === "track-leg")).toHaveLength(0);
  });

  it("records a subset; the legs without a signature stay claimed for the sweep and the group stays CLAIMED until they have one", async () => {
    const { user, wallet, op, group } = await arrangeAssets();
    await step(user.h, op.id, group.groupId, "claim");
    const all = sentBody(group.transactions, wallet).signatures;
    expect((await step(user.h, op.id, group.groupId, "sent", { signatures: all.slice(0, 2) })).status).toBe(200);
    let rows: LegRow[] = await legs(op.id);
    expect(rows.filter((l) => l.status === "SUBMITTED").map((l) => l.id)).toEqual(all.slice(0, 2).map((s) => s.legId));
    expect(rows.filter((l) => l.status === "SUBMITTING" && l.source_tx === null)).toHaveLength(2);
    expect((await groupRows(op.id))[0]!.status).toBe("CLAIMED");
    expect((await step(user.h, op.id, group.groupId, "sent", { signatures: all.slice(0, 1) })).status).toBe(409); // already recorded
    expect((await step(user.h, op.id, group.groupId, "sent", { signatures: all.slice(2) })).status).toBe(200);
    rows = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(rows.every((l) => l.status === "SUBMITTED")).toBe(true);
    expect((await groupRows(op.id))[0]!.status).toBe("SENT");
    expect((await step(user.h, op.id, group.groupId, "sent", { signatures: all })).status).toBe(409); // SENT
  });

  it("is the user's own: another user's operation is not found", async () => {
    const { op, group, wallet } = await arrangeAssets();
    const other = await (await import("../../helpers/execution")).seedUser();
    expect((await step(other.h, op.id, group.groupId, "claim")).status).toBe(404);
    expect((await step(other.h, op.id, group.groupId, "sent", sentBody(group.transactions, wallet))).status).toBe(404);
    expect((await step(other.h, op.id, group.groupId, "release")).status).toBe(404);
  });
});

describe("claim", () => {
  it("after sendBy is 409 GROUP_EXPIRED and claims nothing", async () => {
    const { user, op, group } = await arrangeAssets();
    await adminSql`UPDATE app.operation_groups SET send_by = now() - interval '1 second'`;
    const res = await step(user.h, op.id, group.groupId, "claim");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("GROUP_EXPIRED");
    expect((await groupRows(op.id))[0]!.status).toBe("EXPIRED");
    expect((await legs(op.id)).every((l) => l.status === "PLANNED" && l.group_id === null)).toBe(true);
  });

  it("two at once: one is 200 and one is 409; a tier other than sign_and_send cannot be claimed", async () => {
    const { user, op, group } = await arrangeAssets();
    const results = await Promise.all([step(user.h, op.id, group.groupId, "claim"), step(user.h, op.id, group.groupId, "claim")]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    await resetDb();
    const sign = await arrange();
    const quoted = (await groupReq(sign.user.h, sign.op.id)).body;
    expect((await step(sign.user.h, sign.op.id, quoted.groupId, "claim")).status).toBe(409);
  });

  it("keeps the lowered floor when the user accepted new prices, and leaves quoting alone", async () => {
    const { user, chain, op } = await arrange();
    await adminSql`UPDATE app.operation_legs SET fee_covered_by = ${op.legs[0].id} WHERE operation_id = ${op.id} AND kind <> 'network_fee'`;
    const planned = (await legs(op.id)).filter((l) => l.kind !== "network_fee").map((l) => l.min_out);
    chain.quoteOut = { numerator: 99n, denominator: 100n };
    const group = (await groupReq(user.h, op.id, req())).body;
    expect((await legs(op.id)).filter((l) => l.kind !== "network_fee").map((l) => l.min_out)).toEqual(planned);
    await step(user.h, op.id, group.groupId, "claim");
    const claimed = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(claimed.every((l, n) => BigInt(l.min_out!) < BigInt(planned[n]!))).toBe(true);
  });
});

describe("release", () => {
  it("returns claimed legs without a signature to PLANNED with their bytes cleared and releases the group; a new group can be formed", async () => {
    const { user, op, group } = await arrangeAssets();
    await step(user.h, op.id, group.groupId, "claim");
    const res = await step(user.h, op.id, group.groupId, "release");
    expect(res.status).toBe(200);
    const rows = await legs(op.id);
    expect(rows.filter((l) => l.kind !== "network_fee").every((l) => l.status === "PLANNED" && l.built_message_hash === null && l.group_id === null && !l.expected_tx?.preparedBase64 && l.last_error === "WALLET_REJECTED")).toBe(true);
    expect((await groupRows(op.id))[0]!.status).toBe("RELEASED");
    expect((await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }))).status).toBe(200); // a second attempt works
  });

  it("changes nothing for legs that have a signature: after sent, and after a partial sent", async () => {
    const { user, wallet, op, group } = await arrangeAssets();
    await step(user.h, op.id, group.groupId, "claim");
    const all = sentBody(group.transactions, wallet).signatures;
    await step(user.h, op.id, group.groupId, "sent", { signatures: all.slice(0, 1) });
    expect((await step(user.h, op.id, group.groupId, "release")).status).toBe(200);
    const rows = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(rows.map((l) => l.status)).toEqual(["SUBMITTED", "PLANNED", "PLANNED", "PLANNED"]);
    expect(rows[0]).toMatchObject({ source_tx: all[0]!.signature, group_id: group.groupId });
    expect((await groupRows(op.id))[0]!.status).toBe("SENT");
    expect((await step(user.h, op.id, group.groupId, "release")).status).toBe(200); // a repeat changes nothing
    expect((await legs(op.id)).filter((l) => l.status === "SUBMITTED")).toHaveLength(1);
  });
});

/** A landed transaction as getTransaction returns it. */
const landedAs = (serializedBase64: string, change?: (ix: TransactionMessage["instructions"]) => TransactionMessage["instructions"]) => {
  const message = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64")).message;
  if (!change) return { transaction: { message, signatures: [] }, slot: 1, meta: null } as never;
  const decompiled = TransactionMessage.decompile(message);
  return { transaction: { message: new TransactionMessage({ payerKey: decompiled.payerKey, recentBlockhash: decompiled.recentBlockhash, instructions: change(decompiled.instructions) }).compileToV0Message(), signatures: [] }, slot: 1, meta: null } as never;
};

describe("the sweep resolves a claim without signatures (Review Focus 2)", () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  /** A claimed asset group aged past the sweep's two minutes. */
  async function claimedAndAged() {
    const ctx = await arrangeAssets();
    await step(ctx.user.h, ctx.op.id, ctx.group.groupId, "claim");
    await adminSql`UPDATE app.operation_legs SET updated_at = now() - interval '3 minutes', submitted_at = now() - interval '3 minutes' WHERE operation_id = ${ctx.op.id}`;
    return ctx;
  }

  it("matches a landed transaction to its leg (ComputeBudget differences allowed), records the signature and tracks it; the others stay claimed", async () => {
    const { group, op } = await claimedAndAged();
    const [t0, t1] = group.transactions as [Tx, Tx];
    vi.mocked(connection.getSignaturesForAddress).mockResolvedValue([
      { signature: "sig-other", slot: 1, err: null, memo: null, blockTime: nowSeconds() },
      { signature: "sig-leg0", slot: 1, err: null, memo: null, blockTime: nowSeconds() },
      { signature: "sig-ancient", slot: 1, err: null, memo: null, blockTime: nowSeconds() - 7_200 }, // before the claim: never looked up
    ]);
    vi.mocked(connection.getTransaction).mockImplementation((async (signature: string) => {
      if (signature === "sig-leg0") return landedAs(t0.serializedBase64, (ix) => [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 9_000 }), ...ix]);
      if (signature === "sig-ancient") return landedAs(t1.serializedBase64);
      return null;
    }) as never);
    await trackStaleClaims();
    const rows = await legs(op.id);
    const leg0 = rows.find((l) => l.id === t0.legId)!;
    expect(leg0).toMatchObject({ status: "SUBMITTED", source_tx: "sig-leg0" });
    expect(leg0.expected_tx).toMatchObject({ recentBlockhash: expect.any(String) });
    expect(rows.find((l) => l.id === t1.legId)).toMatchObject({ status: "SUBMITTING", source_tx: null }); // its blockhash is still valid: it may yet land
    expect(fakes.queue.jobs).toContainEqual({ name: "track-leg", data: { legId: t0.legId } });
    expect(vi.mocked(connection.getTransaction).mock.calls.map(([sig]) => sig)).not.toContain("sig-ancient");
  });

  it("a claim with no match whose blockhash expired can never land: FAILED / NOT_LANDED, and nothing is resent", async () => {
    const { op } = await claimedAndAged();
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`; // as after the first (fee) group
    vi.mocked(connection.isBlockhashValid).mockResolvedValue({ context: { slot: 1 }, value: false });
    await trackStaleClaims();
    const rows = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(rows.every((l) => l.status === "FAILED" && l.failure_reason === "NOT_LANDED" && l.source_tx === null)).toBe(true);
    expect(vi.mocked(connection.sendRawTransaction)).not.toHaveBeenCalled();
    expect((await opRow(op.id)).needs_action_since).not.toBeNull(); // the user is asked to Continue
  });

  it("with no match and the blockhash still valid, nothing changes; a claim younger than two minutes is not looked at", async () => {
    const { op } = await claimedAndAged();
    await trackStaleClaims();
    expect((await legs(op.id)).filter((l) => l.kind !== "network_fee").every((l) => l.status === "SUBMITTING" && l.source_tx === null)).toBe(true);

    await resetDb();
    const fresh = await arrangeAssets();
    await step(fresh.user.h, fresh.op.id, fresh.group.groupId, "claim");
    vi.mocked(connection.getSignaturesForAddress).mockClear();
    await trackStaleClaims();
    expect(connection.getSignaturesForAddress).not.toHaveBeenCalled();
  });

  it("a failing lookup for one wallet does not stop the sweep", async () => {
    await claimedAndAged();
    vi.mocked(connection.getSignaturesForAddress).mockRejectedValue(new Error("rpc down"));
    await expect(trackStaleClaims()).resolves.toBeUndefined();
  });
});

describe("a sign-and-send transaction that landed (after-the-fact check)", () => {
  /** A claimed, sent and failed-on-chain first leg; `landed` is what the RPC shows for it, given its own transaction and another leg's. */
  async function sentAndFailed(landed: (own: Tx, other: Tx) => unknown) {
    const ctx = await arrangeAssets();
    await step(ctx.user.h, ctx.op.id, ctx.group.groupId, "claim");
    const body = sentBody(ctx.group.transactions, ctx.wallet);
    await step(ctx.user.h, ctx.op.id, ctx.group.groupId, "sent", { signatures: body.signatures.slice(0, 1) });
    const [own, other] = ctx.group.transactions as [Tx, Tx];
    ctx.chain.solanaFinality.set(body.signatures[0]!.signature, "failed");
    vi.mocked(connection.getTransaction).mockResolvedValue(landed(own, other) as never);
    return own.legId;
  }
  const audits = (legId: string) => adminSql<{ action: string }[]>`SELECT action FROM app.audit_events WHERE action = 'leg.tx_mismatch_after_send' AND entity_id = ${legId}`;

  it("a landed message that is not the prepared one writes tx_mismatch_after_send and logs an error; tracking goes on from chain evidence", async () => {
    const error = vi.spyOn(logger, "error");
    const legId = await sentAndFailed((_own, other) => landedAs(other.serializedBase64));
    await trackLeg(legId);
    expect(await audits(legId)).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect((await adminSql<{ status: string }[]>`SELECT status FROM app.operation_legs WHERE id = ${legId}`)[0]!.status).toBe("FAILED");
  });

  it("the prepared message, or one that differs only in ComputeBudget, raises nothing", async () => {
    const error = vi.spyOn(logger, "error");
    const legId = await sentAndFailed((own) => landedAs(own.serializedBase64, (ix) => [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ...ix]));
    await trackLeg(legId);
    expect(await audits(legId)).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });
});

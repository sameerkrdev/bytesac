import { randomUUID } from "node:crypto";
import { ComputeBudgetProgram, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@repo/logger";
import { app } from "@/app";
import { connection, solanaFinality } from "@/providers/solana-tx";
import { expireStalePlans, trackLeg, trackStaleClaims } from "@/modules/portfolio/tracking.service";
import { balanceKey } from "../../helpers/chain-mocks";
import { adminSql, resetDb } from "../../helpers/db";
import { USDC_MINT } from "../../helpers/execution";
import { fakes } from "../../helpers/fakes";
import { opsUser } from "../manager-applications/helpers";
import { arrange, groupReq, groupRows, legs, opRow, post, walletSign, type H, type LegRow, type Tx, type Wallet } from "../../helpers/groups";

// Spec 22 B-27 / section 6.4: the wallet signs and sends; the server claims first, records the signatures it is told, and resolves the rest from the chain.

const onChain = new Map<string, string>(); // signature -> the transaction the wallet really sent, for the proof the server asks the RPC for
beforeEach(async () => { onChain.clear(); await resetDb(); });
afterEach(() => vi.restoreAllMocks());

const req = (extra: object = {}) => ({ tier: "sign_and_send", ...extra });
const step = (h: H, opId: string, groupId: string, name: "claim" | "sent" | "release", body?: object) => post(h, `/v1/operations/${opId}/groups/${groupId}/${name}`, body);
/** What the wallet's signAndSend would return for a transaction: its first signature, base58. */
const signatureOf = (t: Tx, wallet: Wallet) => bs58.encode(VersionedTransaction.deserialize(Buffer.from(walletSign(t.serializedBase64, wallet), "base64")).signatures[0]!);
/** What the wallet reports; the RPC then shows exactly those transactions (override `getTransaction` to show something else). */
const sentBody = (txs: Tx[], wallet: Wallet) => {
  const signatures = txs.map((t) => ({ legId: t.legId, signature: signatureOf(t, wallet) }));
  signatures.forEach((s, n) => onChain.set(s.signature, txs[n]!.serializedBase64));
  vi.mocked(connection.getTransaction).mockImplementation((async (sig: string) => (onChain.has(sig) ? landedAs(onChain.get(sig)!) : null)) as never);
  return { signatures };
};
const kinds = (txs: Tx[]) => txs.map((t) => t.kind);

/** A plan whose fee shares are all covered, so a sign-and-send group is the asset chunk itself (as after a confirmed fee). */
async function arrangeAssets(over: { legs?: number } = {}) {
  const ctx = await arrange(over);
  await adminSql`UPDATE app.operation_legs SET fee_covered_by = ${ctx.op.legs[0].id} WHERE operation_id = ${ctx.op.id} AND kind <> 'network_fee'`;
  const group = (await groupReq(ctx.user.h, ctx.op.id, req())).body as { groupId: string; transactions: Tx[] };
  return { ...ctx, group };
}

describe("the plan's approvals estimate", () => {
  it("a plan asked for with tier sign_and_send counts the fee and the buys as two approvals (review M7)", async () => {
    const { user, basket, op } = await arrange();
    expect(op.approvalsEstimate).toBe(1); // sign_all: the fee rides in the buys' popup
    expect((await post(user.h, `/v1/operations/${op.id}/cancel`)).status).toBe(200);
    const res = await post(user.h, "/v1/operations/invest", { basketId: basket.basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: "key-bbbbbbbb", tier: "sign_and_send" });
    expect(res.status).toBe(201);
    expect(res.body.approvalsEstimate).toBe(2);
  });
});

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

  it("puts back the plan's floor that the claim lowered, so the next quote at the same lower price still asks first (review M1)", async () => {
    const { user, chain, op } = await arrange();
    await adminSql`UPDATE app.operation_legs SET fee_covered_by = ${op.legs[0].id} WHERE operation_id = ${op.id} AND kind <> 'network_fee'`;
    const planned = (await legs(op.id)).filter((l) => l.kind !== "network_fee").map((l) => l.min_out);
    chain.quoteOut = { numerator: 99n, denominator: 100n };
    const group = (await groupReq(user.h, op.id, req())).body;
    expect(group.priceMoved).toBe(true);
    await step(user.h, op.id, group.groupId, "claim"); // the user accepted the new prices
    expect((await step(user.h, op.id, group.groupId, "release")).status).toBe(200);
    expect((await legs(op.id)).filter((l) => l.kind !== "network_fee").map((l) => l.min_out)).toEqual(planned);
    expect((await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }))).body.priceMoved).toBe(true);
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

  const unrelated = (from: number, n: number, blockTime: number) => Array.from({ length: n }, (_, i) => ({ signature: `spam-${from + i}`, slot: 1, err: null, memo: null, blockTime }));

  it("never marks NOT_LANDED from a history it could not read back past the claim, and fetches at most 100 transactions doing so (review I1, I-B)", async () => {
    const { op } = await claimedAndAged();
    vi.mocked(connection.isBlockhashValid).mockResolvedValue({ context: { slot: 1 }, value: false });
    vi.mocked(connection.getSignaturesForAddress).mockImplementation((async (_owner: unknown, o?: { before?: string }) => unrelated(o?.before ? Number(o.before.slice(5)) + 1 : 0, 1_000, nowSeconds())) as never);
    const warn = vi.spyOn(logger, "warn");
    await trackStaleClaims();
    expect((await legs(op.id)).filter((l) => l.kind !== "network_fee").every((l) => l.status === "SUBMITTING" && l.source_tx === null)).toBe(true);
    expect(vi.mocked(connection.getSignaturesForAddress).mock.calls.map(([, o]) => o)).toEqual([
      { limit: 1_000, before: undefined }, { limit: 1_000, before: "spam-999" }, { limit: 1_000, before: "spam-1999" },
    ]);
    expect(vi.mocked(connection.getTransaction).mock.calls.length).toBeLessThanOrEqual(100);
    expect(warn.mock.calls.filter(([m]) => String(m).includes("too long to show"))).toHaveLength(4);
  });

  it("pages back with before= (a null block time keeps paging) and finds, oldest first, a transaction behind a full page of newer ones; the claims it could not check stay (review I1, I-B)", async () => {
    const { group, op } = await claimedAndAged();
    const t0 = group.transactions[0]!;
    vi.mocked(connection.isBlockhashValid).mockResolvedValue({ context: { slot: 1 }, value: false });
    const page1 = [...unrelated(0, 999, nowSeconds()), { signature: "sig-no-time", slot: 1, err: null, memo: null, blockTime: null }];
    vi.mocked(connection.getSignaturesForAddress).mockResolvedValueOnce(page1)
      .mockResolvedValueOnce([{ signature: "sig-leg0", slot: 1, err: null, memo: null, blockTime: nowSeconds() - 120 }]);
    vi.mocked(connection.getTransaction).mockImplementation((async (signature: string) => (signature === "sig-leg0" ? landedAs(t0.serializedBase64) : null)) as never);
    await trackStaleClaims();
    const rows = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(rows.find((l) => l.id === t0.legId)).toMatchObject({ status: "SUBMITTED", source_tx: "sig-leg0" });
    expect(vi.mocked(connection.getTransaction).mock.calls[0]![0]).toBe("sig-leg0"); // oldest first
    expect(vi.mocked(connection.getSignaturesForAddress).mock.calls[1]![1]).toMatchObject({ before: "sig-no-time" });
    // 1 000 newer signatures, more than the 100 lookups: the other claims cannot be shown not to have landed.
    expect(rows.filter((l) => l.id !== t0.legId).every((l) => l.status === "SUBMITTING" && l.source_tx === null)).toBe(true);
    expect(vi.mocked(connection.getTransaction).mock.calls.length).toBeLessThanOrEqual(100);
  });

  it("once every signature since the claim was read and compared, the claims with no match are NOT_LANDED", async () => {
    const { group, op } = await claimedAndAged();
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    const t0 = group.transactions[0]!;
    vi.mocked(connection.isBlockhashValid).mockResolvedValue({ context: { slot: 1 }, value: false });
    vi.mocked(connection.getSignaturesForAddress).mockResolvedValue([...unrelated(0, 20, nowSeconds()), { signature: "sig-leg0", slot: 1, err: null, memo: null, blockTime: nowSeconds() - 120 }]);
    vi.mocked(connection.getTransaction).mockImplementation((async (signature: string) => (signature === "sig-leg0" ? landedAs(t0.serializedBase64) : null)) as never);
    await trackStaleClaims();
    const rows = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
    expect(rows.find((l) => l.id === t0.legId)).toMatchObject({ status: "SUBMITTED", source_tx: "sig-leg0" });
    expect(rows.filter((l) => l.id !== t0.legId).every((l) => l.status === "FAILED" && l.failure_reason === "NOT_LANDED")).toBe(true);
  });

  it("Continue's retry of a claim that never landed keeps the plan's floor, not the one the claim lowered (review m3)", async () => {
    const { user, chain, op } = await arrange();
    await adminSql`UPDATE app.operation_legs SET fee_covered_by = ${op.legs[0].id} WHERE operation_id = ${op.id} AND kind <> 'network_fee'`;
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    const planned = new Map((await legs(op.id)).filter((l) => l.kind !== "network_fee").map((l) => [l.id, l.min_out]));
    chain.quoteOut = { numerator: 99n, denominator: 100n };
    const g = (await groupReq(user.h, op.id, req())).body;
    await step(user.h, op.id, g.groupId, "claim"); // the user accepted the new prices: the claim lowers the floors
    await adminSql`UPDATE app.operation_legs SET updated_at = now() - interval '3 minutes', submitted_at = now() - interval '3 minutes' WHERE operation_id = ${op.id}`;
    vi.mocked(connection.isBlockhashValid).mockResolvedValue({ context: { slot: 1 }, value: false });
    await trackStaleClaims();
    expect((await post(user.h, `/v1/operations/${op.id}/continue`, { idempotencyKey: "cont-aaaaaaaa" })).status).toBe(200);
    const retries = (await legs(op.id)).filter((l) => l.retry_of);
    expect(retries).toHaveLength(4);
    expect(retries.every((l) => l.min_out === planned.get(l.retry_of!))).toBe(true);
  });

  it("checks the blockhash before reading the signatures, so a transaction landing in between is found, never NOT_LANDED (review I1)", async () => {
    const { group, op } = await claimedAndAged();
    const order: string[] = [];
    vi.mocked(connection.isBlockhashValid).mockImplementation((async () => { order.push("blockhash"); return { context: { slot: 1 }, value: false }; }) as never);
    vi.mocked(connection.getSignaturesForAddress).mockImplementation((async () => { order.push("signatures"); return []; }) as never);
    await trackStaleClaims();
    expect(order.indexOf("signatures")).toBeGreaterThan(order.lastIndexOf("blockhash"));
    expect((await legs(op.id)).filter((l) => group.transactions.some((t) => t.legId === l.id)).every((l) => l.failure_reason === "NOT_LANDED")).toBe(true);
  });

  it("a signature reported after the sweep marked its claim NOT_LANDED is refused and kept for ops in the audit, never in the log (review M5)", async () => {
    const { user, wallet, op, group } = await claimedAndAged();
    vi.mocked(connection.isBlockhashValid).mockResolvedValue({ context: { slot: 1 }, value: false });
    await trackStaleClaims();
    const error = vi.spyOn(logger, "error");
    const late = sentBody(group.transactions.slice(0, 1), wallet);
    expect((await step(user.h, op.id, group.groupId, "sent", late)).status).toBe(409);
    const audits = await adminSql<{ entity_id: string; metadata: { signature: string } }[]>`SELECT entity_id, metadata FROM app.audit_events WHERE action = 'leg.signature_after_not_landed'`;
    expect(audits).toEqual([{ entity_id: group.transactions[0]!.legId, metadata: expect.objectContaining({ signature: late.signatures[0]!.signature, operationId: op.id }) }]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).not.toContain(late.signatures[0]!.signature);
  });

  it("a plan whose only claim never landed still expires and frees the user's slot (review M6)", async () => {
    const { user, op } = await arrange();
    const g1 = (await groupReq(user.h, op.id, req())).body as { groupId: string; transactions: Tx[] };
    expect(kinds(g1.transactions)).toEqual(["fee"]);
    await step(user.h, op.id, g1.groupId, "claim");
    await adminSql`UPDATE app.operation_legs SET updated_at = now() - interval '3 minutes', submitted_at = now() - interval '3 minutes' WHERE operation_id = ${op.id}`;
    vi.mocked(connection.isBlockhashValid).mockResolvedValue({ context: { slot: 1 }, value: false });
    await trackStaleClaims();
    expect((await legs(op.id)).find((l) => l.id === g1.transactions[0]!.legId)).toMatchObject({ status: "FAILED", failure_reason: "NOT_LANDED" });
    expect((await opRow(op.id)).status).toBe("PLANNED");
    await adminSql`UPDATE app.operations SET expires_at = now() - interval '1 second' WHERE id = ${op.id}`;
    await expireStalePlans();
    expect((await opRow(op.id)).status).toBe("CANCELLED");
  });
});

describe("a fee-only group checks the buys it pays for (review I4)", () => {
  it("refuses with INSUFFICIENT_BALANCE when the wallet holds the fee but not the buys it covers: no group, the fee leg untouched", async () => {
    const { user, chain, op } = await arrange();
    const rows = await legs(op.id);
    const fee = rows.find((l) => l.kind === "network_fee")!;
    const buys = rows.filter((l) => l.kind !== "network_fee").reduce((t, l) => t + BigInt(l.amount_in), 0n);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), BigInt(fee.amount_in) + buys / 2n);
    const res = await groupReq(user.h, op.id, req());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INSUFFICIENT_BALANCE", details: { usdcRequiredMicro: (BigInt(fee.amount_in) + buys).toString() } });
    expect(await groupRows(op.id)).toHaveLength(0);
    expect((await legs(op.id)).find((l) => l.id === fee.id)).toMatchObject({ status: "PLANNED", group_id: null });
  });

  it("counts every leg the fee unlocks, covered ones too (the next group buys them all), for sign_and_send and single (review m1)", async () => {
    for (const tier of ["sign_and_send", "single"]) {
      await resetDb();
      const { user, chain, op } = await arrange();
      const assets = (await legs(op.id)).filter((l) => l.kind !== "network_fee");
      // The first two buys are covered already (an earlier fee); the fee-only group charges the shares of the last two.
      await adminSql`UPDATE app.operation_legs SET fee_covered_by = ${op.legs[0].id} WHERE id IN ${adminSql(assets.slice(0, 2).map((l) => l.id))}`;
      const fee = assets.slice(2).reduce((t, l) => t + Object.values(l.fee_share ?? {}).reduce((u, v) => u + BigInt(v), 0n), 0n);
      const all = assets.reduce((t, l) => t + BigInt(l.amount_in), 0n);
      chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), fee + all - 1n);
      const res = await groupReq(user.h, op.id, req({ tier }));
      expect(res.status).toBe(409);
      expect(res.body.error).toMatchObject({ code: "INSUFFICIENT_BALANCE", details: { usdcRequiredMicro: (fee + all).toString() } });
      expect(await groupRows(op.id)).toHaveLength(0);
    }
  });

  it("refuses with SOL_REQUIRED when the wallet has SOL for the fee transaction but not for the buys it covers", async () => {
    const { user, chain, op } = await arrange();
    const forBuys = (await legs(op.id)).filter((l) => l.kind !== "network_fee").reduce((t, l) => t + BigInt((l.expected_tx as { userLamports?: string }).userLamports!), 0n);
    // What the fee transaction alone needs (plus the buffer), as the fee-only group reports it.
    const feeAlone = BigInt((await groupReq(user.h, op.id, req())).body.solRequiredLamports);
    chain.balances.set(balanceKey(user.solanaAddress, null), feeAlone);
    const short = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }));
    expect(short.status).toBe(409);
    expect(short.body.error).toMatchObject({ code: "SOL_REQUIRED", details: { lamportsRequired: (feeAlone + forBuys).toString(), lamportsHeld: feeAlone.toString() } });
    expect((await groupRows(op.id)).map((g) => g.status)).toEqual(["EXPIRED"]); // the first group, replaced; no new one
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

  it("a landed message that is not the prepared one writes tx_mismatch_after_send and logs an error; the asset leg becomes UNKNOWN, not a settlement", async () => {
    const error = vi.spyOn(logger, "error");
    const legId = await sentAndFailed((_own, other) => landedAs(other.serializedBase64));
    await trackLeg(legId);
    expect(await audits(legId)).toHaveLength(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect((await adminSql<{ status: string; failure_reason: string }[]>`SELECT status, failure_reason FROM app.operation_legs WHERE id = ${legId}`)[0]).toMatchObject({ status: "UNKNOWN", failure_reason: "TX_MISMATCH_AFTER_SEND" });
  });

  it("the prepared message, or one that differs only in ComputeBudget, raises nothing", async () => {
    const error = vi.spyOn(logger, "error");
    const legId = await sentAndFailed((own) => landedAs(own.serializedBase64, (ix) => [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ...ix]));
    await trackLeg(legId);
    expect(await audits(legId)).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
    expect((await adminSql<{ status: string }[]>`SELECT status FROM app.operation_legs WHERE id = ${legId}`)[0]!.status).toBe("FAILED"); // it failed on chain, and it is ours
  });
});

describe("a reported signature must be our prepared transaction before it gates or settles anything", () => {
  const count = async (table: string) => Number((await adminSql<{ n: string }[]>`SELECT count(*) AS n FROM ${adminSql(`app.${table}`)}`)[0]!.n);
  const row = async (legId: string) => (await adminSql<{ status: string; failure_reason: string | null }[]>`SELECT status, failure_reason FROM app.operation_legs WHERE id = ${legId}`)[0]!;
  /** The fee-only group claimed and reported with the wallet's signature; the fee is confirmed in the signature status. */
  async function feeReported() {
    const ctx = await arrange();
    const g1 = (await groupReq(ctx.user.h, ctx.op.id, req())).body as { groupId: string; transactions: Tx[] };
    await step(ctx.user.h, ctx.op.id, g1.groupId, "claim");
    const body = sentBody(g1.transactions, ctx.wallet);
    expect((await step(ctx.user.h, ctx.op.id, g1.groupId, "sent", body)).status).toBe(200);
    const fee = g1.transactions[0]!;
    return { ...ctx, fee, signature: body.signatures[0]!.signature, unrelated: landedAs(fee.serializedBase64, (ix) => ix.slice(0, 2)) }; // the same payer and blockhash, none of the transfers
  }

  it("(gate) an unrelated confirmed signature for the fee is 409 TX_MISMATCH and no asset group is formed; unreadable or missing keeps it fee_confirming", async () => {
    const { user, op, fee, unrelated } = await feeReported();
    vi.mocked(connection.getTransaction).mockResolvedValue(unrelated);
    const mismatch = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("TX_MISMATCH");
    expect(await groupRows(op.id)).toHaveLength(1);

    // Fails closed: an RPC error or nothing fetched yet never count as landed.
    for (const lookup of [() => vi.mocked(connection.getTransaction).mockRejectedValue(new Error("rpc down")), () => vi.mocked(connection.getTransaction).mockResolvedValue(null as never)]) {
      lookup();
      const waiting = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-cccccccc" }));
      expect(waiting.status).toBe(409);
      expect(waiting.body.error).toMatchObject({ code: "OPERATION_IN_PROGRESS", details: { reason: "fee_confirming" } });
      expect(await groupRows(op.id)).toHaveLength(1);
    }

    vi.mocked(connection.getTransaction).mockResolvedValue(landedAs(fee.serializedBase64));
    expect((await groupReq(user.h, op.id, req({ idempotencyKey: "grp-dddddddd" }))).status).toBe(200); // ours: the next group is formed
  });

  it("(gate) the fee payer must be the user's address", async () => {
    const { user, op, fee } = await feeReported();
    const other = (await import("@solana/web3.js")).Keypair.generate().publicKey;
    // Same instructions, another payer: the message differs (payer and accounts), so it is not ours.
    const decompiled = TransactionMessage.decompile(VersionedTransaction.deserialize(Buffer.from(fee.serializedBase64, "base64")).message);
    const foreign = { transaction: { message: new TransactionMessage({ payerKey: other, recentBlockhash: decompiled.recentBlockhash, instructions: decompiled.instructions }).compileToV0Message(), signatures: [] }, slot: 1, meta: null } as never;
    vi.mocked(connection.getTransaction).mockResolvedValue(foreign);
    expect((await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }))).body.error.code).toBe("TX_MISMATCH");
  });

  /** The fee as a wallet that added a Memo instruction would land it: the transfers happened, but the message is not the prepared one. */
  const withMemo = (feeTx: Tx) => landedAs(feeTx.serializedBase64, (ix) => [...ix, new TransactionInstruction({ programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"), keys: [], data: Buffer.from("added by the wallet") })]);
  /** A reported fee that finalized with a message that is not the prepared one, after the tracker made it UNKNOWN; and the ops resolve call for it. */
  async function mismatchedFee() {
    const ctx = await feeReported();
    ctx.chain.solanaFinality.set(ctx.signature, "finalized");
    vi.mocked(connection.getTransaction).mockResolvedValue(withMemo(ctx.fee));
    await trackLeg(ctx.fee.legId);
    const admin = await opsUser(app, "ops_admin");
    const resolve = (status: "SETTLED" | "FAILED") => post(admin.h, `/v1/ops/operations/${ctx.op.id}/legs/${ctx.fee.legId}/resolve`, { status, txEvidence: ctx.signature, reason: "Checked on the explorer by ops." });
    return { ...ctx, resolve };
  }

  it("(ops) a mismatched fee can be resolved FAILED although its transaction finalized (it is not ours); the next group then charges its legs again (review I-A)", async () => {
    const { user, op, fee, resolve } = await mismatchedFee();
    expect((await resolve("FAILED")).status).toBe(200);
    expect((await row(fee.legId)).status).toBe("FAILED");
    const again = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }));
    expect(again.status).toBe(200);
    expect(kinds(again.body.transactions)).toEqual(["fee"]);
  });

  it("(ops) SETTLED for a mismatched fee needs the chain to show every charged amount reaching its recipient in that transaction (review I-A)", async () => {
    const { chain, op, fee, signature, resolve } = await mismatchedFee();
    expect((await resolve("SETTLED")).status).toBe(409); // a forged signature: nothing reached the recipients
    expect(await count("operation_fee_charges")).toBe(0);
    expect((await row(fee.legId)).status).toBe("UNKNOWN");
    const charges = (await legs(op.id)).find((l) => l.id === fee.legId)!.route_summary!.feeCharges!;
    const recipients = await adminSql<{ kind: string; recipient_address: string }[]>`SELECT kind, recipient_address FROM app.operation_fees WHERE operation_id = ${op.id}`;
    const due = new Map<string, bigint>();
    for (const r of recipients) if (charges[r.kind]) due.set(r.recipient_address, (due.get(r.recipient_address) ?? 0n) + BigInt(charges[r.kind]!));
    const [first, ...rest] = [...due];
    chain.solanaReceived.set(`${signature}:${first![0]}`, first![1]);
    if (rest.length) expect((await resolve("SETTLED")).status).toBe(409); // one transfer is not all of them
    for (const [recipient, amount] of rest) chain.solanaReceived.set(`${signature}:${recipient}`, amount);
    expect((await resolve("SETTLED")).status).toBe(200); // an honest wallet that added an instruction: the fee was paid
    expect(await count("operation_fee_charges")).toBe(Object.values(charges).filter((v) => BigInt(v) > 0n).length);
  });

  it("(tracker) a landed fee whose message differs is UNKNOWN for ops, never FAILED (its USDC may have moved): no charge row, no new fee, the next group is a plain 409 (review I2)", async () => {
    const { user, chain, op, fee, signature } = await feeReported();
    chain.solanaFinality.set(signature, "finalized");
    vi.mocked(connection.getTransaction).mockResolvedValue(withMemo(fee));
    await trackLeg(fee.legId);
    expect(await row(fee.legId)).toEqual({ status: "UNKNOWN", failure_reason: "TX_MISMATCH_AFTER_SEND" });
    expect(await count("operation_fee_charges")).toBe(0);
    const feeLegs = (await legs(op.id)).filter((l) => l.kind === "network_fee").length;
    const again = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("OPERATION_IN_PROGRESS");
    expect(again.body.error.details).toBeUndefined(); // a stop, not "fee_confirming": the web does not retry
    expect((await legs(op.id)).filter((l) => l.kind === "network_fee")).toHaveLength(feeLegs);
    expect(await groupRows(op.id)).toHaveLength(1);
    await trackLeg(fee.legId, 1); // an hourly recheck leaves it for ops
    expect((await row(fee.legId)).status).toBe("UNKNOWN");
  });

  it("(tracker) /sent stores the prepared blockhash: a reported fee that never lands fails once it expired and two minutes passed, then a new fee group follows (review I3)", async () => {
    const { user, chain, op, fee, signature } = await feeReported();
    const stored = (await legs(op.id)).find((l) => l.id === fee.legId)!.expected_tx as { recentBlockhash?: string; walletSentAt?: string };
    expect(stored.recentBlockhash).toBe(VersionedTransaction.deserialize(Buffer.from(fee.serializedBase64, "base64")).message.recentBlockhash);
    expect(Date.parse(stored.walletSentAt!)).toBeGreaterThan(Date.now() - 60_000);
    chain.signatureStatus.set(signature, "none");
    chain.solanaFinality.set(signature, "expired");
    // Within two minutes of the report a copy the wallet rebuilt with a newer blockhash could still land: not final yet (the queue retries).
    await expect(trackLeg(fee.legId)).rejects.toThrow();
    expect((await row(fee.legId)).status).toBe("SUBMITTED");
    expect(vi.mocked(solanaFinality)).toHaveBeenCalledWith(signature, stored.recentBlockhash);
    await adminSql`UPDATE app.operation_legs SET expected_tx = jsonb_set(expected_tx, '{walletSentAt}', to_jsonb(${new Date(Date.now() - 180_000).toISOString()}::text)) WHERE id = ${fee.legId}`;
    await trackLeg(fee.legId);
    expect((await row(fee.legId)).status).toBe("FAILED");
    const again = await groupReq(user.h, op.id, req({ idempotencyKey: "grp-bbbbbbbb" }));
    expect(again.status).toBe(200);
    expect(kinds(again.body.transactions)).toEqual(["fee"]); // the dropped fee covered nothing: its shares are charged by a new one
  });

  it("(tracker) fails closed: an RPC error or a transaction not yet visible leaves the fee and an asset leg pending, never settled or ledgered", async () => {
    const { chain, fee, signature } = await feeReported();
    chain.solanaFinality.set(signature, "finalized");
    for (const lookup of [() => vi.mocked(connection.getTransaction).mockRejectedValue(new Error("rpc down")), () => vi.mocked(connection.getTransaction).mockResolvedValue(null as never)]) {
      lookup();
      await expect(trackLeg(fee.legId)).rejects.toThrow(); // retried by the queue
      await trackLeg(fee.legId, 1); // an hourly recheck never throws
      expect(await row(fee.legId)).toEqual({ status: "SUBMITTED", failure_reason: null });
    }
    expect(await count("operation_fee_charges")).toBe(0);

    await resetDb();
    const ctx = await arrangeAssets();
    await step(ctx.user.h, ctx.op.id, ctx.group.groupId, "claim");
    const body = sentBody(ctx.group.transactions, ctx.wallet);
    await step(ctx.user.h, ctx.op.id, ctx.group.groupId, "sent", { signatures: body.signatures.slice(0, 1) });
    const sig = body.signatures[0]!.signature;
    ctx.chain.solanaFinality.set(sig, "finalized");
    ctx.chain.solanaReceived.set(`${sig}:${ctx.user.solanaAddress}`, 1_000_000n);
    vi.mocked(connection.getTransaction).mockRejectedValue(new Error("rpc down"));
    await expect(trackLeg(body.signatures[0]!.legId)).rejects.toThrow();
    expect((await row(body.signatures[0]!.legId)).status).toBe("SUBMITTED");
    expect(await count("position_ledger_entries")).toBe(0);
  });

  it("(tracker) a mismatched asset leg is UNKNOWN for ops: nothing is ledgered, not even by an hourly recheck or after the 30-minute window", async () => {
    const { user, chain, group, wallet, op } = await arrangeAssets();
    await step(user.h, op.id, group.groupId, "claim");
    const body = sentBody(group.transactions, wallet);
    await step(user.h, op.id, group.groupId, "sent", { signatures: body.signatures.slice(0, 2) });
    const [a, b] = body.signatures as [{ legId: string; signature: string }, { legId: string; signature: string }];
    for (const s of [a, b]) {
      chain.solanaFinality.set(s.signature, "finalized");
      chain.solanaReceived.set(`${s.signature}:${user.solanaAddress}`, 1_000_000n); // the chain does show a transfer in that transaction, but it is not ours
    }
    vi.mocked(connection.getTransaction).mockResolvedValue(landedAs(group.transactions[3]!.serializedBase64));
    await trackLeg(a.legId);
    expect(await row(a.legId)).toEqual({ status: "UNKNOWN", failure_reason: "TX_MISMATCH_AFTER_SEND" });
    await trackLeg(a.legId, 1);
    expect((await row(a.legId)).status).toBe("UNKNOWN");

    // A leg that went UNKNOWN only because tracking ran out its window gets the same proof on its recheck.
    await adminSql`UPDATE app.operation_legs SET status = 'UNKNOWN', unknown_since = now() WHERE id = ${b.legId}`;
    await trackLeg(b.legId, 1);
    expect(await row(b.legId)).toEqual({ status: "UNKNOWN", failure_reason: "TX_MISMATCH_AFTER_SEND" });
    expect(await count("position_ledger_entries")).toBe(0);
  });
});

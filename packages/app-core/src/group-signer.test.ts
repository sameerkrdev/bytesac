import { ApiError } from "@repo/api-client";
import type { GroupResponse, OperationView } from "@repo/validator";
import bs58 from "bs58";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupSignerReducer, runGroup, type GroupSignerApi, type GroupSignerEvent, type GroupSignerState } from "./group-signer";
import type { Signer } from "./leg-signer";
import { WalletRejectedError, WrongWalletError } from "./wallet";

const group = (o: Partial<GroupResponse> = {}): GroupResponse => ({
  groupId: "G1", status: "quoted", expiresAt: "2026-10-11T12:01:00.000Z", sendBy: "2026-10-11T12:00:40.000Z", priceMoved: false, approvalsEstimate: 1, solRequiredLamports: "5000000",
  transactions: [{ legId: "F", kind: "fee", serializedBase64: "tx-fee" }, { legId: "A", kind: "asset", serializedBase64: "tx-a" }, { legId: "B", kind: "asset", serializedBase64: "tx-b" }],
  legs: [], ...o,
});
const op = (o: Partial<OperationView> = {}) => ({ id: "O1", status: "IN_PROGRESS", needsAction: false, legs: [], ...o }) as OperationView;

const run = (events: GroupSignerEvent[], from: GroupSignerState = { kind: "idle" }) => events.reduce(groupSignerReducer, from);
const trace = () => { const events: GroupSignerEvent[] = []; return { events, dispatch: (e: GroupSignerEvent) => void events.push(e) }; };
const api = (o: Partial<GroupSignerApi> = {}) => ({
  requestGroup: vi.fn<GroupSignerApi["requestGroup"]>().mockResolvedValue(group()), submitGroup: vi.fn<GroupSignerApi["submitGroup"]>().mockResolvedValue(op({ status: "COMPLETED" })),
  claimGroup: vi.fn<GroupSignerApi["claimGroup"]>().mockResolvedValue(op()), sentGroup: vi.fn<GroupSignerApi["sentGroup"]>().mockResolvedValue(op({ status: "COMPLETED" })),
  releaseGroup: vi.fn<GroupSignerApi["releaseGroup"]>().mockResolvedValue(op()), ...o,
});
const signer = (o: Partial<Signer> = {}): Signer => ({
  signSolana: vi.fn(async (t: string) => `one:${t}`), signSolanaAll: vi.fn(async (ts: string[]) => ts.map((t) => `all:${t}`)), sendEvm: vi.fn(),
  signAndSendSolanaAll: vi.fn(async (ts: string[]) => ts.map((_, i) => new Uint8Array(64).fill(i + 1))), ...o,
});
const opts = (o: Partial<Parameters<typeof runGroup>[4]> = {}) => ({ tier: "sign_all" as Parameters<typeof runGroup>[4]["tier"], acceptNewPrices: vi.fn().mockResolvedValue(true), onDowngrade: vi.fn(), ...o });

describe("groupSignerReducer", () => {
  it("walks quote, sign, send, done", () => {
    expect(run([{ type: "quoteRequested" }])).toEqual({ kind: "quoting" });
    const g = group();
    expect(run([{ type: "quoteRequested" }, { type: "quoted", group: g }])).toEqual({ kind: "signing", group: g });
    expect(run([{ type: "quoteRequested" }, { type: "quoted", group: g }, { type: "signed" }])).toEqual({ kind: "sending", group: g });
    const done = op({ status: "COMPLETED" });
    expect(run([{ type: "quoteRequested" }, { type: "quoted", group: g }, { type: "signed" }, { type: "finished", op: done }])).toEqual({ kind: "done", op: done });
    const stuck = op({ needsAction: true });
    expect(run([{ type: "quoteRequested" }, { type: "quoted", group: g }, { type: "signed" }, { type: "finished", op: stuck }])).toEqual({ kind: "needsAction", op: stuck });
  });
  it("ignores a late quoted after failed", () => {
    const failed = run([{ type: "quoteRequested" }, { type: "failed", code: "X", message: "m" }]);
    expect(run([{ type: "quoted", group: group() }], failed)).toBe(failed);
  });
  it("reaches priceMoved only from quoting, and accepted moves it to signing", () => {
    const moved = group({ priceMoved: true });
    expect(run([{ type: "quoted", group: moved }])).toEqual({ kind: "idle" });
    expect(run([{ type: "quoted", group: moved }], { kind: "signing", group: moved })).toEqual({ kind: "signing", group: moved });
    const waiting = run([{ type: "quoteRequested" }, { type: "quoted", group: moved }]);
    expect(waiting).toEqual({ kind: "priceMoved", group: moved });
    expect(run([{ type: "accepted" }], waiting)).toEqual({ kind: "signing", group: moved });
    expect(run([{ type: "accepted" }])).toEqual({ kind: "idle" });
  });
});

describe("runGroup", () => {
  it("quotes, signs everything at once in response order, and submits by legId", async () => {
    const a = api(), s = signer(), t = trace();
    const out = await runGroup(a, s, "O1", t.dispatch, opts({ walletName: "Phantom" }));
    expect(a.requestGroup).toHaveBeenCalledWith("O1", { chain: "solana", tier: "sign_all", walletName: "Phantom", idempotencyKey: expect.any(String) });
    expect(s.signSolanaAll).toHaveBeenCalledWith(["tx-fee", "tx-a", "tx-b"]);
    expect(s.signSolana).not.toHaveBeenCalled();
    expect(a.submitGroup).toHaveBeenCalledWith("O1", "G1", { signed: [{ legId: "F", signedTx: "all:tx-fee" }, { legId: "A", signedTx: "all:tx-a" }, { legId: "B", signedTx: "all:tx-b" }] });
    expect(out?.status).toBe("COMPLETED");
    expect(run(t.events).kind).toBe("done");
  });

  it("ends needsAction when the operation needs action", async () => {
    const t = trace();
    const a = api({ submitGroup: vi.fn<GroupSignerApi["submitGroup"]>().mockResolvedValue(op({ needsAction: true })) });
    await runGroup(a, signer(), "O1", t.dispatch, opts());
    expect(run(t.events).kind).toBe("needsAction");
  });

  it("asks before signing when the price moved, and signs nothing when refused", async () => {
    const moved = group({ priceMoved: true });
    const a = api({ requestGroup: vi.fn<GroupSignerApi["requestGroup"]>().mockResolvedValue(moved) }), s = signer(), t = trace();
    const o = opts({ acceptNewPrices: vi.fn().mockResolvedValue(false) });
    expect(await runGroup(a, s, "O1", t.dispatch, o)).toBeNull();
    expect(o.acceptNewPrices).toHaveBeenCalledWith(moved);
    expect(s.signSolanaAll).not.toHaveBeenCalled();
    expect(s.signSolana).not.toHaveBeenCalled();
    expect(a.submitGroup).not.toHaveBeenCalled();
    expect(run(t.events)).toEqual({ kind: "idle" });
  });

  it("signs after the price was accepted", async () => {
    const a = api({ requestGroup: vi.fn<GroupSignerApi["requestGroup"]>().mockResolvedValue(group({ priceMoved: true })) }), s = signer();
    await runGroup(a, s, "O1", trace().dispatch, opts());
    expect(s.signSolanaAll).toHaveBeenCalledTimes(1);
    expect(a.submitGroup).toHaveBeenCalledTimes(1);
  });

  it("downgrades to one signature per transaction when the wallet cannot sign all, and asks for a fresh group at tier single (review I5)", async () => {
    const a = api(), t = trace(), o = opts();
    const s = signer({ signSolanaAll: vi.fn().mockRejectedValue(new Error("signAllTransactions is not supported")) });
    await runGroup(a, s, "O1", t.dispatch, o);
    expect(o.onDowngrade).toHaveBeenCalledTimes(1);
    expect(vi.mocked(a.requestGroup).mock.calls.map(([, b]) => b.tier)).toEqual(["sign_all", "single"]);
    expect(s.signSolana).toHaveBeenCalledTimes(3);
    expect(a.submitGroup).toHaveBeenCalledTimes(1);
    expect(a.submitGroup).toHaveBeenCalledWith("O1", "G1", { signed: [{ legId: "F", signedTx: "one:tx-fee" }, { legId: "A", signedTx: "one:tx-a" }, { legId: "B", signedTx: "one:tx-b" }] });
    expect(run(t.events).kind).toBe("done");
  });

  it("signs one by one at tier single, and when the signer has no signSolanaAll", async () => {
    const a = api(), s = signer();
    await runGroup(a, s, "O1", trace().dispatch, opts({ tier: "single" }));
    expect(s.signSolanaAll).not.toHaveBeenCalled();
    expect(s.signSolana).toHaveBeenCalledTimes(3);
    const bare = signer({ signSolanaAll: undefined }), o = opts(), b = api();
    await runGroup(b, bare, "O1", trace().dispatch, o);
    expect(bare.signSolana).toHaveBeenCalledTimes(3);
    expect(o.onDowngrade).toHaveBeenCalledTimes(1);
    expect(b.requestGroup).toHaveBeenCalledTimes(1); // known before the quote: the first group is already a single-tier one
    expect(b.requestGroup).toHaveBeenCalledWith("O1", expect.objectContaining({ tier: "single" }));
  });

  it("a rejected popup does not downgrade and ends failed", async () => {
    const a = api(), t = trace(), o = opts();
    const s = signer({ signSolanaAll: vi.fn().mockRejectedValue(new WalletRejectedError()) });
    expect(await runGroup(a, s, "O1", t.dispatch, o)).toBeNull();
    expect(o.onDowngrade).not.toHaveBeenCalled();
    expect(s.signSolana).not.toHaveBeenCalled();
    expect(a.submitGroup).not.toHaveBeenCalled();
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "WALLET_REJECTED" });
  });

  it("GROUP_EXPIRED from submit ends failed and is not retried", async () => {
    const t = trace();
    const a = api({ submitGroup: vi.fn<GroupSignerApi["submitGroup"]>().mockRejectedValue(new ApiError("GROUP_EXPIRED", 409, "expired")) });
    expect(await runGroup(a, signer(), "O1", t.dispatch, opts())).toBeNull();
    expect(a.submitGroup).toHaveBeenCalledTimes(1);
    expect(a.requestGroup).toHaveBeenCalledTimes(1);
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "GROUP_EXPIRED" });
  });

  it("keeps the API error details so the shortfall can be shown", async () => {
    const t = trace();
    const details = { lamportsRequired: "5000000", lamportsHeld: "800000" };
    const a = api({ requestGroup: vi.fn<GroupSignerApi["requestGroup"]>().mockRejectedValue(new ApiError("SOL_REQUIRED", 409, "need SOL", undefined, details)) });
    await runGroup(a, signer(), "O1", t.dispatch, opts());
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "SOL_REQUIRED", details });
  });
});

describe("runGroup at tier sign_and_send", () => {
  const sig = (i: number) => new Uint8Array(64).fill(i);
  const sendOpts = () => opts({ tier: "sign_and_send", walletName: "MetaMask" });

  it("claims before the wallet opens and reports the signatures in transaction order, base58", async () => {
    const a = api(), s = signer(), t = trace();
    const out = await runGroup(a, s, "O1", t.dispatch, sendOpts());
    expect(a.requestGroup).toHaveBeenCalledWith("O1", { chain: "solana", tier: "sign_and_send", walletName: "MetaMask", idempotencyKey: expect.any(String) });
    expect(a.claimGroup).toHaveBeenCalledWith("O1", "G1");
    expect(s.signAndSendSolanaAll).toHaveBeenCalledWith(["tx-fee", "tx-a", "tx-b"]);
    expect(vi.mocked(a.claimGroup).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(s.signAndSendSolanaAll!).mock.invocationCallOrder[0]!);
    expect(a.sentGroup).toHaveBeenCalledWith("O1", "G1", { signatures: [{ legId: "F", signature: bs58.encode(sig(1)) }, { legId: "A", signature: bs58.encode(sig(2)) }, { legId: "B", signature: bs58.encode(sig(3)) }] });
    expect(vi.mocked(s.signAndSendSolanaAll!).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(a.sentGroup).mock.invocationCallOrder[0]!);
    expect(a.submitGroup).not.toHaveBeenCalled();
    expect(s.signSolanaAll).not.toHaveBeenCalled();
    expect(out?.status).toBe("COMPLETED");
    expect(run(t.events).kind).toBe("done");
  });

  it("reports only the signatures the wallet returned", async () => {
    const a = api();
    await runGroup(a, signer({ signAndSendSolanaAll: vi.fn().mockResolvedValue([sig(1)]) }), "O1", trace().dispatch, sendOpts());
    expect(a.sentGroup).toHaveBeenCalledWith("O1", "G1", { signatures: [{ legId: "F", signature: bs58.encode(sig(1)) }] });
  });

  it("a rejection releases the claim, ends WALLET_REJECTED and does not downgrade", async () => {
    const a = api(), t = trace(), o = sendOpts();
    const s = signer({ signAndSendSolanaAll: vi.fn().mockRejectedValue(new WalletRejectedError()) });
    expect(await runGroup(a, s, "O1", t.dispatch, o)).toBeNull();
    expect(a.releaseGroup).toHaveBeenCalledWith("O1", "G1");
    expect(o.onDowngrade).not.toHaveBeenCalled();
    expect(a.requestGroup).toHaveBeenCalledTimes(1);
    expect(a.sentGroup).not.toHaveBeenCalled();
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "WALLET_REJECTED" });
  });

  it("a wrong wallet (nothing was opened) releases the claim too", async () => {
    const a = api(), t = trace();
    await runGroup(a, signer({ signAndSendSolanaAll: vi.fn().mockRejectedValue(new WrongWalletError("Connect MetaMask")) }), "O1", t.dispatch, sendOpts());
    expect(a.releaseGroup).toHaveBeenCalledTimes(1);
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "WRONG_WALLET" });
  });

  it("any other wallet error ends OUTCOME_UNKNOWN and keeps the claim (no release)", async () => {
    const a = api(), t = trace();
    const s = signer({ signAndSendSolanaAll: vi.fn().mockRejectedValue(new Error("socket closed")) });
    expect(await runGroup(a, s, "O1", t.dispatch, sendOpts())).toBeNull();
    expect(a.releaseGroup).not.toHaveBeenCalled();
    expect(a.sentGroup).not.toHaveBeenCalled();
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "OUTCOME_UNKNOWN", message: "Confirming with the network — don't sign again" });
  });

  it("a network failure while reporting the signatures is also OUTCOME_UNKNOWN; a server answer keeps its own code", async () => {
    const t = trace();
    await runGroup(api({ sentGroup: vi.fn().mockRejectedValue(new TypeError("fetch failed")) }), signer(), "O1", t.dispatch, sendOpts());
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "OUTCOME_UNKNOWN" });
    const u = trace(), a = api({ sentGroup: vi.fn().mockRejectedValue(new ApiError("TX_MISMATCH", 409, "no")) });
    await runGroup(a, signer(), "O1", u.dispatch, sendOpts());
    expect(a.releaseGroup).not.toHaveBeenCalled();
    expect(run(u.events)).toMatchObject({ kind: "failed", code: "TX_MISMATCH" });
  });

  it("an expired claim ends GROUP_EXPIRED without opening the wallet", async () => {
    const t = trace(), s = signer();
    const a = api({ claimGroup: vi.fn().mockRejectedValue(new ApiError("GROUP_EXPIRED", 409, "expired")) });
    await runGroup(a, s, "O1", t.dispatch, sendOpts());
    expect(s.signAndSendSolanaAll).not.toHaveBeenCalled();
    expect(a.releaseGroup).not.toHaveBeenCalled();
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "GROUP_EXPIRED" });
  });
});

describe("runGroup waiting for the previous fee", () => {
  afterEach(() => vi.useRealTimers());
  const confirming = () => new ApiError("OPERATION_IN_PROGRESS", 409, "busy", undefined, { reason: "fee_confirming" });

  it("repeats the request every second until it passes, with one idempotency key", async () => {
    vi.useFakeTimers();
    const t = trace();
    const a = api({ requestGroup: vi.fn<GroupSignerApi["requestGroup"]>().mockRejectedValueOnce(confirming()).mockRejectedValueOnce(confirming()).mockResolvedValue(group()) });
    const p = runGroup(a, signer(), "O1", t.dispatch, opts());
    await vi.advanceTimersByTimeAsync(999);
    expect(a.requestGroup).toHaveBeenCalledTimes(1);
    expect(run(t.events).kind).toBe("feeConfirming");
    await vi.advanceTimersByTimeAsync(1);
    expect(a.requestGroup).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p)?.status).toBe("COMPLETED");
    expect(a.requestGroup).toHaveBeenCalledTimes(3);
    expect(new Set(vi.mocked(a.requestGroup).mock.calls.map(([, b]) => b.idempotencyKey)).size).toBe(1);
    expect(run(t.events).kind).toBe("done");
  });

  it("gives up after 60 seconds with the server's error", async () => {
    vi.useFakeTimers();
    const t = trace();
    const a = api({ requestGroup: vi.fn<GroupSignerApi["requestGroup"]>().mockRejectedValue(confirming()) });
    const p = runGroup(a, signer(), "O1", t.dispatch, opts());
    await vi.advanceTimersByTimeAsync(59_999);
    expect(a.requestGroup).toHaveBeenCalledTimes(60);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBeNull();
    expect(a.requestGroup).toHaveBeenCalledTimes(61);
    expect(run(t.events)).toMatchObject({ kind: "failed", code: "OPERATION_IN_PROGRESS" });
  });

  it("does not retry a plain OPERATION_IN_PROGRESS or a TX_MISMATCH", async () => {
    for (const err of [new ApiError("OPERATION_IN_PROGRESS", 409, "busy"), new ApiError("TX_MISMATCH", 409, "no", undefined, { reason: "fee_confirming" })]) {
      const t = trace(), a = api({ requestGroup: vi.fn<GroupSignerApi["requestGroup"]>().mockRejectedValue(err) });
      expect(await runGroup(a, signer(), "O1", t.dispatch, opts())).toBeNull();
      expect(a.requestGroup).toHaveBeenCalledTimes(1);
      expect(run(t.events)).toMatchObject({ kind: "failed", code: err.code });
    }
  });
});

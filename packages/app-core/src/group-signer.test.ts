import { ApiError } from "@repo/api-client";
import type { GroupResponse, OperationView } from "@repo/validator";
import { describe, expect, it, vi } from "vitest";
import { groupSignerReducer, runGroup, type GroupSignerApi, type GroupSignerEvent, type GroupSignerState } from "./group-signer";
import type { Signer } from "./leg-signer";
import { WalletRejectedError } from "./wallet";

const group = (o: Partial<GroupResponse> = {}): GroupResponse => ({
  groupId: "G1", status: "quoted", expiresAt: "2026-10-11T12:01:00.000Z", sendBy: "2026-10-11T12:00:40.000Z", priceMoved: false, approvalsEstimate: 1, solRequiredLamports: "5000000",
  transactions: [{ legId: "F", kind: "fee", serializedBase64: "tx-fee" }, { legId: "A", kind: "asset", serializedBase64: "tx-a" }, { legId: "B", kind: "asset", serializedBase64: "tx-b" }],
  legs: [], ...o,
});
const op = (o: Partial<OperationView> = {}) => ({ id: "O1", status: "IN_PROGRESS", needsAction: false, legs: [], ...o }) as OperationView;

const run = (events: GroupSignerEvent[], from: GroupSignerState = { kind: "idle" }) => events.reduce(groupSignerReducer, from);
const trace = () => { const events: GroupSignerEvent[] = []; return { events, dispatch: (e: GroupSignerEvent) => void events.push(e) }; };
const api = (o: Partial<GroupSignerApi> = {}) => ({
  requestGroup: vi.fn<GroupSignerApi["requestGroup"]>().mockResolvedValue(group()), submitGroup: vi.fn<GroupSignerApi["submitGroup"]>().mockResolvedValue(op({ status: "COMPLETED" })), ...o,
});
const signer = (o: Partial<Signer> = {}): Signer => ({
  signSolana: vi.fn(async (t: string) => `one:${t}`), signSolanaAll: vi.fn(async (ts: string[]) => ts.map((t) => `all:${t}`)), sendEvm: vi.fn(), ...o,
});
const opts = (o: Partial<Parameters<typeof runGroup>[4]> = {}) => ({ tier: "sign_all" as const, acceptNewPrices: vi.fn().mockResolvedValue(true), onDowngrade: vi.fn(), ...o });

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

  it("downgrades to one signature per transaction when the wallet cannot sign all", async () => {
    const a = api(), t = trace(), o = opts();
    const s = signer({ signSolanaAll: vi.fn().mockRejectedValue(new Error("signAllTransactions is not supported")) });
    await runGroup(a, s, "O1", t.dispatch, o);
    expect(o.onDowngrade).toHaveBeenCalledTimes(1);
    expect(s.signSolana).toHaveBeenCalledTimes(3);
    expect(a.submitGroup).toHaveBeenCalledWith("O1", "G1", { signed: [{ legId: "F", signedTx: "one:tx-fee" }, { legId: "A", signedTx: "one:tx-a" }, { legId: "B", signedTx: "one:tx-b" }] });
    expect(run(t.events).kind).toBe("done");
  });

  it("signs one by one at tier single, and when the signer has no signSolanaAll", async () => {
    const a = api(), s = signer();
    await runGroup(a, s, "O1", trace().dispatch, opts({ tier: "single" }));
    expect(s.signSolanaAll).not.toHaveBeenCalled();
    expect(s.signSolana).toHaveBeenCalledTimes(3);
    const bare = signer({ signSolanaAll: undefined }), o = opts();
    await runGroup(api(), bare, "O1", trace().dispatch, o);
    expect(bare.signSolana).toHaveBeenCalledTimes(3);
    expect(o.onDowngrade).toHaveBeenCalledTimes(1);
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

import { ApiError } from "@repo/api-client";
import type { Leg, LegQuoteResponse, OperationView } from "@repo/validator";
import { describe, expect, it, vi } from "vitest";
import {
  GasDropError, initialLegSignerState, legErrorInfo, legSignerReducer, nextLeg, prepareLeg, runLeg, signLeg,
  type LegSignerEvent, type LegSignerState, type Prepared, type Signer,
} from "./leg-signer";
import { WalletRejectedError, WrongWalletError } from "./wallet";

const leg = (o: Partial<Leg> = {}) => ({ id: "L1", sequence: 1, kind: "cross_chain", status: "PLANNED", recoveryToken: null, ...o }) as Leg;
const op = (o: Partial<OperationView> = {}) => ({ id: "O1", status: "IN_PROGRESS", legs: [leg()], ...o }) as OperationView;
const quote = (o: Partial<LegQuoteResponse> = {}): LegQuoteResponse => ({ legId: "L1", estimatedOut: "100", minOut: "99", quoteExpiresAt: null, transaction: { kind: "solana", serializedBase64: "AAEC" }, approval: null, gasDrop: null, ...o });
const evm = { kind: "evm" as const, to: "0xto", data: "0x01", value: "0", chainId: 8453 };
const approval = { token: "0xt", spender: "0xs", amount: "5" };

const run = (events: LegSignerEvent[], from: LegSignerState = initialLegSignerState) => events.reduce(legSignerReducer, from);
const trace = () => { const events: LegSignerEvent[] = []; return { events, dispatch: (e: LegSignerEvent) => void events.push(e) }; };
const api = () => ({ getOperation: vi.fn().mockResolvedValue(op()), quoteLeg: vi.fn().mockResolvedValue(quote()), submitLeg: vi.fn().mockResolvedValue(op()) });
const signer = (o: Partial<Signer> = {}): Signer => ({ signSolana: vi.fn().mockResolvedValue("signed"), sendEvm: vi.fn().mockResolvedValue("0xhash"), ...o });
const prepared = (q: Partial<LegQuoteResponse> = {}): Prepared => { const full = quote(q); return { leg: leg(), q: { ...full, transaction: full.transaction! } }; };
const ready: LegSignerEvent = { type: "quoteReady", estimatedOut: "1", minOut: "1" };

describe("legSignerReducer", () => {
  it("walks the happy path idle to done", () => {
    expect(run([{ type: "quoteRequested" }])).toEqual({ kind: "quoting" });
    expect(run([{ type: "quoteRequested" }, { type: "quoteReady", estimatedOut: "100", minOut: "99" }])).toEqual({ kind: "confirmPrice", estimatedOut: "100", minOut: "99" });
    expect(run([{ type: "quoteRequested" }, ready, { type: "confirmed" }])).toEqual({ kind: "signing" });
    expect(run([{ type: "quoteRequested" }, ready, { type: "confirmed" }, { type: "signed" }])).toEqual({ kind: "submitting" });
    expect(run([{ type: "quoteRequested" }, ready, { type: "confirmed" }, { type: "signed" }, { type: "submitted" }])).toEqual({ kind: "tracking" });
    expect(run([{ type: "quoteRequested" }, ready, { type: "confirmed" }, { type: "signed" }, { type: "submitted" }, { type: "settled" }])).toEqual({ kind: "done" });
  });
  it("waits for a gas drop, keeping its hash", () => {
    expect(run([{ type: "quoteRequested" }, { type: "gasDropPending", txHash: "0xg" }])).toEqual({ kind: "awaitingGasDrop", txHash: "0xg" });
    expect(run([{ type: "quoteRequested" }, { type: "gasDropPending", txHash: null }, { type: "quoteReady", estimatedOut: null, minOut: null }])).toEqual({ kind: "confirmPrice", estimatedOut: "", minOut: "" });
  });
  it("fails from anywhere, hands off to the web, and resets", () => {
    expect(run([{ type: "failed", code: "PRICE_MOVED", message: "m" }], { kind: "signing" })).toEqual({ kind: "failed", code: "PRICE_MOVED", message: "m" });
    expect(run([{ type: "handoff", url: "/p" }], { kind: "signing" })).toEqual({ kind: "handoffWeb", url: "/p" });
    expect(run([{ type: "reset" }], { kind: "done" })).toEqual({ kind: "idle" });
  });
  it("starts a new quote after a failure or a finished leg (re-quote, next leg)", () => {
    expect(run([{ type: "quoteRequested" }], { kind: "failed", code: "QUOTE_EXPIRED", message: "" })).toEqual({ kind: "quoting" });
    expect(run([{ type: "quoteRequested" }], { kind: "tracking" })).toEqual({ kind: "quoting" });
  });
  it("ignores an event that does not follow the current state", () => {
    expect(run([{ type: "signed" }])).toEqual({ kind: "idle" });
    expect(run([{ type: "confirmed" }], { kind: "quoting" })).toEqual({ kind: "quoting" });
    expect(run([{ type: "settled" }], { kind: "signing" })).toEqual({ kind: "signing" });
  });
});

describe("legErrorInfo", () => {
  it("passes every API error code through", () => {
    for (const code of ["QUOTE_EXPIRED", "PRICE_MOVED", "TX_MISMATCH", "PSBT_MISMATCH", "SOL_REQUIRED", "GAS_BUDGET_EXHAUSTED", "ROUTE_UNAVAILABLE", "INSUFFICIENT_BALANCE", "BROADCAST_REJECTED"] as const) {
      expect(legErrorInfo(new ApiError(code, 409, "msg"))).toEqual({ code, message: "msg" });
    }
  });
  it("names wallet, gas-drop and unknown failures", () => {
    expect(legErrorInfo(new WalletRejectedError()).code).toBe("WALLET_REJECTED");
    expect(legErrorInfo(new WrongWalletError("Solana wallet")).code).toBe("WRONG_WALLET");
    expect(legErrorInfo(new GasDropError("x"))).toEqual({ code: "GAS_DROP_UNCONFIRMED", message: "x" });
    expect(legErrorInfo("boom").code).toBe("INTERNAL");
  });
});

describe("prepareLeg", () => {
  it("quotes once and shows the fresh figures", async () => {
    const a = api(); const t = trace();
    const p = await prepareLeg(a, "O1", leg(), t.dispatch);
    expect(p.q.transaction.kind).toBe("solana");
    expect(t.events.map((e) => e.type)).toEqual(["quoteRequested", "quoteReady"]);
    expect(t.events[1]).toEqual({ type: "quoteReady", estimatedOut: "100", minOut: "99" });
  });
  it("polls the gas top-up until the transaction arrives", async () => {
    const a = api(); const t = trace(); const sleep = vi.fn().mockResolvedValue(undefined);
    a.quoteLeg.mockResolvedValueOnce(quote({ transaction: null, gasDrop: { status: "pending", txHash: "0xg" } })).mockResolvedValueOnce(quote({ transaction: evm, approval }));
    const p = await prepareLeg(a, "O1", leg(), t.dispatch, { sleep });
    expect(a.quoteLeg).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(3000);
    expect(t.events.map((e) => e.type)).toEqual(["quoteRequested", "gasDropPending", "quoteReady"]);
    expect(p.q.approval).toEqual(approval);
  });
  it("gives up when the gas top-up never confirms", async () => {
    const a = api(); const t = trace();
    a.quoteLeg.mockResolvedValue(quote({ transaction: null, gasDrop: { status: "pending", txHash: null } }));
    await expect(prepareLeg(a, "O1", leg(), t.dispatch, { sleep: async () => {}, maxPolls: 2 })).rejects.toBeInstanceOf(GasDropError);
    expect(a.quoteLeg).toHaveBeenCalledTimes(3);
    expect(t.events.at(-1)).toMatchObject({ type: "failed", code: "GAS_DROP_UNCONFIRMED" });
  });
  it("fails without polling when the gas drop failed", async () => {
    const a = api(); const t = trace();
    a.quoteLeg.mockResolvedValue(quote({ transaction: null, gasDrop: { status: "failed", txHash: null } }));
    await expect(prepareLeg(a, "O1", leg(), t.dispatch)).rejects.toBeInstanceOf(GasDropError);
    expect(a.quoteLeg).toHaveBeenCalledTimes(1);
  });
  it.each(["PRICE_MOVED", "QUOTE_EXPIRED", "SOL_REQUIRED", "GAS_BUDGET_EXHAUSTED", "ROUTE_UNAVAILABLE"] as const)("surfaces %s from the quote", async (code) => {
    const a = api(); const t = trace();
    a.quoteLeg.mockRejectedValue(new ApiError(code, 409, "m"));
    await expect(prepareLeg(a, "O1", leg(), t.dispatch)).rejects.toBeInstanceOf(ApiError);
    expect(t.events.at(-1)).toEqual({ type: "failed", code, message: "m" });
  });
});

describe("signLeg", () => {
  it("signs a Solana transaction and submits it", async () => {
    const a = api(); const s = signer(); const t = trace();
    await signLeg(a, s, "O1", prepared(), t.dispatch, "/web");
    expect(s.signSolana).toHaveBeenCalledWith("AAEC");
    expect(a.submitLeg).toHaveBeenCalledWith("O1", "L1", { signedTx: "signed" });
    expect(t.events.map((e) => e.type)).toEqual(["confirmed", "signed", "submitted"]);
  });
  it("sends the EVM transaction with its approval and submits the hash", async () => {
    const a = api(); const s = signer(); const t = trace();
    await signLeg(a, s, "O1", prepared({ transaction: evm, approval }), t.dispatch, "/web");
    expect(s.sendEvm).toHaveBeenCalledWith({ ...evm, approval });
    expect(a.submitLeg).toHaveBeenCalledWith("O1", "L1", { txHash: "0xhash" });
  });
  it("signs a Bitcoin PSBT when the wallet can", async () => {
    const a = api(); const signPsbt = vi.fn().mockResolvedValue("psbt2"); const t = trace();
    await signLeg(a, signer({ signPsbt }), "O1", prepared({ transaction: { kind: "bitcoin", psbtBase64: "cHNidA==", inputCount: 2 } }), t.dispatch, "/web");
    expect(signPsbt).toHaveBeenCalledWith("cHNidA==", 2);
    expect(a.submitLeg).toHaveBeenCalledWith("O1", "L1", { signedPsbt: "psbt2" });
  });
  it("hands a Bitcoin leg to the web without signPsbt, signing and submitting nothing", async () => {
    const a = api(); const s = signer(); const t = trace();
    const result = await signLeg(a, s, "O1", prepared({ transaction: { kind: "bitcoin", psbtBase64: "x", inputCount: 1 } }), t.dispatch, "/portfolio#operation-O1");
    expect(result).toBeNull();
    expect(t.events).toEqual([{ type: "handoff", url: "/portfolio#operation-O1" }]);
    expect(a.submitLeg).not.toHaveBeenCalled();
    expect(s.signSolana).not.toHaveBeenCalled();
  });
  it("submits nothing when the wallet refuses", async () => {
    const a = api(); const t = trace();
    await expect(signLeg(a, signer({ signSolana: vi.fn().mockRejectedValue(new WalletRejectedError()) }), "O1", prepared(), t.dispatch, "/web")).rejects.toBeInstanceOf(WalletRejectedError);
    expect(a.submitLeg).not.toHaveBeenCalled();
    expect(t.events.at(-1)).toMatchObject({ type: "failed", code: "WALLET_REJECTED" });
  });
  it.each(["QUOTE_EXPIRED", "TX_MISMATCH", "PSBT_MISMATCH", "PRICE_MOVED", "BROADCAST_REJECTED"] as const)("surfaces %s from the submit without retrying", async (code) => {
    const a = api(); const t = trace();
    a.submitLeg.mockRejectedValue(new ApiError(code, 409, "m"));
    await expect(signLeg(a, signer(), "O1", prepared(), t.dispatch, "/web")).rejects.toBeInstanceOf(ApiError);
    expect(a.submitLeg).toHaveBeenCalledTimes(1);
    expect(t.events.at(-1)).toEqual({ type: "failed", code, message: "m" });
  });
});

describe("runLeg", () => {
  it("opens the wallet only after the user confirms the fresh figures", async () => {
    const a = api(); const s = signer(); const t = trace();
    a.submitLeg.mockResolvedValue(op({ status: "COMPLETED" }));
    const confirm = vi.fn().mockImplementation(async () => { expect(s.signSolana).not.toHaveBeenCalled(); return true; });
    await runLeg(a, s, "O1", "L1", t.dispatch, { confirm, handoffUrl: "/w" });
    expect(confirm).toHaveBeenCalledWith({ estimatedOut: "100", minOut: "99" });
    expect(s.signSolana).toHaveBeenCalled();
    expect(run(t.events)).toEqual({ kind: "done" });
  });
  it("signs nothing when the user declines", async () => {
    const a = api(); const s = signer(); const t = trace();
    expect(await runLeg(a, s, "O1", "L1", t.dispatch, { confirm: async () => false, handoffUrl: "/w" })).toBeNull();
    expect(s.signSolana).not.toHaveBeenCalled();
    expect(a.submitLeg).not.toHaveBeenCalled();
    expect(run(t.events)).toEqual({ kind: "idle" });
  });
  it("stays tracking while the operation is not complete", async () => {
    const a = api(); const t = trace();
    await runLeg(a, signer(), "O1", "L1", t.dispatch, { confirm: async () => true, handoffUrl: "/w" });
    expect(run(t.events)).toEqual({ kind: "tracking" });
  });
  it("surfaces a failure of the first getOperation call instead of staying idle", async () => {
    const a = api(); const t = trace();
    a.getOperation.mockRejectedValue(new ApiError("INTERNAL", 500, "offline"));
    await expect(runLeg(a, signer(), "O1", "L1", t.dispatch, { confirm: async () => true, handoffUrl: "/w" })).rejects.toBeInstanceOf(ApiError);
    expect(t.events).toEqual([{ type: "failed", code: "INTERNAL", message: "offline" }]);
  });
  it("fails for a leg that is not in the operation", async () => {
    const t = trace();
    expect(await runLeg(api(), signer(), "O1", "nope", t.dispatch, { confirm: async () => true, handoffUrl: "/w" })).toBeNull();
    expect(t.events).toEqual([{ type: "failed", code: "NOT_FOUND", message: "This step is no longer part of the operation." }]);
  });
});

describe("nextLeg", () => {
  it("picks the first planned leg whose predecessors settled", () => {
    expect(nextLeg([leg({ id: "a", status: "SETTLED" }), leg({ id: "b", status: "PLANNED" }), leg({ id: "c", status: "PLANNED" })])?.id).toBe("b");
  });
  it("a network fee still pending on chain does not hold up the first asset leg", () => {
    expect(nextLeg([leg({ id: "f", kind: "network_fee", status: "PENDING_CHAIN" }), leg({ id: "b" })])?.id).toBe("b");
  });
  it("an unsettled non-fee predecessor blocks the next leg", () => {
    expect(nextLeg([leg({ id: "a", status: "SUBMITTED" }), leg({ id: "b" })])).toBeUndefined();
  });
});

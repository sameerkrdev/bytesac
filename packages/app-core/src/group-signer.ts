import { ApiError } from "@repo/api-client";
import type { GroupRequest, GroupResponse, GroupSent, GroupSubmit, OperationView } from "@repo/validator";
import bs58 from "bs58";
import { legErrorInfo, sleepMs, type Signer } from "./leg-signer";
import { WalletRejectedError, WrongWalletError } from "./wallet";

export const OUTCOME_UNKNOWN = "OUTCOME_UNKNOWN";

/** What one signing group is doing (web, Solana). The machine only displays server values; it never decides an amount. */
export type GroupSignerState =
  | { kind: "idle" }
  | { kind: "quoting" }
  /** The previous batch's fee is not confirmed on chain yet; the request is repeated (spec 22 B-26). */
  | { kind: "feeConfirming" }
  | { kind: "priceMoved"; group: GroupResponse }
  | { kind: "signing"; group: GroupResponse }
  | { kind: "sending"; group: GroupResponse }
  | { kind: "done"; op: OperationView }
  | { kind: "needsAction"; op: OperationView }
  /** `details` is the API error's extra data (the SOL shortfall of `SOL_REQUIRED`, the USDC needed). */
  | { kind: "failed"; code: string; message: string; details?: unknown };

export type GroupSignerEvent =
  | { type: "reset" }
  | { type: "quoteRequested" }
  | { type: "feeConfirming" }
  | { type: "quoted"; group: GroupResponse }
  | { type: "accepted" }
  | { type: "signed" }
  | { type: "finished"; op: OperationView }
  | { type: "failed"; code: string; message: string; details?: unknown };

export const initialGroupSignerState: GroupSignerState = { kind: "idle" };

/** Which states each event may leave; anything else is ignored (a late event never rewinds the flow). */
const FROM: Record<GroupSignerEvent["type"], GroupSignerState["kind"][] | "any"> = {
  reset: "any",
  failed: "any",
  quoteRequested: "any",
  feeConfirming: ["quoting", "feeConfirming"],
  quoted: ["quoting", "feeConfirming"],
  accepted: ["priceMoved"],
  signed: ["signing"],
  finished: ["sending"],
};

export function groupSignerReducer(state: GroupSignerState, e: GroupSignerEvent): GroupSignerState {
  const from = FROM[e.type];
  if (from !== "any" && !from.includes(state.kind)) return state;
  switch (e.type) {
    case "reset": return initialGroupSignerState;
    case "quoteRequested": return { kind: "quoting" };
    case "feeConfirming": return { kind: "feeConfirming" };
    case "quoted": return { kind: e.group.priceMoved ? "priceMoved" : "signing", group: e.group };
    case "accepted": return state.kind === "priceMoved" ? { kind: "signing", group: state.group } : state;
    case "signed": return state.kind === "signing" ? { kind: "sending", group: state.group } : state;
    case "finished": return e.op.status !== "COMPLETED" && e.op.needsAction ? { kind: "needsAction", op: e.op } : { kind: "done", op: e.op };
    case "failed": return { kind: "failed", code: e.code, message: e.message, details: e.details };
  }
}

export type GroupSignerApi = {
  requestGroup(id: string, b: GroupRequest): Promise<GroupResponse>;
  submitGroup(id: string, g: string, b: GroupSubmit): Promise<OperationView>;
  claimGroup(id: string, g: string): Promise<OperationView>;
  sentGroup(id: string, g: string, b: GroupSent): Promise<OperationView>;
  releaseGroup(id: string, g: string): Promise<OperationView>;
};

const UNSUPPORTED = /not supported|unsupported|not implemented|not a function/i;

const FEE_RETRY_MS = 1_000;
const FEE_RETRY_MAX = 60;
const feeConfirming = (err: unknown) => err instanceof ApiError && err.code === "OPERATION_IN_PROGRESS" && (err.details as { reason?: string } | undefined)?.reason === "fee_confirming";

/**
 * One chunk: quote, (accept new prices), wallet, submit. Tier `single` signs one transaction per popup (the server then forms groups of one leg, so the 40 s
 * window holds); `sign_all` one popup for the whole batch. A wallet that cannot sign a batch downgrades (`onDowngrade`) to `single` BEFORE the quote when that is
 * known, else a fresh `single` group is requested (the batch it was shown is too big to sign one by one). A cancelled popup never downgrades. Returns null when
 * the user declined new prices or the chunk failed (the state says why); nothing here resends a submitted group.
 *
 * Tier `sign_and_send` (a wallet in SIGN_AND_SEND_WALLETS; none since the P0 lab): the server claims the group BEFORE the wallet is opened, the wallet signs and broadcasts, and the signatures it returns are
 * reported. Only a clear rejection releases the claim (nothing was broadcast); any other wallet error ends `OUTCOME_UNKNOWN` with the claim kept, and the server
 * sweep resolves it. Never sign again after that.
 *
 * The request for the next group is repeated every second, up to a minute, while the server answers that the previous fee is not confirmed yet.
 */
export async function runGroup(
  api: GroupSignerApi, signer: Signer, opId: string, dispatch: (e: GroupSignerEvent) => void,
  opts: { tier: "sign_all" | "sign_and_send" | "single"; walletName?: string; acceptNewPrices(g: GroupResponse): Promise<boolean>; onDowngrade(): void },
): Promise<OperationView | null> {
  let claimed = false;
  let group: GroupResponse | undefined;
  try {
    let tier = opts.tier;
    if (tier === "sign_all" && !signer.signSolanaAll) { opts.onDowngrade(); tier = "single"; }
    dispatch({ type: "quoteRequested" });
    const body: GroupRequest = { chain: "solana", tier, walletName: opts.walletName, idempotencyKey: crypto.randomUUID() };
    for (let n = 0; !group; n++) {
      try {
        group = await api.requestGroup(opId, body);
      } catch (err) {
        if (!feeConfirming(err) || n >= FEE_RETRY_MAX) throw err;
        dispatch({ type: "feeConfirming" });
        await sleepMs(FEE_RETRY_MS);
      }
    }
    dispatch({ type: "quoted", group });
    if (group.priceMoved) {
      if (!(await opts.acceptNewPrices(group))) { dispatch({ type: "reset" }); return null; }
      dispatch({ type: "accepted" });
    }
    const txs = group.transactions.map((t) => t.serializedBase64);
    if (tier === "sign_and_send") {
      await api.claimGroup(opId, group.groupId);
      claimed = true;
      const signatures = await signer.signAndSendSolanaAll!(txs);
      dispatch({ type: "signed" });
      const op = await api.sentGroup(opId, group.groupId, { signatures: group.transactions.flatMap((t, i) => (signatures[i] ? [{ legId: t.legId, signature: bs58.encode(signatures[i]) }] : [])) });
      dispatch({ type: "finished", op });
      return op;
    }
    let signed: string[];
    if (tier === "single") {
      signed = [];
      for (const t of txs) signed.push(await signer.signSolana(t));
    } else {
      try {
        signed = await signer.signSolanaAll!(txs);
      } catch (err) {
        if (err instanceof WalletRejectedError || !UNSUPPORTED.test(err instanceof Error ? err.message : "")) throw err;
        opts.onDowngrade();
        return runGroup(api, signer, opId, dispatch, { ...opts, tier: "single" }); // the quoted batch is dropped by the next quote
      }
    }
    dispatch({ type: "signed" });
    const op = await api.submitGroup(opId, group.groupId, { signed: group.transactions.map((t, i) => ({ legId: t.legId, signedTx: signed[i]! })) });
    dispatch({ type: "finished", op });
    return op;
  } catch (err) {
    if (claimed && group && (err instanceof WalletRejectedError || err instanceof WrongWalletError)) {
      try { await api.releaseGroup(opId, group.groupId); } catch { /* best effort: an unreleased claim is resolved by the server sweep */ }
    } else if (claimed && !(err instanceof ApiError)) {
      dispatch({ type: "failed", code: OUTCOME_UNKNOWN, message: "Confirming with the network — don't sign again" });
      return null;
    }
    dispatch({ type: "failed", ...legErrorInfo(err), details: err instanceof ApiError ? err.details : undefined });
    return null;
  }
}

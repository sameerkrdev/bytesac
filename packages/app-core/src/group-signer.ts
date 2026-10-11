import { ApiError } from "@repo/api-client";
import type { GroupRequest, GroupResponse, GroupSubmit, OperationView } from "@repo/validator";
import { legErrorInfo, type Signer } from "./leg-signer";
import { WalletRejectedError } from "./wallet";

/** What one signing group is doing (web, Solana). The machine only displays server values; it never decides an amount. */
export type GroupSignerState =
  | { kind: "idle" }
  | { kind: "quoting" }
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
  quoted: ["quoting"],
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
};

const UNSUPPORTED = /not supported|unsupported|not implemented|not a function/i;

/**
 * One chunk: quote, (accept new prices), wallet, submit. Tier `single` signs one transaction per popup; `sign_all` one popup for the whole batch,
 * falling back to one per transaction when the wallet says it cannot (`onDowngrade`). A cancelled popup never downgrades. Returns null when the user
 * declined new prices or the chunk failed (the state says why); nothing here resends a submitted group.
 */
export async function runGroup(
  api: GroupSignerApi, signer: Signer, opId: string, dispatch: (e: GroupSignerEvent) => void,
  opts: { tier: "sign_all" | "single"; walletName?: string; acceptNewPrices(g: GroupResponse): Promise<boolean>; onDowngrade(): void },
): Promise<OperationView | null> {
  try {
    dispatch({ type: "quoteRequested" });
    const group = await api.requestGroup(opId, { chain: "solana", tier: opts.tier, walletName: opts.walletName, idempotencyKey: crypto.randomUUID() });
    dispatch({ type: "quoted", group });
    if (group.priceMoved) {
      if (!(await opts.acceptNewPrices(group))) { dispatch({ type: "reset" }); return null; }
      dispatch({ type: "accepted" });
    }
    const txs = group.transactions.map((t) => t.serializedBase64);
    const signEach = async () => { const out: string[] = []; for (const t of txs) out.push(await signer.signSolana(t)); return out; };
    let signed: string[];
    if (opts.tier === "single") signed = await signEach();
    else if (!signer.signSolanaAll) { opts.onDowngrade(); signed = await signEach(); }
    else {
      try {
        signed = await signer.signSolanaAll(txs);
      } catch (err) {
        if (err instanceof WalletRejectedError || !UNSUPPORTED.test(err instanceof Error ? err.message : "")) throw err;
        opts.onDowngrade();
        signed = await signEach();
      }
    }
    dispatch({ type: "signed" });
    const op = await api.submitGroup(opId, group.groupId, { signed: group.transactions.map((t, i) => ({ legId: t.legId, signedTx: signed[i]! })) });
    dispatch({ type: "finished", op });
    return op;
  } catch (err) {
    dispatch({ type: "failed", ...legErrorInfo(err), details: err instanceof ApiError ? err.details : undefined });
    return null;
  }
}

import { ApiError } from "@repo/api-client";
import type { Leg, LegQuoteResponse, OperationView } from "@repo/validator";
import { WalletRejectedError, WrongWalletError } from "./wallet";

/** What one leg signing attempt is doing. The machine only displays server values; it never decides an amount. */
export type LegSignerState =
  | { kind: "idle" }
  | { kind: "quoting" }
  | { kind: "awaitingGasDrop"; txHash: string | null }
  | { kind: "confirmPrice"; estimatedOut: string; minOut: string }
  | { kind: "signing" }
  | { kind: "submitting" }
  | { kind: "tracking" }
  | { kind: "done" }
  | { kind: "failed"; code: string; message: string }
  | { kind: "handoffWeb"; url: string };

export type LegSignerEvent =
  | { type: "reset" }
  | { type: "quoteRequested" }
  | { type: "gasDropPending"; txHash: string | null }
  /** Empty strings mean the server gave no estimate (the fee leg). */
  | { type: "quoteReady"; estimatedOut: string | null; minOut: string | null }
  | { type: "confirmed" }
  | { type: "signed" }
  | { type: "submitted" }
  | { type: "settled" }
  | { type: "failed"; code: string; message: string }
  | { type: "handoff"; url: string };

export const initialLegSignerState: LegSignerState = { kind: "idle" };

/** Which states each event may leave; anything else is ignored (a late event never rewinds the flow). */
const FROM: Record<LegSignerEvent["type"], LegSignerState["kind"][] | "any"> = {
  reset: "any",
  failed: "any",
  quoteRequested: "any",
  gasDropPending: ["quoting", "awaitingGasDrop"],
  quoteReady: ["quoting", "awaitingGasDrop"],
  confirmed: ["confirmPrice"],
  signed: ["signing"],
  submitted: ["submitting"],
  settled: ["tracking"],
  handoff: ["quoting", "awaitingGasDrop", "confirmPrice", "signing"],
};

export function legSignerReducer(state: LegSignerState, e: LegSignerEvent): LegSignerState {
  const from = FROM[e.type];
  if (from !== "any" && !from.includes(state.kind)) return state;
  switch (e.type) {
    case "reset": return initialLegSignerState;
    case "quoteRequested": return { kind: "quoting" };
    case "gasDropPending": return { kind: "awaitingGasDrop", txHash: e.txHash };
    case "quoteReady": return { kind: "confirmPrice", estimatedOut: e.estimatedOut ?? "", minOut: e.minOut ?? "" };
    case "confirmed": return { kind: "signing" };
    case "signed": return { kind: "submitting" };
    case "submitted": return { kind: "tracking" };
    case "settled": return { kind: "done" };
    case "failed": return { kind: "failed", code: e.code, message: e.message };
    case "handoff": return { kind: "handoffWeb", url: e.url };
  }
}

/** The wallet side, supplied by each app. Each method signs exactly what the server prepared. */
export interface Signer {
  signSolana(serializedBase64: string): Promise<string>;
  sendEvm(tx: { to: string; data: string; value: string; chainId: number; approval?: { token: string; spender: string; amount: string } | null }): Promise<string>;
  /** Absent when the wallet cannot sign a Bitcoin PSBT: the leg is then continued on the web. */
  signPsbt?(psbtBase64: string, inputCount: number): Promise<string>;
}

export type LegSignerApi = {
  getOperation(operationId: string): Promise<OperationView>;
  quoteLeg(operationId: string, legId: string): Promise<LegQuoteResponse>;
  submitLeg(operationId: string, legId: string, body: { signedTx: string } | { txHash: string } | { signedPsbt: string }): Promise<OperationView>;
};

export type Dispatch = (e: LegSignerEvent) => void;
type Transaction = NonNullable<LegQuoteResponse["transaction"]>;
export type Prepared = { leg: Leg; q: LegQuoteResponse & { transaction: Transaction } };

export class GasDropError extends Error {}
export const GAS_DROP_UNCONFIRMED = "GAS_DROP_UNCONFIRMED";

/** The code and message shown for a failure: the API's own code, or one for a wallet / gas-drop failure. */
export function legErrorInfo(err: unknown): { code: string; message: string } {
  if (err instanceof ApiError) return { code: err.code, message: err.message };
  if (err instanceof WalletRejectedError) return { code: "WALLET_REJECTED", message: err.message };
  if (err instanceof WrongWalletError) return { code: "WRONG_WALLET", message: err.message };
  if (err instanceof GasDropError) return { code: GAS_DROP_UNCONFIRMED, message: err.message };
  return { code: "INTERNAL", message: err instanceof Error ? err.message : "Something went wrong." };
}

export const LEG_ACTIVE = ["PLANNED", "IN_PROGRESS"];
/** Legs being sent or confirmed: the operation cannot be stopped while one of these is open. An UNKNOWN leg does not block stopping; it keeps being checked. */
export const LEG_IN_FLIGHT = ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN"];
/** Previews warn from a 2% price impact; the server refuses above 5%. */
export const PRICE_IMPACT_WARNING = 0.02;

/** The leg the user signs next: the first planned one whose predecessors settled (a network fee that is already on chain does not hold up the first asset leg). */
export const nextLeg = (legs: Leg[]): Leg | undefined =>
  legs.find((l, i) => l.status === "PLANNED" && legs.slice(0, i).every((p) => p.status === "SETTLED" || p.recoveryToken || (p.kind === "network_fee" && p.status === "PENDING_CHAIN")));

/** Progress text for the states that are waiting on something. */
export const LEG_STEP_LABEL: Partial<Record<LegSignerState["kind"], string>> = {
  quoting: "Getting a quote", awaitingGasDrop: "Waiting for the gas top-up to confirm", signing: "Approve in your wallet", submitting: "Submitting",
};

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Step 1: a fresh quote and, on EVM, the confirmed gas top-up. The wallet is not opened. Throws (after dispatching `failed`) on any failure. */
export async function prepareLeg(api: LegSignerApi, operationId: string, leg: Leg, dispatch: Dispatch, opts: { sleep?: (ms: number) => Promise<void>; pollMs?: number; maxPolls?: number } = {}): Promise<Prepared> {
  const { sleep = sleepMs, pollMs = 3000, maxPolls = 40 } = opts;
  try {
    dispatch({ type: "quoteRequested" });
    let q = await api.quoteLeg(operationId, leg.id);
    // EVM legs: the platform's gas top-up must be confirmed before anything is signed.
    for (let n = 0; !q.transaction && q.gasDrop?.status === "pending" && n < maxPolls; n++) {
      dispatch({ type: "gasDropPending", txHash: q.gasDrop.txHash });
      await sleep(pollMs);
      q = await api.quoteLeg(operationId, leg.id);
    }
    if (!q.transaction) throw new GasDropError("The gas top-up did not confirm. Nothing was signed. Try again in a moment.");
    dispatch({ type: "quoteReady", estimatedOut: q.estimatedOut, minOut: q.minOut });
    return { leg, q: { ...q, transaction: q.transaction } };
  } catch (err) {
    dispatch({ type: "failed", ...legErrorInfo(err) });
    throw err;
  }
}

/** Step 2: the user approved the fresh figures; the wallet signs and the server verifies and submits. Returns null when the leg is handed to the web (Bitcoin without `signPsbt`). Nothing here retries a submitted leg. */
export async function signLeg(api: LegSignerApi, signer: Signer, operationId: string, { leg, q }: Prepared, dispatch: Dispatch, handoffUrl: string): Promise<OperationView | null> {
  try {
    const tx = q.transaction;
    if (tx.kind === "bitcoin" && !signer.signPsbt) { dispatch({ type: "handoff", url: handoffUrl }); return null; }
    dispatch({ type: "confirmed" });
    const body = tx.kind === "solana" ? { signedTx: await signer.signSolana(tx.serializedBase64) }
      : tx.kind === "evm" ? { txHash: await signer.sendEvm({ ...tx, approval: q.approval }) }
        : { signedPsbt: await signer.signPsbt!(tx.psbtBase64, tx.inputCount) };
    dispatch({ type: "signed" });
    const op = await api.submitLeg(operationId, leg.id, body);
    dispatch({ type: "submitted" });
    return op;
  } catch (err) {
    dispatch({ type: "failed", ...legErrorInfo(err) });
    throw err;
  }
}

/** One leg end to end. `confirm` shows the fresh figures (the `confirmPrice` state) and resolves true only on an explicit user tap; the wallet opens only after that. */
export async function runLeg(
  api: LegSignerApi, signer: Signer, operationId: string, legId: string, dispatch: Dispatch,
  opts: { confirm(fresh: { estimatedOut: string | null; minOut: string | null }): Promise<boolean>; handoffUrl: string; sleep?: (ms: number) => Promise<void> },
): Promise<OperationView | null> {
  let leg;
  try {
    leg = (await api.getOperation(operationId)).legs.find((l) => l.id === legId);
  } catch (err) {
    dispatch({ type: "failed", ...legErrorInfo(err) });
    throw err;
  }
  if (!leg) { dispatch({ type: "failed", code: "NOT_FOUND", message: "This step is no longer part of the operation." }); return null; }
  const prepared = await prepareLeg(api, operationId, leg, dispatch, { sleep: opts.sleep });
  if (!(await opts.confirm({ estimatedOut: prepared.q.estimatedOut, minOut: prepared.q.minOut }))) { dispatch({ type: "reset" }); return null; }
  const op = await signLeg(api, signer, operationId, prepared, dispatch, opts.handoffUrl);
  if (op && op.status === "COMPLETED") dispatch({ type: "settled" });
  return op;
}

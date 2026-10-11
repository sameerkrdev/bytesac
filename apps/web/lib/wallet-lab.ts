import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

/** Pure helpers for the dev-only wallet lab (Spec 22 P0). Nothing here talks to a wallet or the network. */

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";

export const LAB_BATCH_SIZES = [2, 5, 10, 12, 20, 30] as const;

/** Native USDC (Binance-Peg on BNB): target of the deliberately reverting call `0xdeadbeef` (no such selector). */
export const USDC_BY_CHAIN = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  bnb: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
} as const satisfies Record<string, `0x${string}`>;

export type LabResult = {
  family: "solana" | "evm";
  wallet: string;
  mode: "sign_all" | "sign_and_send" | "single" | "evm_calls";
  chain: string;
  n: number;
  outcome: "ok" | "rejected" | "unsupported" | "error";
  msToReturn: number | null;
  popupsReported: number | null;
  compare?: ReturnType<typeof compareSigned>;
  sent?: { ok: number; expired: number; failed: number };
  evm?: { capabilities: unknown; receipts: number; distinctTxTo: number; atomic: boolean | null; statusCode: number | null; revertedCall: ReturnType<typeof revertVerdict> };
  /** Why a run did not end ok: EIP-1193/5792 code plus the first characters of the message, addresses scrubbed. */
  detail?: string;
};

/** Exports must carry no addresses (EVM hex or Solana base58); wallet-controlled text such as capabilities and error messages is untrusted. */
export const scrubAddresses = (text: string) => text.replace(/0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/g, "<addr>");

/**
 * Whether call 3 ran after call 2 reverted, from the EIP-5792 call status: 500 = all reverted, 600 = partial revert. An atomic batch is all or nothing;
 * a non-atomic one `continued` only when a receipt exists for every call.
 */
export function revertVerdict(s: { statusCode: number; atomic: boolean; receipts: number; calls: number }): "all_reverted" | "continued" | "stopped" | "n/a" {
  if (s.statusCode < 500) return "n/a";
  return s.atomic ? "all_reverted" : s.statusCode === 600 && s.receipts >= s.calls ? "continued" : "stopped";
}

/** `n` memo-only transactions paid by the user: harmless, 5000 lamports each if the user chooses to send them. */
export function buildMemoBatch(i: { payer: PublicKey; blockhash: string; n: number; runId: string }): VersionedTransaction[] {
  return Array.from({ length: i.n }, (_, k) => new VersionedTransaction(new TransactionMessage({
    payerKey: i.payer,
    recentBlockhash: i.blockhash,
    instructions: [new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(`bytesac-lab ${i.runId} ${k + 1}/${i.n}`) })],
  }).compileToV0Message()));
}

const instructionsOf = (tx: VersionedTransaction) => tx.message.compiledInstructions.map((ix) => ({ program: tx.message.staticAccountKeys[ix.programIdIndex]!.toBase58(), data: Buffer.from(ix.data).toString("hex") }));
const memoOf = (tx: VersionedTransaction) => {
  const memo = tx.message.compiledInstructions.find((ix) => tx.message.staticAccountKeys[ix.programIdIndex]!.equals(MEMO_PROGRAM_ID));
  return memo ? Buffer.from(memo.data).toString() : null;
};
/** Same version, payer, blockhash and instructions apart from ComputeBudget: a blockhash or version change is not a ComputeBudget-only rewrite. */
const sameWithoutComputeBudget = (a: VersionedTransaction, b: VersionedTransaction) => {
  const strip = (tx: VersionedTransaction) => JSON.stringify([tx.message.version, tx.message.staticAccountKeys[0]!.toBase58(), tx.message.recentBlockhash, instructionsOf(tx).filter((ix) => ix.program !== COMPUTE_BUDGET_PROGRAM_ID)]);
  return strip(a) === strip(b);
};

/**
 * What the wallet handed back versus what we sent. Each returned transaction is matched to its sent twin by memo text, so a pure reorder is `inOrder: false`
 * but not a rewrite. `onlyComputeBudget` is false when the blockhash or version changed (`blockhashChanged` says so); `unsigned` counts returns without a fee-payer signature.
 */
export function compareSigned(sent: VersionedTransaction[], got: VersionedTransaction[]) {
  const pairs = got.map((tx) => [sent.find((s) => memoOf(s) === memoOf(tx)), tx] as const);
  const differing = pairs.filter(([s, tx]) => !s || !Buffer.from(s.message.serialize()).equals(Buffer.from(tx.message.serialize())));
  return {
    count: got.length,
    expected: sent.length,
    inOrder: got.every((tx, k) => memoOf(tx) === (sent[k] ? memoOf(sent[k]) : null)),
    rewritten: differing.length,
    onlyComputeBudget: differing.every(([s, tx]) => !!s && sameWithoutComputeBudget(s, tx)),
    blockhashChanged: differing.some(([s, tx]) => !!s && s.message.recentBlockhash !== tx.message.recentBlockhash),
    feePayerChanged: pairs.some(([s, tx]) => !!s && !tx.message.staticAccountKeys[0]!.equals(s.message.staticAccountKeys[0]!)),
    unsigned: got.filter((tx) => !tx.signatures[0]?.some((b) => b !== 0)).length,
  };
}

const errorParts = (err: unknown) => {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; message?: unknown };
  return { code: e.code, message: typeof err === "string" ? err : typeof e.message === "string" ? e.message : "" };
};

/**
 * Separates a user "no" from a wallet that lacks the method, so neither is reported as a crash. EIP-5792 5700, 5710 and 5760 (unsupported capability,
 * chain, atomicity) are `unsupported`; 5740 (bundle too large) stays `error` and its code is kept by `failureDetail`, which is how the batch ceiling is read.
 */
export function classifyWalletError(err: unknown): "rejected" | "unsupported" | "error" {
  const { code, message } = errorParts(err);
  if (code === 4001 || /reject|denied|cancel/i.test(message)) return "rejected";
  if (code === 4200 || code === -32601 || code === 4100 || code === 5700 || code === 5710 || code === 5760 || /not supported|unsupported|not implemented|not a function|does not support|method not found/i.test(message)) return "unsupported";
  return "error";
}

/** The code and the start of the message, addresses scrubbed: what a failed row exports so a size limit (5740) or a timeout is readable. */
export function failureDetail(err: unknown): string {
  const { code, message } = errorParts(err);
  return scrubAddresses(`${typeof code === "number" || typeof code === "string" ? `${code} ` : ""}${message}`.trim()).slice(0, 120);
}

/** Once one blockhash is stale every later transaction is expired too (the same rule as P1). `builtAt` and `now` are for display only. */
export function sendPlan(i: { builtAt: number; now: number; valid: boolean[] }): ("send" | "expired")[] {
  let expired = false;
  return i.valid.map((ok) => ((expired ||= !ok) ? "expired" : "send"));
}

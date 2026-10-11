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
  evm?: { capabilities: unknown; receipts: number; distinctTxTo: number; revertedCall: "stopped" | "continued" | "n/a" };
};

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
const sameWithoutComputeBudget = (a: VersionedTransaction, b: VersionedTransaction) => {
  const strip = (tx: VersionedTransaction) => JSON.stringify([tx.message.staticAccountKeys[0]!.toBase58(), instructionsOf(tx).filter((ix) => ix.program !== COMPUTE_BUDGET_PROGRAM_ID)]);
  return strip(a) === strip(b);
};

/** What the wallet handed back versus what we sent: count, order (by memo text), rewritten messages, and whether the rewrite is only ComputeBudget. */
export function compareSigned(sent: VersionedTransaction[], got: VersionedTransaction[]) {
  const differing = got.flatMap((tx, k) => (sent[k] && !Buffer.from(sent[k].message.serialize()).equals(Buffer.from(tx.message.serialize())) ? [[sent[k], tx] as const] : []));
  return {
    count: got.length,
    expected: sent.length,
    inOrder: got.every((tx, k) => memoOf(tx) === (sent[k] ? memoOf(sent[k]) : null)),
    rewritten: differing.length,
    onlyComputeBudget: differing.every(([a, b]) => sameWithoutComputeBudget(a, b)),
    feePayerChanged: got.some((tx, k) => !!sent[k] && !tx.message.staticAccountKeys[0]!.equals(sent[k].message.staticAccountKeys[0]!)),
  };
}

/** Separates a user "no" from a wallet that lacks the method, so neither is reported as a crash. */
export function classifyWalletError(err: unknown): "rejected" | "unsupported" | "error" {
  const e = (typeof err === "object" && err !== null ? err : {}) as { code?: unknown; message?: unknown };
  const message = typeof err === "string" ? err : typeof e.message === "string" ? e.message : "";
  if (e.code === 4001 || /reject|denied|cancel/i.test(message)) return "rejected";
  if (e.code === 4200 || e.code === -32601 || e.code === 4100 || /not supported|unsupported|not implemented|not a function/i.test(message)) return "unsupported";
  return "error";
}

/** Once one blockhash is stale every later transaction is expired too (the same rule as P1). `builtAt` and `now` are for display only. */
export function sendPlan(i: { builtAt: number; now: number; valid: boolean[] }): ("send" | "expired")[] {
  let expired = false;
  return i.valid.map((ok) => ((expired ||= !ok) ? "expired" : "send"));
}

type RegisteredWallet = { name: string; features: Record<string, unknown> };

/** Wallet Standard discovery without `@wallet-standard/app`: the register protocol of the wallet-standard repo (core/base register.ts). */
export function standardWalletFeatures(timeoutMs = 300): Promise<{ name: string; features: string[] }[]> {
  return new Promise((resolve) => {
    const found: { name: string; features: string[] }[] = [];
    const api = { register: (...wallets: RegisteredWallet[]) => { found.push(...wallets.map((w) => ({ name: w.name, features: Object.keys(w.features) }))); return () => {}; } };
    const onRegister = (event: Event) => (event as CustomEvent<(a: typeof api) => void>).detail(api);
    window.addEventListener("wallet-standard:register-wallet", onRegister);
    window.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
    setTimeout(() => {
      window.removeEventListener("wallet-standard:register-wallet", onRegister);
      resolve(found);
    }, timeoutMs);
  });
}

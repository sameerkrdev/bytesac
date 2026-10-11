// @vitest-environment node
import { ComputeBudgetProgram, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMemoBatch, classifyWalletError, compareSigned, MEMO_PROGRAM_ID, sendPlan } from "@/lib/wallet-lab";

vi.mock("@/components/dev/wallet-lab", () => ({ WalletLab: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const payer = Keypair.generate();
const BH = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const batch = (n = 3) => buildMemoBatch({ payer: payer.publicKey, blockhash: BH, n, runId: "r1" });

afterEach(() => vi.unstubAllEnvs());

describe("wallet lab helpers", () => {
  it("builds n memo-only transactions paid by the user", () => {
    const txs = batch(3);
    expect(txs).toHaveLength(3);
    for (const [i, tx] of txs.entries()) {
      expect(tx.message.staticAccountKeys[0]!.equals(payer.publicKey)).toBe(true);
      expect(tx.message.compiledInstructions).toHaveLength(1);
      expect(tx.message.staticAccountKeys[tx.message.compiledInstructions[0]!.programIdIndex]!.equals(MEMO_PROGRAM_ID)).toBe(true);
      expect(Buffer.from(tx.message.compiledInstructions[0]!.data).toString()).toBe(`bytesac-lab r1 ${i + 1}/3`);
    }
  });

  it("reports identical, ComputeBudget-only rewrites, fee-payer changes, short and shuffled returns", () => {
    const sent = batch(3);
    expect(compareSigned(sent, sent)).toMatchObject({ count: 3, expected: 3, inOrder: true, rewritten: 0, feePayerChanged: false });
    const padded = sent.map((tx) => new VersionedTransaction(new TransactionMessage({
      payerKey: payer.publicKey, recentBlockhash: BH,
      instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }), ...TransactionMessage.decompile(tx.message).instructions],
    }).compileToV0Message()));
    expect(compareSigned(sent, padded)).toMatchObject({ rewritten: 3, onlyComputeBudget: true, feePayerChanged: false });
    const other = Keypair.generate().publicKey;
    const payerSwap = sent.map((tx) => new VersionedTransaction(new TransactionMessage({ payerKey: other, recentBlockhash: BH, instructions: TransactionMessage.decompile(tx.message).instructions }).compileToV0Message()));
    expect(compareSigned(sent, payerSwap)).toMatchObject({ feePayerChanged: true, onlyComputeBudget: false });
    expect(compareSigned(sent, sent.slice(0, 2))).toMatchObject({ count: 2, expected: 3 });
    expect(compareSigned(sent, [sent[2]!, sent[0]!, sent[1]!])).toMatchObject({ inOrder: false });
  });

  it("separates a user rejection from an unsupported method", () => {
    expect(classifyWalletError({ code: 4001, message: "User rejected the request." })).toBe("rejected");
    expect(classifyWalletError(new Error("signAllTransactions is not supported"))).toBe("unsupported");
    expect(classifyWalletError({ code: 4200, message: "Unsupported method" })).toBe("unsupported");
    expect(classifyWalletError(new Error("boom"))).toBe("error");
  });

  it("marks everything after the first stale blockhash as expired", () => {
    expect(sendPlan({ builtAt: 0, now: 10_000, valid: [true, false, true] })).toEqual(["send", "expired", "expired"]);
    expect(sendPlan({ builtAt: 0, now: 10_000, valid: [true, true] })).toEqual(["send", "send"]);
  });

  it("answers 404 unless NEXT_PUBLIC_WALLET_LAB is 1", async () => {
    const { default: Page } = await import("@/app/dev/wallet-lab/page");
    vi.stubEnv("NEXT_PUBLIC_WALLET_LAB", "");
    expect(() => Page()).toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("NEXT_PUBLIC_WALLET_LAB", "1");
    expect(() => Page()).not.toThrow();
  });
});

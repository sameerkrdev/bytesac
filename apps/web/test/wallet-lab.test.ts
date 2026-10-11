// @vitest-environment node
import { ComputeBudgetProgram, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMemoBatch, classifyWalletError, compareSigned, failureDetail, MEMO_PROGRAM_ID, revertVerdict, scrubAddresses, sendPlan } from "@/lib/wallet-lab";

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
    expect(compareSigned(sent, sent.slice(0, 2))).toMatchObject({ count: 2, expected: 3, inOrder: true, rewritten: 0 });
    // a pure reorder is not a rewrite
    expect(compareSigned(sent, [sent[2]!, sent[0]!, sent[1]!])).toMatchObject({ inOrder: false, rewritten: 0 });
  });

  it("does not call a blockhash-only rewrite ComputeBudget-only, and counts unsigned returns", () => {
    const sent = batch(3);
    const refreshed = sent.map((tx) => new VersionedTransaction(new TransactionMessage({
      payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: TransactionMessage.decompile(tx.message).instructions,
    }).compileToV0Message()));
    expect(compareSigned(sent, refreshed)).toMatchObject({ rewritten: 3, blockhashChanged: true, onlyComputeBudget: false, feePayerChanged: false });
    expect(compareSigned(sent, sent)).toMatchObject({ blockhashChanged: false, unsigned: 3 });
    const signed = sent.map((tx) => { const copy = new VersionedTransaction(tx.message); copy.sign([payer]); return copy; });
    expect(compareSigned(sent, signed)).toMatchObject({ rewritten: 0, unsigned: 0 });
  });

  it("separates a user rejection from an unsupported method", () => {
    expect(classifyWalletError({ code: 4001, message: "User rejected the request." })).toBe("rejected");
    expect(classifyWalletError(new Error("signAllTransactions is not supported"))).toBe("unsupported");
    expect(classifyWalletError({ code: 4200, message: "Unsupported method" })).toBe("unsupported");
    expect(classifyWalletError(new Error("boom"))).toBe("error");
    expect(classifyWalletError("User denied transaction signature")).toBe("rejected");
    expect(classifyWalletError({ code: -32601, message: "x" })).toBe("unsupported");
    expect(classifyWalletError({ code: 4100, message: "x" })).toBe("unsupported");
    expect(classifyWalletError({ code: 5760, message: "Atomicity not supported" })).toBe("unsupported");
    expect(classifyWalletError({ code: 5710, message: "x" })).toBe("unsupported");
    expect(classifyWalletError({ code: 5700, message: "x" })).toBe("unsupported");
  });

  it("keeps the failure code so a batch-size limit is readable, with addresses scrubbed", () => {
    // 5740 = EIP-5792 "bundle too large": stays an error, the code is the signal
    const tooLarge = { code: 5740, message: "Bundle too large" };
    expect(classifyWalletError(tooLarge)).toBe("error");
    expect(failureDetail(tooLarge)).toBe("5740 Bundle too large");
    const withAddress = failureDetail({ code: 5740, message: `call to ${payer.publicKey.toBase58()} and 0x${"ab".repeat(20)} failed` });
    expect(withAddress).toBe("5740 call to <addr> and <addr> failed");
    expect(failureDetail(new Error("boom"))).toBe("boom");
    expect(scrubAddresses(JSON.stringify({ capabilities: { "0x2105": { delegation: { address: `0x${"cd".repeat(20)}` } } } }))).not.toMatch(/0xcd/);
  });

  it("reads the revert verdict from the call status, not the receipt count", () => {
    expect(revertVerdict({ statusCode: 500, atomic: true, receipts: 1, calls: 3 })).toBe("all_reverted");
    expect(revertVerdict({ statusCode: 600, atomic: false, receipts: 3, calls: 3 })).toBe("continued");
    expect(revertVerdict({ statusCode: 600, atomic: false, receipts: 2, calls: 3 })).toBe("stopped");
    expect(revertVerdict({ statusCode: 500, atomic: false, receipts: 3, calls: 3 })).toBe("stopped");
    expect(revertVerdict({ statusCode: 200, atomic: true, receipts: 1, calls: 3 })).toBe("n/a");
  });

  it("marks everything after the first stale blockhash as expired", () => {
    expect(sendPlan({ builtAt: 0, now: 10_000, valid: [true, false, true] })).toEqual(["send", "expired", "expired"]);
    expect(sendPlan({ builtAt: 0, now: 10_000, valid: [true, true] })).toEqual(["send", "send"]);
  });

  it("answers 404 unless NEXT_PUBLIC_WALLET_LAB is 1", async () => {
    const { default: Page } = await import("@/app/dev/wallet-lab/page");
    for (const flag of ["", "0", "true"]) {
      vi.stubEnv("NEXT_PUBLIC_WALLET_LAB", flag);
      expect(() => Page()).toThrow("NEXT_NOT_FOUND");
    }
    vi.stubEnv("NEXT_PUBLIC_WALLET_LAB", "1");
    expect(Page().type).toBe((await import("@/components/dev/wallet-lab")).WalletLab);
  });
});

import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { Script, Transaction } from "@scure/btc-signer";
import bs58 from "bs58";
import { vi } from "vitest";
import * as bitcoin from "@/providers/bitcoin";
import { lifi } from "@/providers/routes/lifi";
import type { LegStatus } from "@/providers/routes/types";
import * as solanaTx from "@/providers/solana-tx";
import { fakes } from "./fakes";
import { bitcoinWallet } from "./execution";

// Chain, LI.FI and Alchemy doubles for the operation tests: nothing here touches a network.

/** A Solana wallet with a web3.js keypair (to sign planner-built transactions) that can also sign in. */
export function solanaTestWallet() {
  const keypair = Keypair.generate();
  const key = createPrivateKey({ key: { kty: "OKP", crv: "Ed25519", d: Buffer.from(keypair.secretKey.subarray(0, 32)).toString("base64url"), x: Buffer.from(keypair.publicKey.toBytes()).toString("base64url") }, format: "jwk" });
  return { keypair, address: keypair.publicKey.toBase58(), sign: (message: string) => bs58.encode(sign(null, Buffer.from(message), key)) };
}

export interface ChainState {
  /** Wallet balances by `balanceKey(owner, token)`; Solana and Bitcoin owners by address. Unlisted = 0. */
  balances: Map<string, bigint>;
  /** Solana status per signature; unlisted = pending. */
  solanaFinality: Map<string, "finalized" | "failed" | "pending" | "expired">;
  /** What `owner` received in a Solana transaction (`signature:owner`); unlisted = transaction not found. */
  solanaReceived: Map<string, bigint>;
  bitcoinTxs: Map<string, { confirmations: number; outputs: { address: string | null; value: bigint }[] }>;
  /** LI.FI status answers per source tx hash; unlisted = PENDING. */
  lifiStatus: Map<string, LegStatus>;
  /** Balance-free estimates asked for (rebalance buys, balance-refused quotes). */
  estimates: Array<{ fromChain: string; toChain: string; fromAmount: bigint; fromToken: string | null; toToken: string | null }>;
  quotes: Array<{ fromChain: string; toChain: string; fromAmount: bigint; toAddress: string; svmSponsor?: string }>;
  /** Overrides applied to the next fresh quotes: scale the output (price move) or add gas. */
  quoteOut: { numerator: bigint; denominator: bigint };
  broadcasts: string[];
  /** Solana token accounts (base58) that exist; unlisted = missing. */
  tokenAccounts: Set<string>;
}

export const balanceKey = (owner: string, token: string | null) => `${owner.toLowerCase()}:${(token ?? "native").toLowerCase()}`;
export const BLOCKHASH = bs58.encode(Buffer.alloc(32, 9));
const enc = new TextEncoder();

/** The key that "owns" the input of every mocked Bitcoin PSBT. */
export const btcInputKey = bitcoinWallet("p2wpkh");

/** A LI.FI-style Bitcoin PSBT: one input of `btcInputKey`, then the vault deposit, the OP_RETURN memo and the refund to `refund`. */
export function btcPsbt(refund: string, sats: bigint, over: { depositSats?: bigint; changeSats?: bigint | null; inputSats?: bigint } = {}): string {
  const tx = new Transaction({ allowUnknownOutputs: true });
  tx.addInput({ txid: randomBytes(32), index: 0, witnessUtxo: { script: btcInputKey.pay.script, amount: over.inputSats ?? sats + 50_000n } });
  tx.addOutput({ script: bitcoinWallet("p2wpkh").pay.script, amount: over.depositSats ?? sats });
  tx.addOutput({ script: Script.encode(["RETURN", enc.encode("=:ETH.USDC:0xabc")]), amount: 0n });
  if (over.changeSats !== null) tx.addOutputAddress(refund, over.changeSats ?? 40_000n);
  return Buffer.from(tx.toPSBT()).toString("base64");
}

/** Installs spies on every network-facing function the operations use. Call in `beforeEach`; `vi.restoreAllMocks()` undoes it. */
export function mockChains(): ChainState {
  const state: ChainState = { balances: new Map(), solanaFinality: new Map(), solanaReceived: new Map(), bitcoinTxs: new Map(), lifiStatus: new Map(), estimates: [], quotes: [], broadcasts: [], quoteOut: { numerator: 1n, denominator: 1n }, tokenAccounts: new Set() };
  // The platform wallets are funded unless a test says otherwise.
  state.balances.set(balanceKey(solanaTx.feePayer().publicKey.toBase58(), null), 10n ** 12n);
  fakes.evm.balances.set(`ethereum:${fakes.evm.gasWalletAddress()}`, 10n ** 20n);
  vi.spyOn(solanaTx, "solanaBalance").mockImplementation(async (owner, mint) => state.balances.get(balanceKey(owner, mint)) ?? 0n);
  vi.spyOn(solanaTx, "solanaFinality").mockImplementation(async (sig) => state.solanaFinality.get(sig) ?? "pending");
  vi.spyOn(solanaTx, "solanaReceived").mockImplementation(async (sig, owner) => state.solanaReceived.get(`${sig}:${owner}`) ?? null);
  vi.spyOn(solanaTx.connection, "getAccountInfo").mockImplementation(async (key) => (state.tokenAccounts.has(key.toBase58()) ? ({ lamports: 2_039_280, data: Buffer.alloc(165), owner: key, executable: false } as never) : null));
  vi.spyOn(solanaTx.connection, "isBlockhashValid").mockResolvedValue({ context: { slot: 1 }, value: true });
  vi.spyOn(solanaTx.connection, "getLatestBlockhash").mockResolvedValue({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
  vi.spyOn(solanaTx.connection, "sendRawTransaction").mockImplementation(async (raw) => bs58.encode(VersionedTransaction.deserialize(raw as Uint8Array).signatures[0]!));
  vi.spyOn(bitcoin, "bitcoinBalance").mockImplementation(async (address) => state.balances.get(balanceKey(address, null)) ?? 0n);
  vi.spyOn(bitcoin, "bitcoinTx").mockImplementation(async (txid) => state.bitcoinTxs.get(txid) ?? null);
  vi.spyOn(bitcoin, "broadcastBitcoin").mockImplementation(async (hex) => { state.broadcasts.push(hex); return "broadcast"; });
  vi.spyOn(lifi, "connections").mockResolvedValue(true);
  vi.spyOn(lifi, "status").mockImplementation(async ({ txHash }) => state.lifiStatus.get(txHash) ?? { state: "PENDING" });
  vi.spyOn(lifi, "estimate").mockImplementation(async (i) => {
    state.estimates.push({ fromChain: i.fromChain, toChain: i.toChain, fromAmount: i.fromAmount, fromToken: i.fromToken, toToken: i.toToken });
    const out = (i.fromAmount * state.quoteOut.numerator) / state.quoteOut.denominator;
    return { estimatedOut: out, minOut: (out * BigInt(10_000 - i.slippageBps)) / 10_000n, toolSummary: "test-route", transaction: null, gasEstimateUsd: 0.05, gasNative: 5_000n, nativePriceUsd: null, priceImpact: null, routeFees: [] };
  });
  vi.spyOn(lifi, "quote").mockImplementation(async (i) => {
    state.quotes.push({ fromChain: i.fromChain, toChain: i.toChain, fromAmount: i.fromAmount, toAddress: i.toAddress, svmSponsor: i.svmSponsor });
    const out = (i.fromAmount * state.quoteOut.numerator) / state.quoteOut.denominator;
    const base = { estimatedOut: out, minOut: (out * BigInt(10_000 - i.slippageBps)) / 10_000n, toolSummary: "test-route", gasEstimateUsd: 0.05, nativePriceUsd: null, priceImpact: null, routeFees: [], expiresAt: new Date(Date.now() + 60_000), approvalAddress: null };
    if (i.fromChain === "solana") {
      const tx = new VersionedTransaction(new TransactionMessage({
        payerKey: solanaTx.feePayer().publicKey, recentBlockhash: BLOCKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: new PublicKey(i.fromAddress), toPubkey: new PublicKey(Buffer.alloc(32, 3)), lamports: i.fromAmount })],
      }).compileToV0Message());
      return { ...base, gasNative: 5_000n, transaction: { kind: "solana", serializedBase64: Buffer.from(tx.serialize()).toString("base64") } };
    }
    if (i.fromChain === "bitcoin") return { ...base, gasNative: 0n, transaction: { kind: "bitcoin", psbtBase64: btcPsbt(i.fromAddress, i.fromAmount) } };
    return { ...base, gasNative: 100_000_000_000_000n, transaction: { kind: "evm", to: "0x" + "ab".repeat(20), data: "0x1234", value: "0", chainId: 1 } };
  });
  return state;
}

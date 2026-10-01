import { createHash } from "node:crypto";
import bs58 from "bs58";
import createHttpError from "http-errors";
import { Connection, Keypair, PublicKey, SendTransactionError, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { USDC_DECIMALS, USDC_SOLANA_MINT } from "@repo/validator";
import { env } from "../env";

export const connection = new Connection(`https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, { commitment: "confirmed" });

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

/** The platform fee payer. The key never leaves this module; an empty `SOLANA_FEE_PAYER_SECRET` disables Solana legs. */
let keypair: Keypair | undefined;
export function feePayer(): Keypair {
  if (!env.SOLANA_FEE_PAYER_SECRET) throw createHttpError("Solana fee sponsoring is not configured.", { code: "ROUTE_UNAVAILABLE" });
  return (keypair ??= Keypair.fromSecretKey(bs58.decode(env.SOLANA_FEE_PAYER_SECRET)));
}

export const messageHash = (tx: VersionedTransaction): string => createHash("sha256").update(tx.message.serialize()).digest("hex");

/** The unsigned transaction the user signs: the hash returned here is what the planner stores and `cosignAndSubmit` later demands. */
export function describeUnsigned(serializedBase64: string): { serializedBase64: string; messageHash: string } {
  return { serializedBase64, messageHash: messageHash(VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64"))) };
}

const ata = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

/**
 * The network fee leg: a USDC TransferChecked from the user's token account to the platform treasury's, fee payer = platform (which also creates
 * the treasury token account if it is missing). Server-built, so the planner knows every byte.
 */
export async function buildFeeTransfer(i: { owner: string; amountMicro: bigint }): Promise<{ serializedBase64: string; messageHash: string }> {
  if (!env.GAS_TREASURY_SOLANA_ADDRESS) throw createHttpError("The gas treasury is not configured.", { code: "ROUTE_UNAVAILABLE" });
  const [payer, owner, treasury, mint] = [feePayer().publicKey, new PublicKey(i.owner), new PublicKey(env.GAS_TREASURY_SOLANA_ADDRESS), new PublicKey(USDC_SOLANA_MINT)];
  const [from, to] = [ata(owner, mint), ata(treasury, mint)];
  const amount = Buffer.alloc(10);
  amount[0] = 12; // TransferChecked
  amount.writeBigUInt64LE(i.amountMicro, 1);
  amount[9] = USDC_DECIMALS;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      new TransactionInstruction({ programId: ATA_PROGRAM, data: Buffer.from([1]), keys: [ // CreateIdempotent
        { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: to, isSigner: false, isWritable: true }, { pubkey: treasury, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ] }),
      new TransactionInstruction({ programId: TOKEN_PROGRAM, data: amount, keys: [
        { pubkey: from, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: to, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false },
      ] }),
    ],
  }).compileToV0Message();
  return describeUnsigned(Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"));
}

/** Verifies the user-signed transaction is byte-identical to the message we built, then adds the platform fee-payer signature and submits. */
export async function cosignAndSubmit(signedBase64: string, storedMessageHash: string): Promise<string> {
  const tx = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64"));
  if (messageHash(tx) !== storedMessageHash) throw createHttpError(409, "The transaction changed after it was prepared.", { code: "TX_MISMATCH" });
  if (!tx.message.staticAccountKeys[0]!.equals(feePayer().publicKey)) throw createHttpError(409, "Unexpected fee payer.", { code: "TX_MISMATCH" });
  tx.sign([feePayer()]); // adds only the fee-payer signature; user signatures already present stay valid because the message is unchanged
  // One attempt, never retried. A preflight rejection is definitive (rethrown as is); anything else is an unknown outcome, so the error carries the
  // transaction signature (deterministic, the fee-payer's) for the caller to record and the tracker to look up.
  try {
    return await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 });
  } catch (err) {
    if (err instanceof SendTransactionError) throw err;
    throw Object.assign(err instanceof Error ? err : new Error("send failed"), { unknownOutcomeSignature: bs58.encode(tx.signatures[0]!) });
  }
}

/** `finalized` and `failed` are terminal; `pending` covers not-yet-seen and not-yet-finalized. */
export async function solanaFinality(signature: string): Promise<"finalized" | "failed" | "pending"> {
  const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  if (!value) return "pending";
  if (value.err) return "failed";
  return value.confirmationStatus === "finalized" ? "finalized" : "pending";
}


/** Balance in base units (lamports, or the token's raw amount summed over the owner's token accounts). */
export async function solanaBalance(owner: string, mint: string | null): Promise<bigint> {
  const ownerKey = new PublicKey(owner);
  if (!mint) return BigInt(await connection.getBalance(ownerKey, "finalized"));
  const { value } = await connection.getParsedTokenAccountsByOwner(ownerKey, { mint: new PublicKey(mint) }, "finalized");
  return value.reduce((sum, a) => sum + BigInt((a.account.data.parsed as { info: { tokenAmount: { amount: string } } }).info.tokenAmount.amount), 0n);
}

/** What `owner` received in a finalized transaction, from its balance change (token: pre/post token balances; native: lamports). Null when the transaction is not found. */
export async function solanaReceived(signature: string, owner: string, mint: string | null): Promise<bigint | null> {
  const tx = await connection.getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  if (!tx?.meta || tx.meta.err) return null;
  if (mint) {
    const sum = (rows: typeof tx.meta.postTokenBalances) => (rows ?? []).filter((b) => b.owner === owner && b.mint === mint).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  }
  const index = tx.transaction.message.accountKeys.findIndex((k) => k.pubkey.toBase58() === owner);
  return index < 0 ? 0n : BigInt(tx.meta.postBalances[index]!) - BigInt(tx.meta.preBalances[index]!);
}

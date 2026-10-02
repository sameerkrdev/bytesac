import { createHash } from "node:crypto";
import bs58 from "bs58";
import createHttpError from "http-errors";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
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
 * The fee leg: one USDC TransferChecked per recorded fee from the user's token account to each recipient's (network, manager, platform, in that order),
 * fee payer = platform (which also creates a recipient token account that is missing). Server-built, so the planner knows every byte.
 */
export async function buildFeeTransfer(i: { owner: string; transfers: { recipient: string; amountMicro: bigint }[] }): Promise<{ serializedBase64: string; messageHash: string }> {
  const [payer, owner, mint] = [feePayer().publicKey, new PublicKey(i.owner), new PublicKey(USDC_SOLANA_MINT)];
  const from = ata(owner, mint);
  const instructions = i.transfers.flatMap((t) => {
    const recipient = new PublicKey(t.recipient);
    const to = ata(recipient, mint);
    const amount = Buffer.alloc(10);
    amount[0] = 12; // TransferChecked
    amount.writeBigUInt64LE(t.amountMicro, 1);
    amount[9] = USDC_DECIMALS;
    return [
      new TransactionInstruction({ programId: ATA_PROGRAM, data: Buffer.from([1]), keys: [ // CreateIdempotent
        { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: to, isSigner: false, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: false },
        { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ] }),
      new TransactionInstruction({ programId: TOKEN_PROGRAM, data: amount, keys: [
        { pubkey: from, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: to, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: true, isWritable: false },
      ] }),
    ];
  });
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  return describeUnsigned(Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"));
}

/** Token-program account rent (165 bytes): what the fee payer funds for each `CreateIdempotent` that creates an account. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;
/** Used for the rent estimate only when LI.FI's gas costs carry no native token price. */
export const SOL_USD_FALLBACK = 150;
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";
const LAMPORTS_PER_SIGNATURE = 5_000n;
/** Priority fee the platform will pay for one transaction (price x limit), the instruction and static-account counts it accepts. */
const MAX_PRIORITY_LAMPORTS = 1_000_000n;
const MAX_INSTRUCTIONS = 24;
const MAX_STATIC_ACCOUNTS = 64;

/**
 * What the platform fee payer is exposed to in a provider-built (or server-built) transaction, or a 503 ROUTE_UNAVAILABLE when it may pay for more
 * than fees: the fee payer must be the payer at index 0 and appear nowhere else in the static accounts (lookup tables cannot resolve to a key already
 * present: the runtime rejects an account loaded twice), it may be referenced by no instruction except as the funder of an ATA `CreateIdempotent`
 * (rent, counted), the priority fee (price x limit) is capped, and the instruction and account counts are bounded.
 */
export function sponsorExposure(serializedBase64: string): { lamports: bigint; rentLamports: bigint } {
  const refuse = (why: string) => createHttpError(`The route returned a transaction the platform won't sponsor (${why}).`, { code: "ROUTE_UNAVAILABLE" });
  const message = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64")).message;
  const keys = message.staticAccountKeys;
  const payer = feePayer().publicKey;
  if (!keys[0]!.equals(payer) || keys.filter((k) => k.equals(payer)).length !== 1) throw refuse("fee payer");
  if (keys.length > MAX_STATIC_ACCOUNTS || message.compiledInstructions.length > MAX_INSTRUCTIONS) throw refuse("size");
  let creates = 0n;
  let price = 0n;
  let limit: bigint | null = null;
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex]!.toBase58();
    if (ix.programIdIndex === 0) throw refuse("fee payer as program");
    if (program === COMPUTE_BUDGET) {
      const data = Buffer.from(ix.data);
      if (data[0] === 0) throw refuse("deprecated compute budget instruction"); // RequestUnits carries its own additional fee
      if ((data[0] === 2 && data.length < 5) || (data[0] === 3 && data.length < 9)) throw refuse("compute budget data");
      if (data[0] === 2) limit = BigInt(data.readUInt32LE(1));
      if (data[0] === 3) price = data.readBigUInt64LE(1);
    }
    const uses = ix.accountKeyIndexes.filter((i) => i === 0).length;
    if (uses === 0) continue;
    // Only the first account (the funder) of ATA CreateIdempotent may be the fee payer.
    if (program !== ATA_PROGRAM.toBase58() || ix.data[0] !== 1 || ix.accountKeyIndexes[0] !== 0 || uses !== 1) throw refuse("fee payer used by an instruction");
    creates += 1n;
  }
  const priority = (price * (limit ?? 1_400_000n) + 999_999n) / 1_000_000n; // micro-lamports per unit; no limit set means the 1.4M maximum
  if (priority > MAX_PRIORITY_LAMPORTS) throw refuse("priority fee");
  const rentLamports = creates * TOKEN_ACCOUNT_RENT_LAMPORTS;
  return { lamports: BigInt(message.header.numRequiredSignatures) * LAMPORTS_PER_SIGNATURE + priority + rentLamports, rentLamports };
}

/**
 * Verifies the user-signed transaction is byte-identical to the message we stored a hash for and still safe to sponsor, then adds the platform
 * fee-payer signature. Nothing is sent: the caller claims the leg under `signature` first, then sends `raw` with `sendSolana`.
 */
export function cosign(signedBase64: string, storedMessageHash: string): { raw: Uint8Array; signature: string; recentBlockhash: string } {
  const tx = VersionedTransaction.deserialize(Buffer.from(signedBase64, "base64"));
  if (messageHash(tx) !== storedMessageHash) throw createHttpError(409, "The transaction changed after it was prepared.", { code: "TX_MISMATCH" });
  if (!tx.message.staticAccountKeys[0]!.equals(feePayer().publicKey)) throw createHttpError(409, "Unexpected fee payer.", { code: "TX_MISMATCH" });
  sponsorExposure(signedBase64);
  tx.sign([feePayer()]); // adds only the fee-payer signature; user signatures already present stay valid because the message is unchanged
  return { raw: tx.serialize(), signature: bs58.encode(tx.signatures[0]!), recentBlockhash: tx.message.recentBlockhash };
}

/** One attempt, never retried. A `SendTransactionError` is a definitive refusal; any other failure leaves the outcome unknown. */
export const sendSolana = (raw: Uint8Array): Promise<string> => connection.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 0 });

/**
 * `finalized` and `failed` are terminal; `pending` covers not-yet-seen and not-yet-finalized. With `recentBlockhash`: a signature that is still not
 * found after that blockhash expired can never land, so it is `expired` (checked in this order: the expiry first, then the lookup).
 */
export async function solanaFinality(signature: string, recentBlockhash?: string): Promise<"finalized" | "failed" | "pending" | "expired"> {
  const expired = recentBlockhash ? !(await connection.isBlockhashValid(recentBlockhash, { commitment: "confirmed" })).value : false;
  const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  if (!value) return expired ? "expired" : "pending";
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

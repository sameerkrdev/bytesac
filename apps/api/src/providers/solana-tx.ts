import { createHash } from "node:crypto";
import bs58 from "bs58";
import createHttpError from "http-errors";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { BLOCKHASH_LIFETIME_BLOCKS, BLOCKHASH_MARGIN_BLOCKS, USDC_DECIMALS, USDC_SOLANA_MINT } from "@repo/validator";
import { env } from "@/config/dotenv";

export const connection = new Connection(`https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, { commitment: "confirmed" });

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

/** The platform fee payer, used only by legacy legs planned before user-paid gas (co-signed). The key never leaves this module; an empty `SOLANA_FEE_PAYER_SECRET` refuses those legs. */
let keypair: Keypair | undefined;
export function feePayer(): Keypair {
  if (!env.SOLANA_FEE_PAYER_SECRET) throw createHttpError("Solana fee sponsoring is not configured.", { code: "ROUTE_UNAVAILABLE" });
  return (keypair ??= Keypair.fromSecretKey(bs58.decode(env.SOLANA_FEE_PAYER_SECRET)));
}

export const messageHash = (tx: VersionedTransaction): string => createHash("sha256").update(tx.message.serialize()).digest("hex");

/** The unsigned transaction the user signs: the hash returned here is what the planner stores and `cosign` later demands (byte-identical, or CU-only wallet padding with the prepared bytes). */
export function describeUnsigned(serializedBase64: string): { serializedBase64: string; messageHash: string } {
  return { serializedBase64, messageHash: messageHash(VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64"))) };
}

export const ata = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM.toBuffer(), mint.toBuffer()], ATA_PROGRAM)[0];

/** Whether `owner` has no token account for `mint` yet. An RPC error counts as missing: rent estimates stay conservative. */
export const tokenAccountMissing = (owner: string, mint: string): Promise<boolean> => connection.getAccountInfo(ata(new PublicKey(owner), new PublicKey(mint)), "confirmed").then((info) => !info, () => true);

/**
 * The fee leg: compute-budget (same CU limit/price as live LI.FI Solana quotes), then one USDC TransferChecked per recorded fee from the user's
 * token account to each recipient's (network, manager, platform, in that order). The payer also funds any recipient token account that is missing.
 * Server-built; verification allows wallet compute-budget padding when non-CU instructions still match. The payer is the user (new legs: they pay
 * the fee in SOL, one signature) or the platform (legs planned before user-paid gas: co-signed).
 */
const FEE_LEG_CU_LIMIT = 1_400_000;
const FEE_LEG_CU_PRICE_MICRO = 16_001n;
/** The user-paid fee transfer (one signature, a few token instructions) needs far less than the platform-paid one: right-sized so it is cheap to prioritise (spec 22 B-24). */
export const USER_FEE_CU_LIMIT = 200_000;
const USER_FEE_PRICE_MIN_MICRO = 16_001n;
const USER_FEE_PRICE_MAX_MICRO = 2_500_000n;
const FEE_LEG_PRIORITY_LAMPORTS = (FEE_LEG_CU_PRICE_MICRO * BigInt(FEE_LEG_CU_LIMIT) + 999_999n) / 1_000_000n;
/** Two signatures plus the fee-leg priority fee. Token-account rent is added by the planner per missing recipient ATA. */
export const SOLANA_FEE_TRANSFER_LAMPORTS = 10_000n + FEE_LEG_PRIORITY_LAMPORTS;
/**
 * The most the user pays for the fee transfer as fee payer: one signature plus the priority fee at the price cap (the plan cannot know the price the group will
 * quote, B-24). Token-account rent is added per missing recipient account.
 */
export const FEE_TRANSFER_USER_LAMPORTS = 5_000n + (USER_FEE_PRICE_MAX_MICRO * BigInt(USER_FEE_CU_LIMIT) + 999_999n) / 1_000_000n;

export async function buildFeeTransfer(i: { owner: string; payer: "user" | "platform"; transfers: { recipient: string; amountMicro: bigint }[] }): Promise<{ serializedBase64: string; messageHash: string }> {
  const [owner, mint] = [new PublicKey(i.owner), new PublicKey(USDC_SOLANA_MINT)];
  const payer = i.payer === "user" ? owner : feePayer().publicKey;
  const from = ata(owner, mint);
  // User-paid: the 75th percentile of the non-zero recent fees paid by transactions locking the user's USDC account, clamped; an RPC error or no data gives the floor (B-24).
  const recent = i.payer === "user"
    ? (await connection.getRecentPrioritizationFees({ lockedWritableAccounts: [from] }).catch(() => [])).map((f) => f.prioritizationFee).filter((f) => f > 0).sort((a, b) => a - b)
    : [];
  const p75 = BigInt(recent[Math.floor((recent.length - 1) * 0.75)] ?? 0);
  const price = i.payer === "platform" ? FEE_LEG_CU_PRICE_MICRO : p75 < USER_FEE_PRICE_MIN_MICRO ? USER_FEE_PRICE_MIN_MICRO : p75 > USER_FEE_PRICE_MAX_MICRO ? USER_FEE_PRICE_MAX_MICRO : p75;
  const instructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: i.payer === "user" ? USER_FEE_CU_LIMIT : FEE_LEG_CU_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
    ...i.transfers.flatMap((t) => {
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
    }),
  ];
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message();
  return describeUnsigned(Buffer.from(new VersionedTransaction(message).serialize()).toString("base64"));
}

/** Token-program account rent (165 bytes): what the fee payer funds for each `CreateIdempotent` that creates an account. */
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280n;
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
 * What a user-paid transaction costs its fee payer `payer` before rent: signatures and the priority fee (price x limit; 1.4M when unset), plus the token
 * accounts the payer funds (`CreateIdempotent`, address null when it sits behind a lookup table and cannot be read). Refuses nothing: the user signs it knowingly.
 */
export function solanaCost(serializedBase64: string, payer: string): { lamports: bigint; funded: (string | null)[] } {
  const message = VersionedTransaction.deserialize(Buffer.from(serializedBase64, "base64")).message;
  const keys = message.staticAccountKeys;
  const payerIndex = keys.findIndex((k) => k.toBase58() === payer);
  let price = 0n;
  let limit: bigint | null = null;
  const funded: (string | null)[] = [];
  for (const ix of message.compiledInstructions) {
    const program = keys[ix.programIdIndex]!.toBase58();
    const data = Buffer.from(ix.data);
    if (program === COMPUTE_BUDGET && data[0] === 2 && data.length >= 5) limit = BigInt(data.readUInt32LE(1));
    if (program === COMPUTE_BUDGET && data[0] === 3 && data.length >= 9) price = data.readBigUInt64LE(1);
    if (program === ATA_PROGRAM.toBase58() && data[0] === 1 && ix.accountKeyIndexes[0] === payerIndex) funded.push(keys[ix.accountKeyIndexes[1]!]?.toBase58() ?? null);
  }
  return { lamports: BigInt(message.header.numRequiredSignatures) * LAMPORTS_PER_SIGNATURE + (price * (limit ?? 1_400_000n) + 999_999n) / 1_000_000n, funded };
}

/**
 * What `payer` must hold for these transactions: their `solanaCost` plus rent for each funded token account that does not exist yet (spec 22 B-23; an account two
 * transactions both fund counts once). An RPC error counts every account as missing, as `tokenAccountMissing` does: the estimate stays conservative.
 */
export async function solanaNeed(txs: string[], payer: string): Promise<bigint> {
  const costs = txs.map((t) => solanaCost(t, payer));
  const addresses = [...new Set(costs.flatMap((c) => c.funded).filter((a): a is string => a !== null))];
  const infos = addresses.length ? await connection.getMultipleAccountsInfo(addresses.map((a) => new PublicKey(a)), "confirmed").catch(() => addresses.map(() => null)) : [];
  const missing = infos.filter((info) => !info).length + costs.reduce((t, c) => t + c.funded.filter((a) => a === null).length, 0);
  return costs.reduce((t, c) => t + c.lamports, 0n) + BigInt(missing) * TOKEN_ACCOUNT_RENT_LAMPORTS;
}

/** Bytes that are not a transaction at all are the caller's mismatch (409), never a 500. */
function deserializeOrMismatch(input: string | Uint8Array): VersionedTransaction {
  try {
    return VersionedTransaction.deserialize(typeof input === "string" ? Buffer.from(input, "base64") : input);
  } catch {
    throw createHttpError(409, "The signed transaction isn't a valid transaction.", { code: "TX_MISMATCH" });
  }
}

/** Non-compute-budget instructions as program + accounts + data (pubkeys resolved from static keys only). */
function nonComputeCore(tx: VersionedTransaction): { program: string; accounts: string[]; data: string }[] {
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions
    .filter((ix) => keys[ix.programIdIndex]!.toBase58() !== COMPUTE_BUDGET)
    .map((ix) => ({
      program: keys[ix.programIdIndex]!.toBase58(),
      accounts: ix.accountKeyIndexes.map((i) => keys[i]!.toBase58()),
      data: Buffer.from(ix.data).toString("hex"),
    }));
}

/** Same lookup tables, indexes in the same order. Compared field by field: a message built from an RPC response lists the fields in another order than a deserialized one. */
const sameLookups = (a: VersionedTransaction["message"]["addressTableLookups"], b: VersionedTransaction["message"]["addressTableLookups"]): boolean => {
  const same = (x: number[], y: number[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  return a.length === b.length && a.every((l, i) => l.accountKey.equals(b[i]!.accountKey) && same(l.writableIndexes, b[i]!.writableIndexes) && same(l.readonlyIndexes, b[i]!.readonlyIndexes));
};

/** True when the wallet message differs from the prepared one only in ComputeBudget instructions (or their values). */
export function sameExceptComputeBudget(prepared: VersionedTransaction, signed: VersionedTransaction): boolean {
  if (prepared.message.recentBlockhash !== signed.message.recentBlockhash) return false;
  if (!sameLookups(prepared.message.addressTableLookups, signed.message.addressTableLookups)) return false;
  const pKeys = prepared.message.staticAccountKeys;
  const sKeys = signed.message.staticAccountKeys;
  // CU data rewrite keeps the account key list identical: compare compiled non-CU wire form (works with address lookups).
  if (pKeys.length === sKeys.length && pKeys.every((k, i) => k.equals(sKeys[i]!))) {
    const strip = (tx: VersionedTransaction) => tx.message.compiledInstructions
      .filter((ix) => tx.message.staticAccountKeys[ix.programIdIndex]!.toBase58() !== COMPUTE_BUDGET)
      .map((ix) => ({ programIdIndex: ix.programIdIndex, accountKeyIndexes: [...ix.accountKeyIndexes], data: Buffer.from(ix.data).toString("hex") }));
    return JSON.stringify(strip(prepared)) === JSON.stringify(strip(signed));
  }
  // CU injection can insert ComputeBudget into the static key list (indexes shift). Only safe without address lookups.
  if (prepared.message.addressTableLookups.length || signed.message.addressTableLookups.length) return false;
  return JSON.stringify(nonComputeCore(prepared)) === JSON.stringify(nonComputeCore(signed));
}

/** The landed transaction as a comparable message, or null when the RPC does not show it. */
export async function landedTx(signature: string): Promise<VersionedTransaction | null> {
  const landed = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  return landed ? new VersionedTransaction(landed.transaction.message) : null;
}

/**
 * Proof that a signature a wallet reported (sign-and-send) is OUR prepared transaction: the landed message equals the prepared one (ComputeBudget differences
 * allowed) and its fee payer is `owner`. Null while the transaction cannot be fetched yet.
 */
export async function landedMatchesPrepared(signature: string, preparedBase64: string, owner: string): Promise<boolean | null> {
  const landed = await landedTx(signature);
  if (!landed) return null;
  return landed.message.staticAccountKeys[0]!.toBase58() === owner && sameExceptComputeBudget(VersionedTransaction.deserialize(Buffer.from(preparedBase64, "base64")), landed);
}

/**
 * Verifies the user-signed transaction matches the prepared message (byte-identical, or only ComputeBudget differs when `preparedBase64`
 * is the quote we stored) and is still safe to sponsor, then adds the platform fee-payer signature. Nothing is sent: the caller claims
 * the leg under `signature` first, then sends `raw` with `sendSolana`.
 */
export function cosign(signedBase64: string, storedMessageHash: string, preparedBase64?: string): { raw: Uint8Array; signature: string; recentBlockhash: string } {
  const mismatch = () => createHttpError(409, "The transaction changed after it was prepared.", { code: "TX_MISMATCH" });
  const tx = deserializeOrMismatch(signedBase64);
  if (!storedMessageHash) throw mismatch();
  if (!tx.message.staticAccountKeys[0]!.equals(feePayer().publicKey)) throw createHttpError(409, "Unexpected fee payer.", { code: "TX_MISMATCH" });
  if (messageHash(tx) !== storedMessageHash) {
    if (!preparedBase64) throw mismatch();
    const prepared = VersionedTransaction.deserialize(Buffer.from(preparedBase64, "base64"));
    if (messageHash(prepared) !== storedMessageHash || !sameExceptComputeBudget(prepared, tx)) throw mismatch();
  }
  sponsorExposure(signedBase64);
  tx.sign([feePayer()]); // adds only the fee-payer signature; the message is the one the user signed (possibly with wallet CU padding)
  return { raw: tx.serialize(), signature: bs58.encode(tx.signatures[0]!), recentBlockhash: tx.message.recentBlockhash };
}

/**
 * A user-paid transaction the user signed: the fee payer (index 0) is `owner`, the message is the quoted one (byte-identical, or ComputeBudget-only
 * changes against `preparedBase64`), and the owner's ed25519 signature verifies. Nothing is sent; the caller claims first (ADR-014 claim before send).
 */
export function verifyUserSigned(signedBase64: string, i: { owner: string; storedMessageHash: string; preparedBase64?: string }): { raw: Uint8Array; signature: string; recentBlockhash: string } {
  const mismatch = (why: string) => createHttpError(409, `The transaction changed after it was prepared (${why}).`, { code: "TX_MISMATCH" });
  const raw = Buffer.from(signedBase64, "base64");
  if (raw.length > 1232) throw mismatch("size");
  const tx = deserializeOrMismatch(raw);
  const owner = new PublicKey(i.owner);
  if (!i.storedMessageHash || !tx.message.staticAccountKeys[0]!.equals(owner)) throw mismatch("fee payer");
  if (messageHash(tx) !== i.storedMessageHash) {
    if (!i.preparedBase64) throw mismatch("message");
    const prepared = VersionedTransaction.deserialize(Buffer.from(i.preparedBase64, "base64"));
    if (messageHash(prepared) !== i.storedMessageHash || !sameExceptComputeBudget(prepared, tx)) throw mismatch("message");
  }
  if (!ed25519.verify(tx.signatures[0]!, tx.message.serialize(), owner.toBytes())) throw mismatch("signature");
  return { raw: tx.serialize(), signature: bs58.encode(tx.signatures[0]!), recentBlockhash: tx.message.recentBlockhash };
}

/** The send gate (spec 22 section 6.2 step 9): the blockhash is still valid and, measured from the group's quote height, has at least the margin left. */
export async function blockhashUsable(recentBlockhash: string, quoteBlockHeight: number): Promise<boolean> {
  const [valid, height] = await Promise.all([connection.isBlockhashValid(recentBlockhash, { commitment: "confirmed" }), connection.getBlockHeight("confirmed")]);
  return valid.value && height <= quoteBlockHeight + BLOCKHASH_LIFETIME_BLOCKS - BLOCKHASH_MARGIN_BLOCKS;
}

/** One send call, never retried by this server; the RPC rebroadcasts until the blockhash expires (spec 22 B-25). A `SendTransactionError` is a definitive refusal; any other failure leaves the outcome unknown. */
export const sendSolana = (raw: Uint8Array): Promise<string> => connection.sendRawTransaction(raw, { skipPreflight: false });

/**
 * True once `signature` is confirmed or finalized without error; false when it failed or `waitMs` passes first (always asks at least once). Polls every 500 ms.
 * With `raw` (the identical signed bytes) it re-sends them every 2 s while it waits; never re-signed or rebuilt, send errors ignored (B-25).
 */
export async function solanaConfirmed(signature: string, waitMs: number, raw?: Uint8Array): Promise<boolean> {
  const until = Date.now() + waitMs;
  let resentAt = Date.now();
  for (;;) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status?.err) return false;
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return true;
    if (Date.now() >= until) return false;
    if (raw && Date.now() - resentAt >= 2_000) {
      resentAt = Date.now();
      sendSolana(raw).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

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

/** Block time of a finalized transaction; null when it cannot be read. */
export async function solanaBlockTime(signature: string): Promise<Date | null> {
  const tx = await connection.getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
  return tx?.blockTime != null ? new Date(tx.blockTime * 1000) : null;
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

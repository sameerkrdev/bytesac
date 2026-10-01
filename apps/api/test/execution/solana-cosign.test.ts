import { createPublicKey, verify } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USDC_SOLANA_MINT } from "@repo/validator";
import { buildFeeTransfer, connection, cosign, describeUnsigned, feePayer, sendSolana, solanaFinality, sponsorExposure } from "../../src/providers/solana-tx";

const BLOCKHASH = bs58.encode(Buffer.alloc(32, 7));
const user = Keypair.generate();
const recipient = Keypair.generate().publicKey;

/** An unsigned transfer from `user` to `to`, fee payer `payer`, like a planner-built or LI.FI transaction. */
const unsigned = (payer: PublicKey, lamports: bigint, to = recipient) =>
  new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: BLOCKHASH, instructions: [SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: to, lamports })] }).compileToV0Message());
const b64 = (tx: VersionedTransaction) => Buffer.from(tx.serialize()).toString("base64");
/** The wallet's step: it signs the message it was shown and returns the transaction with the fee-payer slot still empty. */
const userSigned = (tx: VersionedTransaction) => { tx.sign([user]); return b64(tx); };

let send: ReturnType<typeof vi.spyOn>;
beforeEach(() => { send = vi.spyOn(connection, "sendRawTransaction").mockResolvedValue("SENT_SIGNATURE"); });
afterEach(() => vi.restoreAllMocks());

describe("fee-payer co-signing", () => {
  it("co-signs a byte-identical message once, keeps the user's signature valid and sends without retries", async () => {
    const tx = unsigned(feePayer().publicKey, 5_000n);
    const { messageHash } = describeUnsigned(b64(tx));
    const signed = cosign(userSigned(tx), messageHash);
    expect(send).not.toHaveBeenCalled(); // co-signing never sends: the caller claims the leg first
    expect(await sendSolana(signed.raw)).toBe("SENT_SIGNATURE");
    expect(signed.signature).toBe(bs58.encode(VersionedTransaction.deserialize(signed.raw).signatures[0]!));
    expect(signed.recentBlockhash).toBe(BLOCKHASH);
    expect(send).toHaveBeenCalledTimes(1);
    const [raw, options] = send.mock.calls[0] as [Uint8Array, object];
    expect(options).toEqual({ skipPreflight: false, maxRetries: 0 });
    const sent = VersionedTransaction.deserialize(raw);
    const message = sent.message.serialize();
    const ed25519 = (pub: PublicKey, sig: Uint8Array) => verify(null, Buffer.from(message), createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pub.toBytes()).toString("base64url") }, format: "jwk" }), sig);
    expect(ed25519(feePayer().publicKey, sent.signatures[0]!)).toBe(true);
    expect(ed25519(user.publicKey, sent.signatures[1]!)).toBe(true);
  });

  it("refuses a transaction whose instruction changed after it was prepared (Review Focus 1): fee payer never signs, nothing is sent", async () => {
    const prepared = unsigned(feePayer().publicKey, 5_000n);
    const { messageHash } = describeUnsigned(b64(prepared));
    const tampered = unsigned(feePayer().publicKey, 5_000_000_000n, Keypair.generate().publicKey);
    expect(() => cosign(userSigned(tampered), messageHash)).toThrow(expect.objectContaining({ code: "TX_MISMATCH" }));
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a transaction whose fee payer is not the platform, even when its hash was stored", async () => {
    const stranger = unsigned(Keypair.generate().publicKey, 5_000n);
    const { messageHash } = describeUnsigned(b64(stranger));
    expect(() => cosign(userSigned(stranger), messageHash)).toThrow(expect.objectContaining({ code: "TX_MISMATCH" }));
    expect(send).not.toHaveBeenCalled();
  });

  it("never signs when no hash was stored", async () => {
    const tx = unsigned(feePayer().publicKey, 5_000n);
    expect(() => cosign(userSigned(tx), "")).toThrow(expect.objectContaining({ code: "TX_MISMATCH" }));
    expect(send).not.toHaveBeenCalled();
  });
});

describe("fee-payer exposure (I4)", () => {
  const payer = () => feePayer().publicKey;
  const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  const COMPUTE = new PublicKey("ComputeBudget111111111111111111111111111111");
  const mint = Keypair.generate().publicKey;
  const build = (instructions: TransactionInstruction[]) => b64(new VersionedTransaction(new TransactionMessage({ payerKey: payer(), recentBlockhash: BLOCKHASH, instructions }).compileToV0Message()));
  const createAta = (funder: PublicKey, data = 1) => new TransactionInstruction({ programId: ATA, data: Buffer.from([data]), keys: [
    { pubkey: funder, isSigner: true, isWritable: true }, { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, { pubkey: user.publicKey, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ] });
  const budget = (price: bigint, limit: number) => [
    new TransactionInstruction({ programId: COMPUTE, keys: [], data: Buffer.concat([Buffer.from([2]), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(limit); return b; })()]) }),
    new TransactionInstruction({ programId: COMPUTE, keys: [], data: Buffer.concat([Buffer.from([3]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(price); return b; })()]) }),
  ];
  const transfer = SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: recipient, lamports: 1n });

  it("prices signatures, priority fee and token-account rent", () => {
    expect(sponsorExposure(build([transfer]))).toEqual({ lamports: 10_000n, rentLamports: 0n });
    const e = sponsorExposure(build([...budget(10_000n, 200_000), createAta(payer()), transfer]));
    expect(e.rentLamports).toBe(2_039_280n);
    expect(e.lamports).toBe(10_000n + 2_000n + 2_039_280n); // 2 signatures + 10,000 micro-lamports x 200,000 units + rent
  });

  it("refuses a fee payer that funds anything but an ATA create", () => {
    const drain = SystemProgram.transfer({ fromPubkey: payer(), toPubkey: recipient, lamports: 1_000_000n });
    expect(() => sponsorExposure(build([drain]))).toThrow(expect.objectContaining({ code: "ROUTE_UNAVAILABLE" }));
    expect(() => sponsorExposure(build([createAta(payer(), 0)]))).toThrow(expect.objectContaining({ code: "ROUTE_UNAVAILABLE" })); // plain Create is not CreateIdempotent
    const asSecond = new TransactionInstruction({ programId: ATA, data: Buffer.from([1]), keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: true }, { pubkey: payer(), isSigner: false, isWritable: true }] });
    expect(() => sponsorExposure(build([asSecond]))).toThrow(expect.objectContaining({ code: "ROUTE_UNAVAILABLE" }));
  });

  it("refuses a fee payer that is not the payer at index 0, an excessive priority fee and oversized transactions", () => {
    expect(() => sponsorExposure(b64(unsigned(Keypair.generate().publicKey, 1n)))).toThrow(expect.objectContaining({ code: "ROUTE_UNAVAILABLE" }));
    expect(() => sponsorExposure(build([...budget(1_000_000_000n, 1_400_000), transfer]))).toThrow(expect.objectContaining({ code: "ROUTE_UNAVAILABLE" }));
    expect(() => sponsorExposure(build([...budget(1_000_000n, 0), transfer]))).not.toThrow(); // a zero limit prices nothing
    expect(() => sponsorExposure(build(Array.from({ length: 25 }, () => transfer)))).toThrow(expect.objectContaining({ code: "ROUTE_UNAVAILABLE" }));
  });

  it("cosign refuses an unsponsorable transaction even when its hash matches", () => {
    const drain = SystemProgram.transfer({ fromPubkey: payer(), toPubkey: recipient, lamports: 1_000_000n });
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer(), recentBlockhash: BLOCKHASH, instructions: [drain] }).compileToV0Message());
    const { messageHash } = describeUnsigned(b64(tx));
    expect(() => cosign(b64(tx), messageHash)).toThrow(expect.objectContaining({ code: "ROUTE_UNAVAILABLE" }));
  });
});

describe("network fee transfer", () => {
  it("builds a USDC TransferChecked from the user to the treasury with the platform as fee payer", async () => {
    vi.spyOn(connection, "getLatestBlockhash").mockResolvedValue({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
    const built = await buildFeeTransfer({ owner: user.publicKey.toBase58(), amountMicro: 123_456n });
    const tx = VersionedTransaction.deserialize(Buffer.from(built.serializedBase64, "base64"));
    expect(describeUnsigned(built.serializedBase64).messageHash).toBe(built.messageHash);
    expect(tx.message.staticAccountKeys[0]!.equals(feePayer().publicKey)).toBe(true);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(user.publicKey.toBase58());
    expect(keys).toContain(USDC_SOLANA_MINT);
    const transfer = tx.message.compiledInstructions.at(-1)!;
    const data = Buffer.from(transfer.data);
    expect([data[0], data.readBigUInt64LE(1), data[9]]).toEqual([12, 123_456n, 6]);
    // The user is the owner (a required signer) of the transfer; the fee payer signs nothing the user did not see.
    expect(keys[transfer.accountKeyIndexes[3]!]).toBe(user.publicKey.toBase58());
  });
});

describe("finality", () => {
  it("maps signature statuses", async () => {
    const status = vi.spyOn(connection, "getSignatureStatus");
    status.mockResolvedValueOnce({ context: { slot: 1 }, value: null });
    expect(await solanaFinality("a")).toBe("pending");
    status.mockResolvedValueOnce({ context: { slot: 1 }, value: { slot: 1, confirmations: 3, err: null, confirmationStatus: "confirmed" } });
    expect(await solanaFinality("a")).toBe("pending");
    status.mockResolvedValueOnce({ context: { slot: 1 }, value: { slot: 1, confirmations: null, err: null, confirmationStatus: "finalized" } });
    expect(await solanaFinality("a")).toBe("finalized");
    status.mockResolvedValueOnce({ context: { slot: 1 }, value: { slot: 1, confirmations: null, err: { InstructionError: [0, "Custom"] }, confirmationStatus: "finalized" } });
    expect(await solanaFinality("a")).toBe("failed");
  });

  it("a signature that never landed after its blockhash expired is expired (a dropped transaction), never earlier", async () => {
    const status = vi.spyOn(connection, "getSignatureStatus").mockResolvedValue({ context: { slot: 1 }, value: null });
    const valid = vi.spyOn(connection, "isBlockhashValid").mockResolvedValue({ context: { slot: 1 }, value: true });
    expect(await solanaFinality("a", BLOCKHASH)).toBe("pending");
    valid.mockResolvedValue({ context: { slot: 1 }, value: false });
    expect(await solanaFinality("a", BLOCKHASH)).toBe("expired");
    expect(await solanaFinality("a")).toBe("pending"); // without a blockhash nothing can expire
    status.mockResolvedValue({ context: { slot: 1 }, value: { slot: 1, confirmations: null, err: null, confirmationStatus: "finalized" } });
    expect(await solanaFinality("a", BLOCKHASH)).toBe("finalized"); // landed before it expired
  });
});

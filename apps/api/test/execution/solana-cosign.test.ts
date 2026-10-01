import { createPublicKey, verify } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USDC_SOLANA_MINT } from "@repo/validator";
import { buildFeeTransfer, connection, cosignAndSubmit, describeUnsigned, feePayer, solanaFinality } from "../../src/providers/solana-tx";

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
    expect(await cosignAndSubmit(userSigned(tx), messageHash)).toBe("SENT_SIGNATURE");
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
    await expect(cosignAndSubmit(userSigned(tampered), messageHash)).rejects.toMatchObject({ code: "TX_MISMATCH" });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a transaction whose fee payer is not the platform, even when its hash was stored", async () => {
    const stranger = unsigned(Keypair.generate().publicKey, 5_000n);
    const { messageHash } = describeUnsigned(b64(stranger));
    await expect(cosignAndSubmit(userSigned(stranger), messageHash)).rejects.toMatchObject({ code: "TX_MISMATCH" });
    expect(send).not.toHaveBeenCalled();
  });

  it("never signs when no hash was stored", async () => {
    const tx = unsigned(feePayer().publicKey, 5_000n);
    await expect(cosignAndSubmit(userSigned(tx), "")).rejects.toMatchObject({ code: "TX_MISMATCH" });
    expect(send).not.toHaveBeenCalled();
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
});

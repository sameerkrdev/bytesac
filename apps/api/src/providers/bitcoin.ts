import createHttpError from "http-errors";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { Address, OutScript, RawTx, RawWitness, Script, SigHash, Transaction } from "@scure/btc-signer";
import { z } from "@repo/validator";
import { env } from "../env";

const enc = new TextEncoder();
const hash160 = (b: Uint8Array) => ripemd160(sha256(b));
const sha256d = (b: Uint8Array) => sha256(sha256(b));
const eq = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

/** LI.FI's PSBTs carry an OP_RETURN memo output (a script type the signer treats as unknown). */
const PSBT_OPTS = { allowUnknownOutputs: true, allowUnknownInputs: true } as const;
const PSBT_MAGIC = Buffer.from("70736274ff", "hex");
const BIP322_TAG = sha256(enc.encode("BIP0322-signed-message"));

/** The standard's virtual transactions: `to_spend` commits to the message hash and pays the address script; `to_sign` spends it. */
function bip322Txs(address: string, message: string) {
  const decoded = Address().decode(address);
  const script = OutScript.encode(decoded);
  const messageHash = sha256(concat(BIP322_TAG, BIP322_TAG, enc.encode(message)));
  const toSpend = RawTx.encode({
    version: 0, lockTime: 0, segwitFlag: false, witnesses: [], outputs: [{ amount: 0n, script }],
    inputs: [{ txid: new Uint8Array(32), index: 0xffffffff, finalScriptSig: Script.encode(["OP_0", messageHash]), sequence: 0 }],
  });
  const toSign = new Transaction({ version: 0, allowUnknownOutputs: true });
  toSign.addInput({ txid: sha256d(toSpend).reverse(), index: 0, sequence: 0, witnessUtxo: { script, amount: 0n } });
  toSign.addOutput({ script: Script.encode(["RETURN"]), amount: 0n });
  return { decoded, script, toSign };
}

/** The unsigned BIP-322 `to_sign` PSBT (base64) a wallet signs to prove control of `address`; the client only calls `signPSBT`. */
export const bip322ToSignPsbt = (address: string, message: string): string => Buffer.from(bip322Txs(address, message).toSign.toPSBT()).toString("base64");

/**
 * BIP-322 "simple" verification, built from the standard's virtual transactions (above). The witness (and, for P2SH-P2WPKH, the scriptSig) is checked against the sighash of our own `to_sign`, so a signature
 * over any other transaction or message fails. Supports P2WPKH, P2TR and P2SH-P2WPKH.
 */
function verifyBip322(address: string, message: string, signature: Uint8Array): boolean {
  let witness: Uint8Array[];
  let scriptSig: Uint8Array | undefined;
  if (eq(signature.subarray(0, 5), PSBT_MAGIC)) {
    // The wallet's signed `to_sign` PSBT: take the finalized input 0.
    const psbt = Transaction.fromPSBT(signature);
    if (psbt.inputsLength !== 1) return false;
    if (!psbt.getInput(0).finalScriptWitness && !psbt.getInput(0).finalScriptSig) psbt.finalize();
    const input = psbt.getInput(0);
    witness = input.finalScriptWitness ?? [];
    scriptSig = input.finalScriptSig;
  } else {
    witness = RawWitness.decode(signature);
  }

  const { decoded, script, toSign } = bip322Txs(address, message);

  if (decoded.type === "tr") {
    const sig = witness[0];
    if (witness.length !== 1 || !sig || (sig.length !== 64 && sig.length !== 65)) return false;
    const digest = toSign.preimageWitnessV1(0, [script], sig.length === 64 ? SigHash.DEFAULT : sig[64]!, [0n]);
    return schnorr.verify(sig.subarray(0, 64), digest, decoded.pubkey);
  }

  // P2WPKH, or P2SH-P2WPKH whose redeem script is the P2WPKH program.
  let keyHash: Uint8Array;
  if (decoded.type === "wpkh") keyHash = decoded.hash;
  else if (decoded.type === "sh" && scriptSig) {
    const [redeem] = Script.decode(scriptSig);
    if (!(redeem instanceof Uint8Array) || !eq(hash160(redeem), decoded.hash)) return false;
    const inner = OutScript.decode(redeem);
    if (inner.type !== "wpkh") return false;
    keyHash = inner.hash;
  } else return false;
  const [sig, pub] = witness;
  if (witness.length !== 2 || !sig || !pub || sig.at(-1) !== SigHash.ALL || !eq(hash160(pub), keyHash)) return false;
  const digest = toSign.preimageWitnessV0(0, OutScript.encode({ type: "pkh", hash: keyHash }), SigHash.ALL, 0n);
  return secp256k1.verify(sig.subarray(0, -1), digest, pub, { format: "der", lowS: false, prehash: false });
}

/** BIP-137: header byte 27-30/31-34 P2PKH (uncompressed/compressed), 35-38 P2SH-P2WPKH, 39-42 P2WPKH; the public key is recovered and its address compared. */
function verifyBip137(address: string, message: string, signature: Uint8Array): boolean {
  if (signature.length !== 65 || signature[0]! < 27 || signature[0]! > 42) return false;
  const header = signature[0]!;
  const body = enc.encode(message);
  const varint = body.length < 0xfd ? Uint8Array.of(body.length) : Uint8Array.of(0xfd, body.length & 0xff, body.length >> 8);
  const digest = sha256d(concat(enc.encode("\x18Bitcoin Signed Message:\n"), varint, body));
  const compressed = secp256k1.recoverPublicKey(concat(Uint8Array.of((header - 27) & 3), signature.subarray(1)), digest, { prehash: false });
  const pub = header < 31 ? secp256k1.Point.fromBytes(compressed).toBytes(false) : compressed;
  const hash = hash160(pub);
  const derived = header < 35 ? OutScript.encode({ type: "pkh", hash })
    : header < 39 ? OutScript.encode({ type: "sh", hash: hash160(OutScript.encode({ type: "wpkh", hash })) })
      : OutScript.encode({ type: "wpkh", hash });
  return eq(derived, OutScript.encode(Address().decode(address)));
}

/** `signature` is base64: a BIP-322 signed `to_sign` PSBT or "simple" witness (an optional `smp` prefix is accepted), or a BIP-137 compact signature. Any malformed input is `false`. */
export function verifyBitcoinProof(i: { address: string; message: string; signature: string; method: "bip322" | "bip137" }): boolean {
  try {
    const bytes = Buffer.from(i.signature.replace(/^smp/, ""), "base64");
    return i.method === "bip322" ? verifyBip322(i.address, i.message, bytes) : verifyBip137(i.address, i.message, bytes);
  } catch {
    return false;
  }
}

export interface PsbtOutput { script: string; amount: string }
export interface PsbtInput { txid: string; index: number }

const readPsbt = (psbtBase64: string) => Transaction.fromPSBT(Buffer.from(psbtBase64, "base64"), PSBT_OPTS);

/** The outputs of a PSBT as `{ script hex, sats }`, in order. */
export function psbtOutputs(psbtBase64: string): PsbtOutput[] {
  const tx = readPsbt(psbtBase64);
  return Array.from({ length: tx.outputsLength }, (_, n) => {
    const o = tx.getOutput(n);
    return { script: Buffer.from(o.script!).toString("hex"), amount: String(o.amount) };
  });
}

/** The inputs a PSBT spends, in order. */
export function psbtInputs(psbtBase64: string): PsbtInput[] {
  const tx = readPsbt(psbtBase64);
  return Array.from({ length: tx.inputsLength }, (_, n) => {
    const i = tx.getInput(n);
    return { txid: Buffer.from(i.txid!).toString("hex"), index: i.index! };
  });
}

/** Miner fee ceiling for a sell: 2% of the amount sold, and never more than 100,000 sats. */
export const maxBtcMinerFee = (sellSats: bigint): bigint => (sellSats / 50n < 100_000n ? sellSats / 50n : 100_000n);

/**
 * The LI.FI Bitcoin PSBT after checking its shape: the vault deposit of exactly `sellSats`, the OP_RETURN memo, and a refund (change) output that
 * must pay `userAddress`; the miner fee (inputs minus outputs, from the PSBT's own UTXO data) must be within `maxBtcMinerFee`. These outputs and the
 * quoted inputs are what the user-signed PSBT is later held to.
 */
export function expectedBtcTx(psbtBase64: string, userAddress: string, sellSats: bigint): { outputs: PsbtOutput[]; inputs: PsbtInput[] } {
  const refuse = (why: string) => createHttpError(`The route provider returned an unexpected Bitcoin transaction (${why}).`, { code: "ROUTE_UNAVAILABLE" });
  const tx = readPsbt(psbtBase64);
  const outputs = psbtOutputs(psbtBase64);
  const opReturn = (o: PsbtOutput) => o.script.startsWith("6a");
  const refund = Buffer.from(OutScript.encode(Address().decode(userAddress))).toString("hex");
  if (outputs.length !== 3 || opReturn(outputs[0]!) || !opReturn(outputs[1]!) || outputs[2]!.script !== refund) throw refuse("outputs");
  if (BigInt(outputs[0]!.amount) !== sellSats) throw refuse("deposit amount");
  let inputTotal = 0n;
  for (let n = 0; n < tx.inputsLength; n++) {
    const i = tx.getInput(n);
    // Only segwit and Taproot inputs: their signatures commit to the input amount, so the fee computed here cannot be understated. A legacy input's
    // amount is not committed by its signature, so it is refused rather than trusted.
    if (!i.witnessUtxo) throw refuse("legacy inputs are not supported");
    inputTotal += i.witnessUtxo.amount;
  }
  const fee = inputTotal - outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n);
  if (fee < 0n || fee > maxBtcMinerFee(sellSats)) throw refuse("miner fee");
  return { outputs, inputs: psbtInputs(psbtBase64) };
}

/** The user-signed PSBT must spend exactly the quoted inputs and pay exactly the quoted outputs (deposit, OP_RETURN memo, refund), in order, and nothing else. */
export function checkPsbt(psbtBase64: string, expected: { outputs: PsbtOutput[]; inputs: PsbtInput[] }): void {
  let outputs: PsbtOutput[];
  let inputs: PsbtInput[];
  try {
    [outputs, inputs] = [psbtOutputs(psbtBase64), psbtInputs(psbtBase64)];
  } catch {
    throw createHttpError(409, "The Bitcoin transaction could not be read.", { code: "PSBT_MISMATCH" });
  }
  // Field by field: the expectation comes back from jsonb, which does not keep key order.
  const same = <T extends PsbtOutput | PsbtInput>(a: T[], b: T[], keys: (keyof T)[]) => a.length === b.length && a.every((x, n) => keys.every((k) => x[k] === b[n]![k]));
  if (!same(outputs, expected.outputs, ["script", "amount"]) || !same(inputs, expected.inputs, ["txid", "index"])) throw createHttpError(409, "The Bitcoin transaction changed after it was prepared.", { code: "PSBT_MISMATCH" });
}

/** Finalizes a signed PSBT: the raw transaction hex and its txid. A PSBT that is not fully signed is a 409. */
export function finalizePsbt(psbtBase64: string): { rawHex: string; txid: string } {
  try {
    const tx = readPsbt(psbtBase64);
    if (!tx.isFinal) tx.finalize();
    return { rawHex: tx.hex, txid: tx.id };
  } catch (err) {
    throw createHttpError(409, "The Bitcoin transaction isn't fully signed.", { code: "PSBT_MISMATCH", cause: err });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Alchemy Bitcoin (Blockbook-compatible REST)
// ---------------------------------------------------------------------------------------------------------------------

const unavailable = (cause?: unknown) => createHttpError("Bitcoin data is temporarily unavailable. Try again.", { code: "VERIFIER_UNAVAILABLE", cause });
const base = () => `https://bitcoin-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}/api/v2`;

async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${base()}${path}`, { ...init, signal: AbortSignal.timeout(10_000) });
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (err) {
    throw unavailable(err);
  }
}
const parse = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw unavailable(parsed.error);
  return parsed.data;
};

/** Confirmed balance in satoshis. */
export async function bitcoinBalance(address: string): Promise<bigint> {
  const { status, body } = await call(`/address/${encodeURIComponent(address)}?details=basic`);
  if (status !== 200) throw unavailable(new Error(`HTTP ${status}`));
  return BigInt(parse(z.object({ balance: z.string().regex(/^\d+$/) }), body).balance);
}

/** A transaction with its confirmation count and outputs, or null when the index does not know the txid. */
export async function bitcoinTx(txid: string): Promise<{ confirmations: number; outputs: { address: string | null; value: bigint }[] } | null> {
  const { status, body } = await call(`/tx/${encodeURIComponent(txid)}`);
  if (status === 404) return null;
  if (status !== 200) throw unavailable(new Error(`HTTP ${status}`));
  const tx = parse(z.object({ confirmations: z.number().int().nonnegative(), vout: z.array(z.object({ value: z.string().regex(/^\d+$/), addresses: z.array(z.string()).nullish() })) }), body);
  return { confirmations: tx.confirmations, outputs: tx.vout.map((o) => ({ address: o.addresses?.[0] ?? null, value: BigInt(o.value) })) };
}

/** Broadcasts once. A transport failure is an unknown outcome: the txid is deterministic, so the caller records it and the tracker looks for it. */
export async function broadcastBitcoin(rawHex: string): Promise<string> {
  const { status, body } = await call("/sendtx/", { method: "POST", headers: { "Content-Type": "text/plain" }, body: rawHex });
  const parsed = z.object({ result: z.string() }).safeParse(body);
  if (status === 200 && parsed.success) return parsed.data.result;
  throw createHttpError(409, "The Bitcoin network rejected the transaction.", { code: "BROADCAST_REJECTED", cause: body });
}



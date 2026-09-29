import bs58 from "bs58";

const SIGNATURE_BYTES = 64;

/** Accept only a base58 string decoding to exactly 64 bytes (an ed25519 signature). */
export function assertSolanaSignature(signature: unknown): string {
  if (typeof signature === "string") {
    let decoded: Uint8Array | null = null;
    try { decoded = bs58.decode(signature); } catch { /* not base58 */ }
    if (decoded?.length === SIGNATURE_BYTES) return signature;
  }
  throw new Error("Unexpected Solana signMessage result");
}

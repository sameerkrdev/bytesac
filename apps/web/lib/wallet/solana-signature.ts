import bs58 from "bs58";

const SIGNATURE_BYTES = 64;

/** Normalise the varied return shapes of Solana wallet signMessage into a base58 signature. */
export function normalizeSolanaSignature(result: unknown): string {
  if (typeof result === "string") {
    let decoded: Uint8Array | null = null;
    try { decoded = bs58.decode(result); } catch { /* not base58 */ }
    if (decoded?.length === SIGNATURE_BYTES) return result;
  } else if (result instanceof Uint8Array) {
    if (result.length === SIGNATURE_BYTES) return bs58.encode(result);
  } else if (typeof result === "object" && result !== null) {
    const sig = (result as { signature?: unknown }).signature;
    if (sig instanceof Uint8Array && sig.length === SIGNATURE_BYTES) return bs58.encode(sig);
  }
  throw new Error("Unexpected Solana signMessage result");
}

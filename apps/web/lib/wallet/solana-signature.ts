import bs58 from "bs58";

/** Normalise the varied return shapes of Solana wallet signMessage into a base58 signature. */
export function normalizeSolanaSignature(result: unknown): string {
  if (typeof result === "string" && result.length > 0) return result;
  if (result instanceof Uint8Array) return bs58.encode(result);
  if (typeof result === "object" && result !== null) {
    const sig = (result as { signature?: unknown }).signature;
    if (sig instanceof Uint8Array) return bs58.encode(sig);
  }
  throw new Error("Unexpected Solana signMessage result");
}

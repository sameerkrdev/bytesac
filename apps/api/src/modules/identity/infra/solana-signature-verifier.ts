import { ed25519 } from "@noble/curves/ed25519.js";
import bs58 from "bs58";
import type { VerifyOutcome } from "./signature-verifier.js";

export function verifySolanaSignature(i: { address: string; message: string; signature: string }): VerifyOutcome {
  try {
    const sig = bs58.decode(i.signature);
    const pub = bs58.decode(i.address);
    if (sig.length !== 64 || pub.length !== 32) return { kind: "invalid" };
    return ed25519.verify(sig, new TextEncoder().encode(i.message), pub) ? { kind: "valid", method: "ed25519" } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

import { createPublicKey, verify } from "node:crypto";
import bs58 from "bs58";
import { isErc6492Signature, isHex, recoverMessageAddress, size, type Hex } from "viem";
import type { Chain, VerificationMethod } from "@repo/validator";
import { verifyContractSignature } from "../providers/evm-rpc";

export type VerifyOutcome = { kind: "valid"; method: VerificationMethod } | { kind: "invalid" };

export async function verifyEvmSignature(i: { chain: Chain; address: string; message: string; signature: string }): Promise<VerifyOutcome> {
  if (!isHex(i.signature, { strict: true }) || i.signature.length < 4) return { kind: "invalid" };
  const signature = i.signature as Hex;
  const address = i.address.toLowerCase() as `0x${string}`;
  const wrapped = isErc6492Signature(signature);

  // 1. Offline ECDSA: covers EOAs, including EIP-7702-delegated EOAs (same key controls every EVM chain).
  if (!wrapped && size(signature) === 65) {
    try {
      const recovered = await recoverMessageAddress({ message: i.message, signature });
      if (recovered.toLowerCase() === address) return { kind: "valid", method: "eoa_ecdsa" };
    } catch {
      // malformed ECDSA signature: fall through to contract validation
    }
  }

  // 2. Contract wallet on the challenge's chain only. Throws 503 VERIFIER_UNAVAILABLE on transport failure.
  const ok = await verifyContractSignature({ chain: i.chain, address, message: i.message, signature });
  if (!ok) return { kind: "invalid" };
  return { kind: "valid", method: wrapped ? "erc6492" : "erc1271" };
}

export function verifySolanaSignature(i: { address: string; message: string; signature: string }): VerifyOutcome {
  try {
    const sig = bs58.decode(i.signature);
    const pub = bs58.decode(i.address);
    if (sig.length !== 64 || pub.length !== 32) return { kind: "invalid" };
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(pub).toString("base64url") }, format: "jwk" });
    return verify(null, Buffer.from(i.message), key, sig) ? { kind: "valid", method: "ed25519" } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

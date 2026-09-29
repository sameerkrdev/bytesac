import { familyOf, type Chain, type VerificationMethod } from "@repo/validator";
import type { EvmRpc } from "../../../adapters/evm-rpc.js";
import { verifyEvmSignature } from "./evm-signature-verifier.js";
import { verifySolanaSignature } from "./solana-signature-verifier.js";

export type VerifyOutcome = { kind: "valid"; method: VerificationMethod } | { kind: "invalid" };

export interface SignatureVerifier {
  verify(i: { chain: Chain; address: string; message: string; signature: string }): Promise<VerifyOutcome>;
}

export function createSignatureVerifier(evmRpc: EvmRpc): SignatureVerifier {
  return {
    verify: async (i) => (familyOf(i.chain) === "evm" ? verifyEvmSignature(evmRpc, i) : verifySolanaSignature(i)),
  };
}

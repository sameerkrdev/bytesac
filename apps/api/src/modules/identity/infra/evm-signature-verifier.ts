import type { Chain } from "@repo/contracts";
import { isErc6492Signature, isHex, recoverMessageAddress, size, type Hex } from "viem";
import type { EvmRpc } from "../../../adapters/evm-rpc.js";
import type { VerifyOutcome } from "./signature-verifier.js";

export async function verifyEvmSignature(rpc: EvmRpc, i: { chain: Chain; address: string; message: string; signature: string }): Promise<VerifyOutcome> {
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

  // 2. Contract wallet on the challenge's chain only. Throws VerifierUnavailableError on transport failure.
  const ok = await rpc.verifyContractSignature({ chain: i.chain, address, message: i.message, signature });
  if (!ok) return { kind: "invalid" };
  return { kind: "valid", method: wrapped ? "erc6492" : "erc1271" };
}

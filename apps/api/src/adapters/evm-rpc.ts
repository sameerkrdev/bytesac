import type { Chain } from "@repo/contracts";
export class VerifierUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "VerifierUnavailableError"; }
}
export interface EvmRpc {
  /** ERC-1271 / ERC-6492 validation on `chain`. Returns false for a definitive "not valid"; throws VerifierUnavailableError on transport failures. */
  verifyContractSignature(input: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean>;
}

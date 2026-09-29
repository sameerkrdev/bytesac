import { chainsInFamily, familyOf, type Chain, type VerificationMethod } from "@repo/contracts";

/** Only an ECDSA-recovered EOA key proves control on every EVM chain; contract wallets are per chain. */
export function chainsForVerification(method: VerificationMethod, chain: Chain): Chain[] {
  return method === "eoa_ecdsa" ? chainsInFamily(familyOf(chain)) : [chain];
}

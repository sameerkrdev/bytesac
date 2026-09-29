import { familyOf, type Chain } from "@repo/contracts";
import bs58 from "bs58";
import { isAddress } from "viem";
import { DomainError } from "../../../shared/errors.js";

export function canonicalizeAddress(chain: Chain, raw: string): string {
  const value = raw.trim();
  if (familyOf(chain) === "evm") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value) || !isAddress(value, { strict: true })) {
      throw new DomainError("VALIDATION_FAILED", "Invalid EVM address");
    }
    return value.toLowerCase();
  }
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(value);
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Invalid Solana address");
  }
  if (bytes.length !== 32 || bs58.encode(bytes) !== value) {
    throw new DomainError("VALIDATION_FAILED", "Invalid Solana address");
  }
  return value;
}

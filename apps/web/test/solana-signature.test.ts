import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { normalizeSolanaSignature } from "@/lib/wallet/solana-signature";

describe("normalizeSolanaSignature", () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const expected = bs58.encode(bytes);
  it("accepts Uint8Array, {signature}, and string", () => {
    expect(normalizeSolanaSignature(bytes)).toBe(expected);
    expect(normalizeSolanaSignature({ signature: bytes })).toBe(expected);
    expect(normalizeSolanaSignature(expected)).toBe(expected);
  });
  it("rejects anything else", () => {
    expect(() => normalizeSolanaSignature(undefined)).toThrow();
    expect(() => normalizeSolanaSignature({ signature: "x" })).toThrow();
    expect(() => normalizeSolanaSignature(42)).toThrow();
  });
});

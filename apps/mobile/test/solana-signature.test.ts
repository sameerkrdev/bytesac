import bs58 from "bs58";
import { assertSolanaSignature } from "@/lib/wallet/solana-signature";

describe("assertSolanaSignature", () => {
  const sig = bs58.encode(new Uint8Array(64).map((_, i) => i + 1));
  it("accepts a base58 string that decodes to 64 bytes", () => {
    expect(assertSolanaSignature(sig)).toBe(sig);
  });
  it("rejects wrong length, non-base58 and non-string values", () => {
    expect(() => assertSolanaSignature(bs58.encode(new Uint8Array(63)))).toThrow();
    expect(() => assertSolanaSignature(bs58.encode(new Uint8Array(65)))).toThrow();
    expect(() => assertSolanaSignature("not base58 0OIl")).toThrow();
    expect(() => assertSolanaSignature(new Uint8Array(64))).toThrow();
    expect(() => assertSolanaSignature(undefined)).toThrow();
  });
});

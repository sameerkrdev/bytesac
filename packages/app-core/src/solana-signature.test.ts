import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { assertSolanaSignature, normalizeSolanaSignature } from "./solana-signature";

describe("normalizeSolanaSignature", () => {
  const bytes = new Uint8Array(64).map((_, i) => i + 1);
  const expected = bs58.encode(bytes);
  it("accepts Uint8Array, {signature}, and string", () => {
    expect(normalizeSolanaSignature(bytes)).toBe(expected);
    expect(normalizeSolanaSignature({ signature: bytes })).toBe(expected);
    expect(normalizeSolanaSignature(expected)).toBe(expected);
  });
  it("rejects signatures that are not 64 bytes", () => {
    expect(() => normalizeSolanaSignature(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(() => normalizeSolanaSignature({ signature: new Uint8Array(63) })).toThrow();
    expect(() => normalizeSolanaSignature(bs58.encode(new Uint8Array(10)))).toThrow();
    expect(() => normalizeSolanaSignature("not base58 0OIl")).toThrow();
  });
  it("rejects anything else", () => {
    expect(() => normalizeSolanaSignature(undefined)).toThrow();
    expect(() => normalizeSolanaSignature({ signature: "x" })).toThrow();
    expect(() => normalizeSolanaSignature(42)).toThrow();
  });
});

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

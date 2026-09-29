import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { canonicalizeAddress } from "../../src/services/wallets";
import { buildSignInMessage, SIGN_IN_STATEMENT } from "../../src/services/sign-in-message";

const acct = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const SOL = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";

describe("canonicalizeAddress", () => {
  it("lowercases valid EVM addresses (checksummed or not)", () => {
    expect(canonicalizeAddress("base", acct.address)).toBe(acct.address.toLowerCase());
    expect(canonicalizeAddress("base", acct.address.toLowerCase())).toBe(acct.address.toLowerCase());
  });
  it("rejects bad EVM checksum and malformed input", () => {
    const bad = acct.address.slice(0, -1) + (acct.address.endsWith("a") ? "B" : "a");
    expect(() => canonicalizeAddress("ethereum", bad.replace(/[a-f]/, (c) => c.toUpperCase()))).toThrow();
    expect(() => canonicalizeAddress("ethereum", "0x123")).toThrow();
  });
  it("accepts canonical base58 32-byte Solana keys only", () => {
    expect(canonicalizeAddress("solana", SOL)).toBe(SOL);
    expect(() => canonicalizeAddress("solana", "0OIl")).toThrow();
    expect(() => canonicalizeAddress("solana", "11111111111111111111111111111111111")).toThrow();
  });
});

describe("buildSignInMessage", () => {
  const base = { domain: "localhost:3000", uri: "http://localhost:3000", nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", issuedAt: new Date("2026-09-29T10:00:00.000Z"), expiresAt: new Date("2026-09-29T10:05:00.000Z") };
  it("EVM -> EIP-4361 with checksummed address and numeric chain id", () => {
    const { message, chainId } = buildSignInMessage({ ...base, chain: "base", address: acct.address.toLowerCase() });
    expect(chainId).toBe("8453");
    expect(message.startsWith("localhost:3000 wants you to sign in with your Ethereum account:\n" + acct.address + "\n")).toBe(true);
    expect(message).toContain(SIGN_IN_STATEMENT);
    expect(message).toContain("Chain ID: 8453");
    expect(message).toContain("Nonce: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6");
    expect(message).toContain("Expiration Time: 2026-09-29T10:05:00.000Z");
  });
  it("Solana -> SIWS text", () => {
    const { message, chainId } = buildSignInMessage({ ...base, chain: "solana", address: SOL });
    expect(chainId).toBe("mainnet");
    expect(message).toBe([
      "localhost:3000 wants you to sign in with your Solana account:", SOL, "", SIGN_IN_STATEMENT, "",
      "URI: http://localhost:3000", "Version: 1", "Chain ID: mainnet", "Nonce: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      "Issued At: 2026-09-29T10:00:00.000Z", "Expiration Time: 2026-09-29T10:05:00.000Z",
    ].join("\n"));
  });
});

import { describe, expect, it, beforeEach } from "vitest";
import { verifyEvmSignature, verifySolanaSignature } from "../../src/services/signatures";
import { fakes, resetFakes } from "../helpers/fakes";
import { ERC6492_SUFFIX, newEvmWallet, newSolanaWallet } from "../helpers/wallets";

const MSG = "hello bytesac";
beforeEach(resetFakes);

describe("EVM verification", () => {
  it("EOA signature recovers offline -> eoa_ecdsa, no RPC call", async () => {
    const w = newEvmWallet();
    const out = await verifyEvmSignature({ chain: "base", address: w.address.toLowerCase(), message: MSG, signature: await w.sign(MSG) });
    expect(out).toEqual({ kind: "valid", method: "eoa_ecdsa" });
    expect(fakes.evm.calls).toHaveLength(0);
  });
  it("signature by another key -> RPC consulted -> invalid", async () => {
    const a = newEvmWallet();
    const b = newEvmWallet();
    const out = await verifyEvmSignature({ chain: "base", address: a.address.toLowerCase(), message: MSG, signature: await b.sign(MSG) });
    expect(out).toEqual({ kind: "invalid" });
  });
  it("contract wallet signature valid on chain -> erc1271", async () => {
    fakes.evm.behavior = "valid";
    const out = await verifyEvmSignature({ chain: "arbitrum", address: "0x" + "ab".repeat(20), message: MSG, signature: "0x" + "11".repeat(100) });
    expect(out).toEqual({ kind: "valid", method: "erc1271" });
    expect(fakes.evm.calls[0]).toEqual({ chain: "arbitrum", address: "0x" + "ab".repeat(20) });
  });
  it("ERC-6492 wrapped signature -> erc6492", async () => {
    fakes.evm.behavior = "valid";
    const out = await verifyEvmSignature({ chain: "base", address: "0x" + "cd".repeat(20), message: MSG, signature: "0x" + "22".repeat(96) + ERC6492_SUFFIX });
    expect(out).toEqual({ kind: "valid", method: "erc6492" });
  });
  it("RPC outage propagates as 503 VERIFIER_UNAVAILABLE", async () => {
    fakes.evm.behavior = "unavailable";
    await expect(verifyEvmSignature({ chain: "base", address: "0x" + "ab".repeat(20), message: MSG, signature: "0x" + "11".repeat(100) }))
      .rejects.toMatchObject({ status: 503, code: "VERIFIER_UNAVAILABLE" });
  });
  it("non-hex / missing 0x signatures are invalid, not errors", async () => {
    const address = "0x" + "ab".repeat(20);
    expect(await verifyEvmSignature({ chain: "base", address, message: MSG, signature: "abcd" })).toEqual({ kind: "invalid" });
    expect(await verifyEvmSignature({ chain: "base", address, message: MSG, signature: "0xzz" })).toEqual({ kind: "invalid" });
  });
});

describe("Solana verification", () => {
  it("valid ed25519 signature", () => {
    const w = newSolanaWallet();
    expect(verifySolanaSignature({ address: w.address, message: MSG, signature: w.sign(MSG) })).toEqual({ kind: "valid", method: "ed25519" });
  });
  it("wrong key, tampered message, base64 signature -> invalid", () => {
    const a = newSolanaWallet();
    const b = newSolanaWallet();
    expect(verifySolanaSignature({ address: a.address, message: MSG, signature: b.sign(MSG) })).toEqual({ kind: "invalid" });
    expect(verifySolanaSignature({ address: a.address, message: MSG + "!", signature: a.sign(MSG) })).toEqual({ kind: "invalid" });
    expect(verifySolanaSignature({ address: a.address, message: MSG, signature: "c2lnbmF0dXJl+/==" })).toEqual({ kind: "invalid" });
  });
});

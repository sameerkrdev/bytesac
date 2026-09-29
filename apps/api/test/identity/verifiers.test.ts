import { describe, expect, it } from "vitest";
import { VerifierUnavailableError } from "../../src/adapters/evm-rpc.js";
import { createSignatureVerifier } from "../../src/modules/identity/infra/signature-verifier.js";
import { FakeEvmRpc } from "../helpers/fakes.js";
import { ERC6492_SUFFIX, newEvmWallet, newSolanaWallet } from "../helpers/wallets.js";

const MSG = "hello bytesac";

describe("EVM verification", () => {
  it("EOA signature recovers offline -> eoa_ecdsa, no RPC call", async () => {
    const rpc = new FakeEvmRpc();
    const w = newEvmWallet();
    const out = await createSignatureVerifier(rpc).verify({ chain: "base", address: w.address.toLowerCase(), message: MSG, signature: await w.sign(MSG) });
    expect(out).toEqual({ kind: "valid", method: "eoa_ecdsa" });
    expect(rpc.calls).toHaveLength(0);
  });
  it("signature by another key -> RPC consulted -> invalid", async () => {
    const rpc = new FakeEvmRpc();
    const a = newEvmWallet();
    const b = newEvmWallet();
    const out = await createSignatureVerifier(rpc).verify({ chain: "base", address: a.address.toLowerCase(), message: MSG, signature: await b.sign(MSG) });
    expect(out).toEqual({ kind: "invalid" });
  });
  it("contract wallet signature valid on chain -> erc1271", async () => {
    const rpc = new FakeEvmRpc();
    rpc.behavior = "valid";
    const out = await createSignatureVerifier(rpc).verify({ chain: "arbitrum", address: "0x" + "ab".repeat(20), message: MSG, signature: "0x" + "11".repeat(100) });
    expect(out).toEqual({ kind: "valid", method: "erc1271" });
    expect(rpc.calls[0]).toEqual({ chain: "arbitrum", address: "0x" + "ab".repeat(20) });
  });
  it("ERC-6492 wrapped signature -> erc6492", async () => {
    const rpc = new FakeEvmRpc();
    rpc.behavior = "valid";
    const out = await createSignatureVerifier(rpc).verify({ chain: "base", address: "0x" + "cd".repeat(20), message: MSG, signature: "0x" + "22".repeat(96) + ERC6492_SUFFIX });
    expect(out).toEqual({ kind: "valid", method: "erc6492" });
  });
  it("RPC outage propagates as VerifierUnavailableError", async () => {
    const rpc = new FakeEvmRpc();
    rpc.behavior = "unavailable";
    await expect(createSignatureVerifier(rpc).verify({ chain: "base", address: "0x" + "ab".repeat(20), message: MSG, signature: "0x" + "11".repeat(100) }))
      .rejects.toBeInstanceOf(VerifierUnavailableError);
  });
  it("non-hex / missing 0x signatures are invalid, not errors", async () => {
    const v = createSignatureVerifier(new FakeEvmRpc());
    expect(await v.verify({ chain: "base", address: "0x" + "ab".repeat(20), message: MSG, signature: "abcd" })).toEqual({ kind: "invalid" });
    expect(await v.verify({ chain: "base", address: "0x" + "ab".repeat(20), message: MSG, signature: "0xzz" })).toEqual({ kind: "invalid" });
  });
});

describe("Solana verification", () => {
  it("valid ed25519 signature", async () => {
    const w = newSolanaWallet();
    expect(await createSignatureVerifier(new FakeEvmRpc()).verify({ chain: "solana", address: w.address, message: MSG, signature: w.sign(MSG) }))
      .toEqual({ kind: "valid", method: "ed25519" });
  });
  it("wrong key, tampered message, base64 signature -> invalid", async () => {
    const v = createSignatureVerifier(new FakeEvmRpc());
    const a = newSolanaWallet();
    const b = newSolanaWallet();
    expect(await v.verify({ chain: "solana", address: a.address, message: MSG, signature: b.sign(MSG) })).toEqual({ kind: "invalid" });
    expect(await v.verify({ chain: "solana", address: a.address, message: MSG + "!", signature: a.sign(MSG) })).toEqual({ kind: "invalid" });
    expect(await v.verify({ chain: "solana", address: a.address, message: MSG, signature: "c2lnbmF0dXJl+/==" })).toEqual({ kind: "invalid" });
  });
});

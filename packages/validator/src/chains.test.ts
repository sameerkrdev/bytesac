import { describe, expect, it } from "vitest";
import { challengeRequestSchema } from "./auth";
import { CHAINS, chainFromEvmChainId, chainsInFamily, familyOf, signInChainSchema } from "./chains";
import { ERROR_HTTP_STATUS } from "./errors";

describe("chains", () => {
  it("maps families", () => {
    expect(familyOf("base")).toBe("evm");
    expect(familyOf("solana")).toBe("solana");
    expect(chainsInFamily("evm")).toEqual(["ethereum", "base", "bnb", "arbitrum", "polygon"]);
    expect(chainsInFamily("solana")).toEqual(["solana"]);
  });
  it("maps EVM chain ids", () => {
    expect(CHAINS.ethereum.evmChainId).toBe(1);
    expect(chainFromEvmChainId(8453)).toBe("base");
    expect(chainFromEvmChainId(56)).toBe("bnb");
    expect(chainFromEvmChainId(42161)).toBe("arbitrum");
    expect(chainFromEvmChainId(137)).toBe("polygon");
  });
});

describe("per-chain addresses contracts", () => {
  it("Polygon is a linkable and sign-in EVM chain", () => {
    expect(CHAINS.polygon).toEqual({ family: "evm", label: "Polygon", evmChainId: 137 });
    expect(chainsInFamily("evm")).toEqual(["ethereum", "base", "bnb", "arbitrum", "polygon"]);
    expect(signInChainSchema.options).toContain("polygon");
    expect(chainFromEvmChainId(137)).toBe("polygon");
  });
  it("challenge accepts optional chains and the reassign purpose", () => {
    expect(challengeRequestSchema.parse({ purpose: "sign_in", chain: "base", address: "0xabc", chains: ["base", "bnb"] }).chains).toEqual(["base", "bnb"]);
    expect(challengeRequestSchema.parse({ purpose: "reassign_chain", chain: "base", address: "0xabc" }).chains).toBeUndefined();
    expect(() => challengeRequestSchema.parse({ purpose: "sign_in", chain: "base", address: "0xabc", chains: [] })).toThrow();
    expect(() => challengeRequestSchema.parse({ purpose: "sign_in", chain: "base", address: "0xabc", chains: ["base", "base"] })).toThrow();
  });
  it("new error codes are 409", () => {
    expect(ERROR_HTTP_STATUS.CHAIN_ALREADY_LINKED).toBe(409);
    expect(ERROR_HTTP_STATUS.CHAIN_NOT_LINKED).toBe(409);
    expect(ERROR_HTTP_STATUS.CHAIN_NOT_EMPTY).toBe(409);
  });
});

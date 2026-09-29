import { describe, expect, it } from "vitest";
import { CHAINS, chainFromEvmChainId, chainsInFamily, familyOf } from "./chains.js";

describe("chains", () => {
  it("maps families", () => {
    expect(familyOf("base")).toBe("evm");
    expect(familyOf("solana")).toBe("solana");
    expect(chainsInFamily("evm")).toEqual(["ethereum", "base", "bnb", "arbitrum"]);
    expect(chainsInFamily("solana")).toEqual(["solana"]);
  });
  it("maps EVM chain ids", () => {
    expect(CHAINS.ethereum.evmChainId).toBe(1);
    expect(chainFromEvmChainId(8453)).toBe("base");
    expect(chainFromEvmChainId(56)).toBe("bnb");
    expect(chainFromEvmChainId(42161)).toBe("arbitrum");
    expect(chainFromEvmChainId(137)).toBeUndefined();
  });
});

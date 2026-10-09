import { describe, expect, it } from "vitest";
import { canAddChainAccount, chainFromCaip, isUserRejection, signableChainsFromCaip, uncoveredChains } from "./wallet";

describe("chainFromCaip", () => {
  it("maps supported networks", () => {
    expect(chainFromCaip("eip155:1")).toBe("ethereum");
    expect(chainFromCaip("eip155:8453")).toBe("base");
    expect(chainFromCaip("eip155:56")).toBe("bnb");
    expect(chainFromCaip("eip155:42161")).toBe("arbitrum");
    expect(chainFromCaip("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe("solana");
  });
  it("flags unsupported and missing networks", () => {
    expect(chainFromCaip("eip155:137")).toBe("unsupported");
    expect(chainFromCaip("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1")).toBe("unsupported");
    expect(chainFromCaip(undefined)).toBeNull();
  });
});

describe("isUserRejection", () => {
  it("detects EIP-1193 4001 and named rejections", () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection({ name: "UserRejectedRequestError" })).toBe(true);
    expect(isUserRejection(new Error("User rejected the request."))).toBe(true);
    expect(isUserRejection(new Error("timeout"))).toBe(false);
    expect(isUserRejection(new Error("signing failed"))).toBe(false);
    expect(isUserRejection({ name: "WalletSignMessageError" })).toBe(false);
  });
});

const addr = (chain: string, family: "evm" | "solana", method: string) => ({ chain, chainFamily: family, address: "x", status: "active", verificationMethod: method, verifiedAt: "2026-09-29T00:00:00.000Z" });
it("canAddChainAccount", () => {
  const me = (a: unknown[]) => ({ user: {}, wallet: { addresses: a }, contacts: [] }) as never;
  expect(canAddChainAccount(me([addr("base", "evm", "eoa_ecdsa"), addr("solana", "solana", "ed25519")]))).toBe(false);
  expect(canAddChainAccount(me([addr("base", "evm", "erc1271"), addr("solana", "solana", "ed25519")]))).toBe(true);
  expect(canAddChainAccount(me([addr("solana", "solana", "ed25519")]))).toBe(true);
});

describe("signableChainsFromCaip (D-119)", () => {
  it("maps approved mainnet chains, drops unknown and testnets, dedupes", () => {
    expect(signableChainsFromCaip([
      "eip155:1", "eip155:8453", "eip155:56", "eip155:42161", "eip155:137", "eip155:1",
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ", "eip155:10", "bip122:000000000019d6689c085ae165831e93",
    ])).toEqual(["ethereum", "base", "bnb", "arbitrum", "polygon", "solana"]);
  });
});

describe("uncoveredChains (D-119)", () => {
  const evm = (signableChains: string[] | null) => ["ethereum", "base", "bnb", "arbitrum"].map((chain) => ({ chain, chainFamily: "evm", status: "active", signableChains }));
  const sol = (signableChains: string[] | null) => [{ chain: "solana", chainFamily: "solana", status: "active", signableChains }];

  it("lists the chains the wallet cannot sign, once each, in plan order", () => {
    const addresses = [...evm(["ethereum", "base", "polygon"]), ...sol(["solana"])] as Parameters<typeof uncoveredChains>[1];
    expect(uncoveredChains(["solana", "arbitrum", "base", "bnb", "arbitrum", "polygon"], addresses)).toEqual(["arbitrum", "bnb"]);
  });

  it("an unknown list (null) never warns", () => {
    expect(uncoveredChains(["arbitrum", "solana"], [...evm(null), ...sol(null)] as Parameters<typeof uncoveredChains>[1])).toEqual([]);
  });

  it("ignores disabled rows and families with no linked address", () => {
    const addresses = evm(["ethereum"]).map((a) => ({ ...a, status: "disabled" })) as Parameters<typeof uncoveredChains>[1];
    expect(uncoveredChains(["arbitrum"], addresses)).toEqual([]);
  });
});

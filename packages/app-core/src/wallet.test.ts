import { describe, expect, it } from "vitest";
import { canAddChainAccount, chainFromCaip, isUserRejection, linkChoices, linkedAddressFor, signableChainsFromCaip, uncoveredChains } from "./wallet";

describe("chainFromCaip", () => {
  it("maps supported networks", () => {
    expect(chainFromCaip("eip155:1")).toBe("ethereum");
    expect(chainFromCaip("eip155:8453")).toBe("base");
    expect(chainFromCaip("eip155:56")).toBe("bnb");
    expect(chainFromCaip("eip155:42161")).toBe("arbitrum");
    expect(chainFromCaip("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")).toBe("solana");
  });
  it("flags unsupported and missing networks", () => {
    expect(chainFromCaip("eip155:10")).toBe("unsupported");
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

const addr = (chain: string, family: "evm" | "solana", status = "active") => ({ chain, chainFamily: family, address: "x", status, verificationMethod: "eoa_ecdsa", verifiedAt: "2026-09-29T00:00:00.000Z" });
it("canAddChainAccount is true while any chain has no active row (D-120)", () => {
  const me = (a: unknown[]) => ({ user: {}, wallet: { addresses: a }, contacts: [] }) as never;
  const all = [...["ethereum", "base", "bnb", "arbitrum", "polygon"].map((c) => addr(c, "evm")), addr("solana", "solana")];
  expect(canAddChainAccount(me(all))).toBe(false);
  expect(canAddChainAccount(me(all.slice(1)))).toBe(true);
  expect(canAddChainAccount(me(all.map((x) => (x.chain === "base" ? addr("base", "evm", "replaced") : x))))).toBe(true);
  expect(canAddChainAccount(me([]))).toBe(true);
});

describe("signableChainsFromCaip (D-119)", () => {
  it("maps approved mainnet chains, drops unknown and testnets, dedupes", () => {
    expect(signableChainsFromCaip([
      "eip155:1", "eip155:8453", "eip155:56", "eip155:42161", "eip155:137", "eip155:1",
      "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ", "eip155:10", "bip122:000000000019d6689c085ae165831e93",
    ])).toEqual(["ethereum", "base", "bnb", "arbitrum", "polygon", "solana"]);
  });
});

describe("uncoveredChains (D-119, per chain D-120)", () => {
  const row = (chain: string, signableChains: string[] | null | undefined, status = "active") => ({ chain, chainFamily: chain === "solana" ? "solana" : "evm", status, signableChains });
  const cast = (a: unknown[]) => a as Parameters<typeof uncoveredChains>[1];

  it("lists the chains whose own row cannot sign them, once each, in plan order", () => {
    const addresses = cast([row("ethereum", ["ethereum"]), row("base", ["ethereum", "base"]), row("bnb", ["ethereum"]), row("arbitrum", ["base"]), row("solana", ["solana"])]);
    expect(uncoveredChains(["solana", "arbitrum", "base", "bnb", "arbitrum", "polygon"], addresses)).toEqual(["arbitrum", "bnb"]);
  });

  it("an unknown list (null or undefined) never warns", () => {
    expect(uncoveredChains(["arbitrum", "solana"], cast([row("arbitrum", null), row("solana", undefined)]))).toEqual([]);
  });

  it("ignores inactive rows and chains with no row; a sibling chain's row does not cover", () => {
    expect(uncoveredChains(["arbitrum", "base"], cast([row("arbitrum", ["ethereum"], "disabled"), row("ethereum", ["ethereum"])]))).toEqual([]);
  });
});

describe("linkChoices (D-120)", () => {
  const row = (chain: string, address: string, walletName: string | null = null, status = "active") =>
    ({ chain, chainFamily: chain === "solana" ? "solana" : "evm", address, status, verificationMethod: "eoa_ecdsa", verifiedAt: "2026-10-09T00:00:00.000Z", walletName }) as never;
  it("pre-ticks approved unlinked chains, greys chains linked elsewhere", () => {
    const out = linkChoices({ family: "evm", approved: ["ethereum", "base", "bnb"], address: "0xaaa", addresses: [row("base", "0xbbb", "Phantom")] });
    expect(out).toEqual([
      { chain: "ethereum", state: "available", walletName: null, preselected: true },
      { chain: "base", state: "linked-elsewhere", walletName: "Phantom", preselected: false },
      { chain: "bnb", state: "available", walletName: null, preselected: true },
      { chain: "arbitrum", state: "available", walletName: null, preselected: false },
      { chain: "polygon", state: "available", walletName: null, preselected: false },
    ]);
  });
  it("unknown approval list pre-ticks every available chain; a smart wallet only offers its chain", () => {
    expect(linkChoices({ family: "evm", approved: undefined, address: "0xaaa", addresses: [] }).every((c) => c.preselected)).toBe(true);
    expect(linkChoices({ family: "evm", approved: undefined, address: "0xaaa", addresses: [], smartWalletChain: "base" }).map((c) => c.chain)).toEqual(["base"]);
  });
  it("marks a chain already linked to this address as linked-here", () => {
    expect(linkChoices({ family: "evm", approved: undefined, address: "0xAAA", addresses: [row("base", "0xaaa")] }).find((c) => c.chain === "base")?.state).toBe("linked-here");
  });
  it("linkedAddressFor ignores replaced rows", () => {
    expect(linkedAddressFor([row("base", "0xold", null, "replaced"), row("base", "0xnew")], "base")?.address).toBe("0xnew");
  });
});

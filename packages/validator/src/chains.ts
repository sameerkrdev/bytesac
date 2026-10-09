import { z } from "zod";

export const chainSchema = z.enum(["ethereum", "base", "bnb", "arbitrum", "polygon", "solana", "bitcoin"]);
/** Chains an address can be linked on. Bitcoin is link-only: sign-in challenges use `signInChainSchema`. */
export type Chain = z.infer<typeof chainSchema>;
export const signInChainSchema = chainSchema.exclude(["bitcoin"]);
export type SignInChain = z.infer<typeof signInChainSchema>;
export const chainFamilySchema = z.enum(["evm", "solana", "bitcoin"]);
export type ChainFamily = z.infer<typeof chainFamilySchema>;

interface ChainInfo {
  family: ChainFamily;
  label: string;
  evmChainId?: number;
  solanaCluster?: "mainnet";
}

export const CHAINS: Readonly<Record<Chain, ChainInfo>> = {
  ethereum: { family: "evm", label: "Ethereum", evmChainId: 1 },
  base: { family: "evm", label: "Base", evmChainId: 8453 },
  bnb: { family: "evm", label: "BNB Chain", evmChainId: 56 },
  arbitrum: { family: "evm", label: "Arbitrum", evmChainId: 42161 },
  polygon: { family: "evm", label: "Polygon", evmChainId: 137 },
  solana: { family: "solana", label: "Solana", solanaCluster: "mainnet" },
  bitcoin: { family: "bitcoin", label: "Bitcoin" },
};

const ORDER: readonly Chain[] = chainSchema.options;

export function familyOf(chain: Chain): ChainFamily {
  return CHAINS[chain].family;
}

export function chainsInFamily(family: ChainFamily): Chain[] {
  return ORDER.filter((c) => CHAINS[c].family === family);
}

export function chainFromEvmChainId(id: number): SignInChain | undefined {
  return signInChainSchema.options.find((c) => CHAINS[c].evmChainId === id);
}

import { z } from "zod";

export const chainSchema = z.enum(["ethereum", "base", "bnb", "arbitrum", "solana"]);
export type Chain = z.infer<typeof chainSchema>;
export const chainFamilySchema = z.enum(["evm", "solana"]);
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
  solana: { family: "solana", label: "Solana", solanaCluster: "mainnet" },
};

const ORDER: readonly Chain[] = chainSchema.options;

export function familyOf(chain: Chain): ChainFamily {
  return CHAINS[chain].family;
}

export function chainsInFamily(family: ChainFamily): Chain[] {
  return ORDER.filter((c) => CHAINS[c].family === family);
}

export function chainFromEvmChainId(id: number): Chain | undefined {
  return ORDER.find((c) => CHAINS[c].evmChainId === id);
}

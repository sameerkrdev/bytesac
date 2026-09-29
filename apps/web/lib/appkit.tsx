"use client";

import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { SolanaAdapter } from "@reown/appkit-adapter-solana/react";
import { arbitrum, base, bsc, mainnet, solana } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { palette } from "@repo/design-tokens";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
if (!projectId && typeof window !== "undefined") console.error("NEXT_PUBLIC_REOWN_PROJECT_ID is not set");

export const evmNetworks = [mainnet, base, bsc, arbitrum] as const;

export const wagmiAdapter = new WagmiAdapter({ networks: [...evmNetworks], projectId, ssr: true });
const solanaAdapter = new SolanaAdapter();

createAppKit({
  adapters: [wagmiAdapter, solanaAdapter],
  networks: [mainnet, base, bsc, arbitrum, solana],
  defaultNetwork: mainnet,
  projectId,
  metadata: {
    name: "Bytesac",
    description: "Manager-led, multi-chain investment baskets.",
    url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    icons: [`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/logo.png`],
  },
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
  themeMode: "dark",
  themeVariables: { "--w3m-accent": palette.sage, "--w3m-font-family": "Inter, sans-serif", "--w3m-border-radius-master": "4px" },
});

export function WalletProviders({ children }: { children: ReactNode }) {
  return <WagmiProvider config={wagmiAdapter.wagmiConfig}>{children}</WagmiProvider>;
}

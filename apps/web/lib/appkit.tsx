"use client";

import { BitcoinAdapter } from "@reown/appkit-adapter-bitcoin";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { SolanaAdapter } from "@reown/appkit-adapter-solana/react";
import { arbitrum, base, bsc, bitcoin, mainnet, polygon, solana } from "@reown/appkit/networks";
import { createAppKit } from "@reown/appkit/react";
import { useEffect, type ReactNode } from "react";
import { cookieStorage, cookieToInitialState, createStorage, WagmiProvider, type Config } from "wagmi";
import { themes } from "@repo/design-tokens";
import { resolvedTheme, useResolvedTheme } from "@/lib/theme";

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? "";
if (!projectId && typeof window !== "undefined") console.error("NEXT_PUBLIC_REOWN_PROJECT_ID is not set");

// Polygon is for exit legs only (sign-in never accepts it); Bitcoin is link-and-sign only, never a sign-in network.
const evmNetworks = [mainnet, base, bsc, arbitrum, polygon] as const;

export const wagmiAdapter = new WagmiAdapter({ networks: [...evmNetworks], projectId, ssr: true, storage: createStorage({ storage: cookieStorage }) });
const solanaAdapter = new SolanaAdapter();
const bitcoinAdapter = new BitcoinAdapter({ projectId });

export const appKit = createAppKit({
  adapters: [wagmiAdapter, solanaAdapter, bitcoinAdapter],
  networks: [mainnet, base, bsc, arbitrum, polygon, solana, bitcoin],
  defaultNetwork: mainnet,
  projectId,
  metadata: {
    name: "Bytesac",
    description: "Manager-led, multi-chain investment baskets.",
    url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    icons: [`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/logo.png`],
  },
  features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
  themeMode: typeof window === "undefined" ? "light" : resolvedTheme(),
  themeVariables: { "--w3m-accent": themes.light.primary, "--w3m-font-family": "Geist, ui-sans-serif, system-ui, sans-serif", "--w3m-border-radius-master": "4px" },
});

/** `cookies` is the request Cookie header: wagmi state is restored from it so the first render matches the connected wallet. */
export function WalletProviders({ children, cookies }: { children: ReactNode; cookies: string | null }) {
  const initialState = cookieToInitialState(wagmiAdapter.wagmiConfig as Config, cookies);
  const theme = useResolvedTheme();
  useEffect(() => {
    appKit.setThemeMode(theme);
    appKit.setThemeVariables({ "--w3m-accent": themes[theme].primary });
  }, [theme]);
  return <WagmiProvider config={wagmiAdapter.wagmiConfig as Config} initialState={initialState}>{children}</WagmiProvider>;
}

import { AppKitProvider, createAppKit, solana } from "@reown/appkit-react-native";
import { PhantomConnector, SolanaAdapter, SolflareConnector } from "@reown/appkit-solana-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";
import type { ReactNode } from "react";
import { arbitrum, base, bsc, mainnet } from "viem/chains";
import { WagmiProvider, type Config } from "wagmi";
import { appKitStorage } from "./appkit-storage";

const projectId = process.env.EXPO_PUBLIC_REOWN_PROJECT_ID ?? "";
if (__DEV__ && !projectId) console.warn("EXPO_PUBLIC_REOWN_PROJECT_ID is empty; wallet connections will not work.");
const evm = [mainnet, base, bsc, arbitrum] as const;

export const wagmiAdapter = new WagmiAdapter({ projectId, networks: [...evm] });

export const appKit = createAppKit({
  projectId,
  adapters: [wagmiAdapter, new SolanaAdapter()],
  networks: [...evm, solana],
  defaultNetwork: mainnet,
  storage: appKitStorage,
  extraConnectors: [new PhantomConnector({ cluster: "mainnet-beta" }), new SolflareConnector({ cluster: "mainnet-beta" })],
  enableAnalytics: false,
  metadata: {
    name: "Bytesac",
    description: "Manager-led, multi-chain investment baskets.",
    url: "https://bytesac.com",
    icons: ["https://bytesac.com/logo.png"],
    redirect: { native: "bytesac://" },
  },
});

// Type-only workaround: the lockfile holds duplicate @wagmi/core 2.22.1 peer variants (typescript 6/7, use-sync-external-store 1.4/1.7, zod 3/4), so the two Config types are unrelated. Remove when the peers align.
const wagmiConfig = wagmiAdapter.wagmiConfig as unknown as Config;

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <AppKitProvider instance={appKit}>{children}</AppKitProvider>
    </WagmiProvider>
  );
}

import { AppKitProvider, createAppKit, solana } from "@reown/appkit-react-native";
import { PhantomConnector, SolanaAdapter, SolflareConnector } from "@reown/appkit-solana-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";
import type { ReactNode } from "react";
import { arbitrum, base, bsc, mainnet } from "viem/chains";
import { WagmiProvider } from "wagmi";
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

export function WalletProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <AppKitProvider instance={appKit}>{children}</AppKitProvider>
    </WagmiProvider>
  );
}

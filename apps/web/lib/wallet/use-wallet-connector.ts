"use client";

import type { Provider as SolanaProvider } from "@reown/appkit-adapter-solana/react";
import { useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider, useDisconnect, useWalletInfo } from "@reown/appkit/react";
import { mainnet } from "@reown/appkit/networks";
import { useCallback } from "react";
import { useSignMessage } from "wagmi";
import { normalizeSolanaSignature } from "@/lib/wallet/solana-signature";
import { chainFromCaip, isUserRejection, WalletRejectedError, type ConnectedAccount } from "@repo/api-client";

export type { ConnectedAccount };

export function useWalletConnector() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { caipNetwork, switchNetwork } = useAppKitNetwork();
  const { walletInfo } = useWalletInfo();
  const { disconnect } = useDisconnect();
  const { walletProvider: solanaProvider } = useAppKitProvider<SolanaProvider>("solana");
  const { signMessageAsync } = useSignMessage();

  const mapped = chainFromCaip(caipNetwork?.caipNetworkId);
  const network: "supported" | "unsupported" | "none" = !isConnected || mapped === null ? "none" : mapped === "unsupported" ? "unsupported" : "supported";
  const account: ConnectedAccount | null =
    isConnected && address && mapped && mapped !== "unsupported" ? { chain: mapped, address, walletName: walletInfo?.name ?? null } : null;

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!account) throw new Error("No supported wallet account connected");
    try {
      if (account.chain === "solana") {
        if (!solanaProvider) throw new Error("Solana provider unavailable");
        const result: unknown = await solanaProvider.signMessage(new TextEncoder().encode(message));
        return normalizeSolanaSignature(result);
      }
      return await signMessageAsync({ message });
    } catch (err) {
      if (isUserRejection(err)) throw new WalletRejectedError();
      throw err;
    }
  }, [account, solanaProvider, signMessageAsync]);

  return {
    account,
    network,
    connect: async () => { await open({ view: "Connect" }); },
    disconnect: async () => { await disconnect(); },
    switchToSupported: async () => { await switchNetwork(mainnet); },
    signMessage,
  };
}

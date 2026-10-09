"use client";

import type { Provider as SolanaProvider } from "@reown/appkit-adapter-solana/react";
import { useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider, useDisconnect, useWalletInfo } from "@reown/appkit/react";
import { mainnet } from "@reown/appkit/networks";
import { useCallback, useMemo } from "react";
import { useSignMessage } from "wagmi";
import { chainFromCaip, isUserRejection, signableChainsFromCaip, WalletRejectedError, type ConnectedAccount, normalizeSolanaSignature } from "@repo/app-core";

export type { ConnectedAccount };

export function useWalletConnector() {
  const { open } = useAppKit();
  const { address, isConnected, allAccounts } = useAppKitAccount();
  const { caipNetwork, switchNetwork } = useAppKitNetwork();
  const { walletInfo } = useWalletInfo();
  const { disconnect } = useDisconnect();
  const { walletProvider: solanaProvider } = useAppKitProvider<SolanaProvider>("solana");
  const { signMessageAsync } = useSignMessage();

  const mapped = chainFromCaip(caipNetwork?.caipNetworkId);
  const network: "supported" | "unsupported" | "none" = !isConnected || mapped === null ? "none" : mapped === "unsupported" ? "unsupported" : "supported";
  // D-119: every chain the connection approved for this address (one account per chain); undefined when the wallet reports none.
  const signableChains = useMemo(() => {
    const list = signableChainsFromCaip((allAccounts ?? [])
      .filter((a) => a.address.toLowerCase() === address?.toLowerCase() && a.chainId !== undefined)
      .map((a) => `${a.namespace}:${a.chainId}`));
    return list.length > 0 ? list : undefined;
  }, [allAccounts, address]);
  const account: ConnectedAccount | null = useMemo(
    () => (isConnected && address && mapped && mapped !== "unsupported" ? { chain: mapped, address, walletName: walletInfo?.name ?? null, signableChains } : null),
    [isConnected, address, mapped, walletInfo?.name, signableChains],
  );

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!account) throw new Error("No supported wallet account connected");
    try {
      if (account.chain === "solana") {
        if (!solanaProvider) throw new Error("Solana provider unavailable");
        const result: unknown = await solanaProvider.signMessage(new TextEncoder().encode(message));
        return normalizeSolanaSignature(result);
      }
      return await signMessageAsync({ account: account.address as `0x${string}`, message });
    } catch (err) {
      if (isUserRejection(err)) throw new WalletRejectedError();
      throw err;
    }
  }, [account, solanaProvider, signMessageAsync]);

  return {
    account,
    network,
    connect: async () => { await open({ view: "Connect" }); },
    chooseNetwork: async () => { await open({ view: "Networks" }); },
    disconnect: async () => { await disconnect(); },
    switchToSupported: async () => { await switchNetwork(mainnet); },
    signMessage,
  };
}

import { chainFromCaip, isUserRejection, WalletRejectedError, type ConnectedAccount, assertSolanaSignature } from "@repo/app-core";
import { useAccount, useAppKit, useProvider, useWalletInfo } from "@reown/appkit-react-native";
import bs58 from "bs58";
import { useCallback, useMemo } from "react";
import { useSignMessage } from "wagmi";

export type { ConnectedAccount };

export function useWalletConnector() {
  const { open, disconnect, switchNetwork } = useAppKit();
  const { address, chainId, isConnected, namespace } = useAccount();
  const { provider } = useProvider();
  const { walletInfo } = useWalletInfo();
  const { signMessageAsync } = useSignMessage();

  const caip = isConnected && namespace && chainId !== undefined ? (chainId.includes(":") ? chainId : `${namespace}:${chainId}`) : undefined;
  const mapped = chainFromCaip(caip);
  const network: "supported" | "unsupported" | "none" = !isConnected || mapped === null ? "none" : mapped === "unsupported" ? "unsupported" : "supported";
  const chain = isConnected && address && mapped && mapped !== "unsupported" ? mapped : null;
  const walletName = walletInfo?.name ?? null;
  const account: ConnectedAccount | null = useMemo(
    () => (chain && address ? { chain, address, walletName } : null),
    [chain, address, walletName],
  );

  const signMessage = useCallback(async (message: string): Promise<string> => {
    if (!account) throw new Error("No supported wallet account connected");
    try {
      if (account.chain === "solana") {
        if (!provider) throw new Error("Solana provider unavailable");
        const params = { message: bs58.encode(new TextEncoder().encode(message)), pubkey: account.address };
        const result = await provider.request<{ signature?: unknown }>({ method: "solana_signMessage", params }, caip);
        return assertSolanaSignature(result?.signature); // base58, 64 bytes
      }
      return await signMessageAsync({ message });
    } catch (err) {
      if (isUserRejection(err)) throw new WalletRejectedError();
      throw err;
    }
  }, [account, provider, caip, signMessageAsync]);

  return {
    account,
    network,
    connect: () => open({ view: "Connect" }),
    chooseNetwork: () => open({ view: "Networks" }),
    disconnect: async () => { await disconnect(); },
    switchToSupported: async () => { await switchNetwork("eip155:1"); },
    signMessage,
  };
}

import { chainFromCaip, isUserRejection, WalletRejectedError, type ConnectedAccount } from "@repo/api-client";
import { useAccount, useAppKit, useProvider, useWalletInfo } from "@reown/appkit-react-native";
import bs58 from "bs58";
import { useCallback } from "react";
import { useSignMessage } from "wagmi";
import { assertSolanaSignature } from "./solana-signature";

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
  const account: ConnectedAccount | null =
    isConnected && address && mapped && mapped !== "unsupported" ? { chain: mapped, address, walletName: walletInfo?.name ?? null } : null;

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

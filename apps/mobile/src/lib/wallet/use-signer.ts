import { isUserRejection, linkedAddressFor, shortAddress, WalletRejectedError, WrongWalletError, type Signer } from "@repo/app-core";
import { useAccount, useProvider, useWalletInfo } from "@reown/appkit-react-native";
import { ASSET_CHAINS, chainFromEvmChainId, type AssetChain, type MeResponse } from "@repo/validator";
import bs58 from "bs58";
import { useMemo } from "react";
import { encodeFunctionData, erc20Abi } from "viem";
import { useAccount as useEvmAccount, useConfig, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * The only place the mobile money flows touch wallets (AppKit React Native). Each method signs exactly what the server prepared for one leg.
 * Solana: `solana_signTransaction` through the active AppKit provider; deeplink connectors (Phantom, Solflare: walletInfo.type "external") take and return base58, WalletConnect sessions base64
 * (the encodings AppKit's own SolanaAdapter uses). EVM: wagmi, an exact-amount approval first, then the LI.FI transaction.
 * Bitcoin is not offered: `signPsbt` is left out, so a Bitcoin leg is continued on the web. The server verifies everything that comes back.
 */
export function useSigner(me: MeResponse | undefined): Signer {
  const { address, namespace, chain } = useAccount();
  const { provider } = useProvider();
  const { walletInfo } = useWalletInfo();
  const evm = useEvmAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const addresses = me?.wallet.addresses;

  return useMemo<Signer>(() => {
    // D-120: each chain has its own wallet. Mobile keeps one wallet per family connected, so a mismatch is fixed by connecting that chain's wallet.
    const linkedFor = (chain: AssetChain) => {
      const row = addresses ? linkedAddressFor(addresses, chain) : undefined;
      return { address: row?.address, hint: new WrongWalletError(`Connect ${row?.walletName ?? "the wallet"} (${row ? shortAddress(row.address) : "linked address"}) to sign this ${ASSET_CHAINS[chain].label} step`, true) };
    };
    const guard = async <T,>(run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (err) {
        throw isUserRejection(err) ? new WalletRejectedError() : err;
      }
    };
    return {
      signSolana: (serializedBase64) => guard(async () => {
        const sol = linkedFor("solana");
        if (!provider || namespace !== "solana" || !address || address !== sol.address) throw sol.hint;
        const caip = chain?.caipNetworkId;
        if (!caip) throw sol.hint;
        // Encoding follows the connector, not the wallet name (as AppKit's SolanaAdapter does): the Phantom and Solflare deeplink connectors report walletInfo.type "external"
        // (appkit-solana-react-native PhantomConnector/SolflareConnector getWalletInfo); WalletConnect sessions, whatever the wallet, report "walletconnect" and take base64.
        const deeplink = walletInfo?.type === "external";
        const res = await provider.request<{ transaction?: string }>({
          method: "solana_signTransaction",
          params: { transaction: deeplink ? bs58.encode(fromBase64(serializedBase64)) : serializedBase64, pubkey: address },
        }, caip);
        if (!res?.transaction) throw new Error("The wallet did not return a signed transaction.");
        return toBase64(deeplink ? bs58.decode(res.transaction) : fromBase64(res.transaction));
      }),
      sendEvm: ({ approval, ...tx }) => guard(async () => {
        const leg = chainFromEvmChainId(tx.chainId);
        if (!leg) throw new Error("This network is not supported.");
        const from = linkedFor(leg);
        if (!evm.isConnected || !evm.address || evm.address.toLowerCase() !== from.address?.toLowerCase()) throw from.hint;
        if (evm.chainId !== tx.chainId) await switchChainAsync({ chainId: tx.chainId });
        if (approval) {
          const hash = await sendTransactionAsync({
            chainId: tx.chainId, to: approval.token as `0x${string}`,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approval.spender as `0x${string}`, BigInt(approval.amount)] }),
          });
          // A mined but reverted approval does not throw: stop here rather than send a transaction that needs the allowance.
          const receipt = await waitForTransactionReceipt(config, { hash, chainId: tx.chainId });
          if (receipt.status !== "success") throw new Error("The token approval was not confirmed on-chain. Nothing else was sent.");
        }
        return sendTransactionAsync({ chainId: tx.chainId, to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value) });
      }),
    };
  }, [provider, namespace, address, chain?.caipNetworkId, walletInfo?.type, addresses, evm.isConnected, evm.address, evm.chainId, config, switchChainAsync, sendTransactionAsync]);
}

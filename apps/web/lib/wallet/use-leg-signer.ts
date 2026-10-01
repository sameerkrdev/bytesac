"use client";

import type { BitcoinConnector } from "@reown/appkit-adapter-bitcoin";
import type { Provider as SolanaProvider } from "@reown/appkit-adapter-solana/react";
import { useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { VersionedTransaction } from "@solana/web3.js";
import { isUserRejection, WalletRejectedError, WrongWalletError } from "@repo/app-core";
import type { MeResponse } from "@repo/validator";
import { encodeFunctionData, erc20Abi } from "viem";
import { useAccount, useConfig, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";

/**
 * The only place the invest flow touches wallets. Each method signs exactly what the server prepared for one leg and returns what the API wants back:
 * a signed Solana transaction (base64), an EVM transaction hash, or a signed Bitcoin PSBT (base64). Nothing is broadcast by the client except EVM
 * transactions (the wallet sends those); the server verifies every result.
 */
export function useLegSigner(me: MeResponse | undefined) {
  const linked = (chain: "solana" | "ethereum" | "bitcoin") => me?.wallet.addresses.find((a) => a.chain === chain && a.status === "active")?.address;
  const solana = useAppKitAccount({ namespace: "solana" });
  const bitcoin = useAppKitAccount({ namespace: "bip122" });
  const { walletProvider: solanaProvider } = useAppKitProvider<SolanaProvider>("solana");
  const { walletProvider: bitcoinProvider } = useAppKitProvider<BitcoinConnector>("bip122");
  const evm = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  const guard = async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      throw isUserRejection(err) ? new WalletRejectedError() : err;
    }
  };

  return {
    signSolana: (serializedBase64: string) => guard(async () => {
      if (!solanaProvider || !solana.isConnected || solana.address !== linked("solana")) throw new WrongWalletError("Solana wallet");
      const signed = await solanaProvider.signTransaction(VersionedTransaction.deserialize(Uint8Array.from(atob(serializedBase64), (c) => c.charCodeAt(0))));
      return btoa(String.fromCharCode(...signed.serialize()));
    }),

    /** Optional exact-amount ERC-20 approval first (mined before the main transaction), then the LI.FI transaction. Returns the main transaction hash. */
    sendEvm: (tx: { chainId: number; to: string; data: string; value: string }, approval: { token: string; spender: string; amount: string } | null) => guard(async () => {
      const from = linked("ethereum")?.toLowerCase();
      if (!evm.isConnected || !evm.address || evm.address.toLowerCase() !== from) throw new WrongWalletError("EVM wallet");
      if (evm.chainId !== tx.chainId) await switchChainAsync({ chainId: tx.chainId });
      if (approval) {
        const hash = await sendTransactionAsync({
          chainId: tx.chainId, to: approval.token as `0x${string}`, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approval.spender as `0x${string}`, BigInt(approval.amount)] }),
        });
        await waitForTransactionReceipt(config, { hash, chainId: tx.chainId });
      }
      return sendTransactionAsync({ chainId: tx.chainId, to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value) });
    }),

    signBitcoin: (psbtBase64: string, inputCount: number) => guard(async () => {
      const address = linked("bitcoin");
      if (!bitcoinProvider || !bitcoin.isConnected || bitcoin.address !== address || !address) throw new WrongWalletError("Bitcoin wallet");
      const signed = await bitcoinProvider.signPSBT({
        psbt: psbtBase64, signInputs: Array.from({ length: inputCount }, (_, index) => ({ address, index, sighashTypes: [1] })), broadcast: false,
      });
      return signed.psbt;
    }),
  };
}

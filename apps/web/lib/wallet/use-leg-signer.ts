"use client";

import type { BitcoinConnector } from "@reown/appkit-adapter-bitcoin";
import type { Provider as SolanaProvider } from "@reown/appkit-adapter-solana/react";
import { VersionedTransaction } from "@solana/web3.js";
import { isUserRejection, linkedAddressFor, shortAddress, WalletRejectedError, WrongWalletError } from "@repo/app-core";
import { ASSET_CHAINS, chainFromEvmChainId, type AssetChain, type MeResponse } from "@repo/validator";
import { encodeFunctionData, erc20Abi } from "viem";
import { useConfig, useSendTransaction, useSwitchChain } from "wagmi";
import { getAccount, waitForTransactionReceipt } from "wagmi/actions";
import { appKit } from "@/lib/appkit";
import { same, useWalletForChain } from "@/lib/wallet/use-wallet-for-chain";

/**
 * The only place the invest flow touches wallets. Each method signs exactly what the server prepared for one leg and returns what the API wants back:
 * a signed Solana transaction (base64), an EVM transaction hash, or a signed Bitcoin PSBT (base64). Nothing is broadcast by the client except EVM
 * transactions (the wallet sends those); the server verifies every result.
 */
export function useLegSigner(me: MeResponse | undefined) {
  const linked = (chain: AssetChain) => (me ? linkedAddressFor(me.wallet.addresses, chain)?.address : undefined);
  const { ensure, connectionKey } = useWalletForChain(me);
  /** Selects the wallet linked to `chain`; throws the "Connect X" prompt when it is not connected. The address check afterwards stays (the server checks again). */
  const select = async (chain: AssetChain) => {
    if ((await ensure(chain)) === "ready") return;
    const row = me ? linkedAddressFor(me.wallet.addresses, chain) : undefined;
    throw new WrongWalletError(`Connect ${row?.walletName ?? "the wallet"} (${row ? shortAddress(row.address) : "linked address"}) to sign this ${ASSET_CHAINS[chain].label} step`, true);
  };
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
    connectionKey,
    signSolana: (serializedBase64: string) => guard(async () => {
      await select("solana");
      // Read the provider and address after a possible wallet switch (hook values would be from the last render).
      const solanaProvider = appKit.getProvider<SolanaProvider>("solana");
      if (!solanaProvider || appKit.getAddress("solana") !== linked("solana")) throw new WrongWalletError("Solana wallet");
      const signed = await solanaProvider.signTransaction(VersionedTransaction.deserialize(Uint8Array.from(atob(serializedBase64), (c) => c.charCodeAt(0))));
      return btoa(String.fromCharCode(...signed.serialize()));
    }),

    /** Optional exact-amount ERC-20 approval first (mined before the main transaction), then the LI.FI transaction. Returns the main transaction hash. */
    sendEvm: (tx: { chainId: number; to: string; data: string; value: string }, approval: { token: string; spender: string; amount: string } | null) => guard(async () => {
      const chain = chainFromEvmChainId(tx.chainId);
      if (!chain) throw new Error("This network is not supported.");
      await select(chain);
      // Read the account after a possible wallet switch (a hook value is from the last render).
      const now = getAccount(config);
      const from = linked(chain);
      if (!now.isConnected || !now.address || !from || !same(now.address, from)) throw new WrongWalletError("EVM wallet");
      if (now.chainId !== tx.chainId) await switchChainAsync({ chainId: tx.chainId });
      if (approval) {
        const hash = await sendTransactionAsync({
          chainId: tx.chainId, to: approval.token as `0x${string}`, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [approval.spender as `0x${string}`, BigInt(approval.amount)] }),
        });
        // A mined but reverted approval does not throw: stop here rather than send a transaction that needs the allowance.
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: tx.chainId });
        if (receipt.status !== "success") throw new Error("The token approval was not confirmed on-chain. Nothing else was sent.");
      }
      return sendTransactionAsync({ chainId: tx.chainId, to: tx.to as `0x${string}`, data: tx.data as `0x${string}`, value: BigInt(tx.value) });
    }),

    signBitcoin: (psbtBase64: string, inputCount: number) => guard(async () => {
      await select("bitcoin");
      const address = linked("bitcoin");
      const bitcoinProvider = appKit.getProvider<BitcoinConnector>("bip122");
      if (!bitcoinProvider || !address || appKit.getAddress("bip122") !== address) throw new WrongWalletError("Bitcoin wallet");
      const signed = await bitcoinProvider.signPSBT({
        psbt: psbtBase64, signInputs: Array.from({ length: inputCount }, (_, index) => ({ address, index, sighashTypes: [1] })), broadcast: false,
      });
      return signed.psbt;
    }),
  };
}

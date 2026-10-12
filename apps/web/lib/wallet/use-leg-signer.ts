"use client";

import type { BitcoinConnector } from "@reown/appkit-adapter-bitcoin";
import type { Provider as SolanaProvider } from "@reown/appkit-adapter-solana/react";
import { useWalletInfo } from "@reown/appkit/react";
import { VersionedTransaction } from "@solana/web3.js";
import { isUserRejection, linkedAddressFor, shortAddress, WalletRejectedError, WrongWalletError } from "@repo/app-core";
import { ASSET_CHAINS, chainFromEvmChainId, type AssetChain, type MeResponse } from "@repo/validator";
import { encodeFunctionData, erc20Abi } from "viem";
import { useConfig, useSendTransaction, useSwitchChain } from "wagmi";
import { getAccount, waitForTransactionReceipt } from "wagmi/actions";
import { appKit } from "@/lib/appkit";
import { standardWallets } from "@/lib/wallet/standard-wallets";
import { same, useWalletForChain } from "@/lib/wallet/use-wallet-for-chain";

/**
 * Wallets that need fewer approvals when they sign AND send a batch than when they only sign it (spec 22 B-27, B-28). Matched by the Reown `walletInfo.name`.
 * Empty since the P0 wallet lab (2026-10-12): MetaMask and Phantom confirm each transaction separately for both methods, so `sign_all` costs the same
 * popups and keeps the server's fee-first order and stop-on-failure. A wallet joins only when the lab measures fewer popups with sign-and-send.
 */
export const SIGN_AND_SEND_WALLETS: readonly string[] = [];
const SIGN_AND_SEND = "solana:signAndSendTransaction";
type SignAndSendFeature = { signAndSendTransaction(...inputs: { account: { address: string }; chain: string; transaction: Uint8Array }[]): Promise<{ signature: Uint8Array }[]> };

const bytesOf = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const fromBase64 = (b64: string) => VersionedTransaction.deserialize(bytesOf(b64));
const toBase64 = (tx: VersionedTransaction) => btoa(String.fromCharCode(...tx.serialize()));

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
  /** The connected Solana wallet's name for the group request (telemetry only; never an address). */
  const walletName = useWalletInfo("solana").walletInfo?.name?.slice(0, 64) || undefined;
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  /** The provider and address are read after a possible wallet switch (hook values would be from the last render). */
  const solana = async () => {
    await select("solana");
    const provider = appKit.getProvider<SolanaProvider>("solana");
    if (!provider || appKit.getAddress("solana") !== linked("solana")) throw new WrongWalletError("Solana wallet");
    return provider;
  };

  /** The connected wallet as Wallet Standard sees it (short wait: wallets register when the page loads). */
  const standard = async () => walletName ? (await standardWallets(50)).find((w) => w.name === walletName) : undefined;

  const guard = async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      throw isUserRejection(err) ? new WalletRejectedError() : err;
    }
  };

  return {
    connectionKey,
    walletName,
    /** `sign_and_send` for a listed wallet that exposes the Wallet Standard feature, else `sign_all` (which downgrades to `single` when the wallet cannot sign a batch). */
    chooseTier: async (): Promise<"sign_and_send" | "sign_all"> =>
      SIGN_AND_SEND_WALLETS.includes(walletName ?? "") && !!(await standard())?.features[SIGN_AND_SEND] ? "sign_and_send" : "sign_all",
    signSolana: (serializedBase64: string) => guard(async () => toBase64(await (await solana()).signTransaction(fromBase64(serializedBase64)))),

    /** One approval for a whole signing group, in order. A wallet or provider without `signAllTransactions` throws "not supported", which the group signer treats as a downgrade. */
    signSolanaAll: (serializedBase64: string[]) => guard(async () => {
      const provider = await solana();
      if (typeof provider.signAllTransactions !== "function") throw new Error("signAllTransactions is not supported by this wallet");
      return (await provider.signAllTransactions(serializedBase64.map(fromBase64))).map(toBase64);
    }),

    /** The wallet signs and broadcasts the batch (tier `sign_and_send`, no wallet listed today); returns the raw 64-byte signatures in input order, which app-core encodes. */
    signAndSendSolanaAll: (serializedBase64: string[]) => guard(async () => {
      await solana(); // selects the linked wallet and checks the address
      const wallet = await standard();
      const account = wallet?.accounts.find((a) => a.address === linked("solana"));
      const feature = wallet?.features[SIGN_AND_SEND] as SignAndSendFeature | undefined;
      if (!account || !feature) throw new WrongWalletError("Solana wallet");
      const outputs = await feature.signAndSendTransaction(...serializedBase64.map((t) => ({ account, chain: "solana:mainnet", transaction: bytesOf(t) })));
      return outputs.map((o) => o.signature);
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

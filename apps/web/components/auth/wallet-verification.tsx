"use client";
import { linkChoices } from "@repo/app-core";
import { CHAINS, type AssetChain, type ChallengePurpose, type WalletAddressView } from "@repo/validator";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWalletVerification, type PreviousWallet } from "@/lib/auth/use-wallet-verification";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";
import { ChainPicker } from "./chain-picker";
import { VerifyWalletCard } from "./verify-wallet-card";

/** `reassign` moves one chain from its current wallet to the connected one (two signatures); otherwise the user picks the chains (D-120). */
export function WalletVerification({ purpose, onVerified, expired, linkedAddresses, reassign }: {
  purpose: ChallengePurpose; onVerified(isNewUser: boolean): void; expired?: boolean;
  linkedAddresses?: ReadonlyArray<WalletAddressView>;
  reassign?: { chain: AssetChain; previous: PreviousWallet };
}) {
  const wallet = useWalletConnector();
  const { state, run, reset, notice, awaitingPrevious } = useWalletVerification(purpose);
  const [picked, setPicked] = useState<AssetChain[]>([]);
  const account = wallet.account;
  const choices = useMemo(
    () => (account && !reassign ? linkChoices({ family: CHAINS[account.chain].family as "evm" | "solana", approved: account.signableChains, addresses: linkedAddresses ?? [], address: account.address }) : null),
    [account, reassign, linkedAddresses],
  );
  const go = () => { if (account) void run(account, reassign ? [reassign.chain] : picked, reassign?.previous); };

  const notified = useRef(false);
  useEffect(() => {
    if (state.step !== "done") { notified.current = false; return; }
    if (notified.current) return;
    notified.current = true;
    onVerified(state.isNewUser);
  }, [state, onVerified]);

  return (
    <VerifyWalletCard
      account={wallet.account}
      network={wallet.network}
      state={state}
      expired={expired}
      linkedAddresses={linkedAddresses}
      notice={notice}
      picker={account && choices ? <ChainPicker key={`${account.chain}:${account.address}`} walletName={account.walletName} address={account.address} choices={choices} onChange={setPicked} /> : null}
      signDisabled={!reassign && picked.length === 0}
      onSign={go}
      onRetry={go}
      onRestart={() => { reset(); if (account && !reassign) void run(account, picked); }}
      // Mid-move the user must switch wallets, so disconnecting keeps the held signature.
      onDisconnect={() => { if (!awaitingPrevious) reset(); void wallet.disconnect(); }}
      onConnect={() => void wallet.connect()}
      onSwitchNetwork={() => void wallet.switchToSupported()}
      onChooseNetwork={() => void wallet.chooseNetwork()}
    />
  );
}

import { linkChoices } from "@repo/app-core";
import { CHAINS, type AssetChain, type ChallengePurpose, type WalletAddressView } from "@repo/validator";
import { useEffect, useMemo, useRef, useState } from "react";
import { useWalletVerification, type PreviousWallet } from "@/lib/auth/use-wallet-verification";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";
import { ChainPicker } from "./chain-picker";
import { VerifyWalletCard } from "./verify-wallet-card";

/**
 * `reassign` moves one chain from its current wallet to the connected one (two signatures, one wallet at a time on mobile);
 * otherwise the user picks the chains (D-120).
 */
export function WalletVerification({ purpose, linkedAddresses, reassign, onVerified }: {
  purpose: ChallengePurpose;
  linkedAddresses?: readonly WalletAddressView[];
  reassign?: { chain: AssetChain; previous: PreviousWallet };
  onVerified(isNewUser: boolean): void;
}) {
  const wallet = useWalletConnector();
  const { signOut } = useAuth();
  const { state, run, reset, notice, awaitingPrevious } = useWalletVerification(purpose);
  const [picked, setPicked] = useState<AssetChain[]>([]);
  const account = wallet.account;
  const choices = useMemo(
    () => (account && !reassign ? linkChoices({ family: CHAINS[account.chain].family as "evm" | "solana", approved: account.signableChains, addresses: linkedAddresses ?? [], address: account.address }) : null),
    [account, reassign, linkedAddresses],
  );
  const go = () => { if (account) void run(account, reassign ? [reassign.chain] : picked, reassign?.previous); };

  // The move needs the chain's current wallet next: drop this connection and open Connect for it (the signature stays held).
  const handedOver = useRef(false);
  useEffect(() => {
    if (!awaitingPrevious) { handedOver.current = false; return; }
    if (handedOver.current) return;
    handedOver.current = true;
    void wallet.disconnect().then(() => wallet.connect());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per hand-over; the connector object changes every render
  }, [awaitingPrevious]);

  useEffect(() => {
    if (state.step === "done") onVerified(state.isNewUser);
  }, [state, onVerified]);

  return (
    <VerifyWalletCard
      account={account}
      network={wallet.network}
      state={state}
      linkedAddresses={linkedAddresses}
      notice={notice}
      picker={account && choices ? <ChainPicker key={`${account.chain}:${account.address}`} walletName={account.walletName} address={account.address} choices={choices} onChange={setPicked} /> : null}
      signDisabled={!reassign && picked.length === 0}
      onSign={go}
      onRetry={go}
      onRestart={() => {
        if (reassign) reset(`Start again: connect the wallet you want to move ${CHAINS[reassign.chain].label} to, then sign.`);
        else { reset(); if (account) void run(account, picked); }
      }}
      // Mid-move the user must switch wallets, so disconnecting keeps the held signature.
      onDisconnect={() => {
        if (!awaitingPrevious) reset();
        void wallet.disconnect();
      }}
      onSwitchNetwork={() => void wallet.switchToSupported()}
      onChooseNetwork={() => {
        if (!awaitingPrevious) reset();
        void wallet.chooseNetwork();
      }}
      onCancel={() => reset()}
      onConnect={() => void wallet.connect()}
      onUseDifferentWallet={purpose === "add_chain_account" ? () => {
        reset();
        // Only the wallet connection is dropped; the Bytesac session stays signed in.
        void wallet.disconnect().then(() => wallet.connect());
      } : undefined}
      onReauthenticate={() => void signOut({ expired: true })}
    />
  );
}

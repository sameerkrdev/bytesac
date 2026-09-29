import type { ChallengePurpose } from "@repo/contracts";
import { useEffect } from "react";
import { useWalletVerification } from "@/lib/auth/use-wallet-verification";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";
import { VerifyWalletCard, type LinkedAddress } from "./verify-wallet-card";

export function WalletVerification({ purpose, linkedAddresses, onVerified }: {
  purpose: ChallengePurpose;
  linkedAddresses?: readonly LinkedAddress[];
  onVerified(isNewUser: boolean): void;
}) {
  const wallet = useWalletConnector();
  const { signOut } = useAuth();
  const { state, run, reset } = useWalletVerification(purpose);
  useEffect(() => {
    if (state.step === "done") onVerified(state.isNewUser);
  }, [state, onVerified]);
  return (
    <VerifyWalletCard
      account={wallet.account}
      network={wallet.network}
      state={state}
      linkedAddresses={linkedAddresses}
      onSign={() => wallet.account && void run(wallet.account)}
      onRetry={() => wallet.account && void run(wallet.account)}
      onRestart={() => {
        reset();
        if (wallet.account) void run(wallet.account);
      }}
      onDisconnect={() => {
        reset();
        void wallet.disconnect();
      }}
      onSwitchNetwork={() => void wallet.switchToSupported()}
      onChooseNetwork={() => {
        reset();
        void wallet.chooseNetwork();
      }}
      onReauthenticate={() => void signOut({ expired: true })}
    />
  );
}

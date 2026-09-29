"use client";
import type { ChallengePurpose } from "@repo/contracts";
import { useEffect, useRef } from "react";
import { useWalletVerification } from "@/lib/auth/use-wallet-verification";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";
import { VerifyWalletCard } from "./verify-wallet-card";

export function WalletVerification({ purpose, onVerified }: { purpose: ChallengePurpose; onVerified(isNewUser: boolean): void }) {
  const wallet = useWalletConnector();
  const { state, run, reset } = useWalletVerification(purpose);

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
      onSign={() => wallet.account && run(wallet.account)}
      onRetry={() => wallet.account && run(wallet.account)}
      onRestart={() => { reset(); if (wallet.account) void run(wallet.account); }}
      onDisconnect={() => { reset(); void wallet.disconnect(); }}
      onSwitchNetwork={() => void wallet.switchToSupported()}
    />
  );
}

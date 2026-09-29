"use client";

import { ApiError, verifyReducer, WalletRejectedError } from "@repo/api-client";
import type { ChallengePurpose } from "@repo/contracts";
import { useCallback, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import { useWalletConnector, type ConnectedAccount } from "@/lib/wallet/use-wallet-connector";

export function useWalletVerification(purpose: ChallengePurpose) {
  const [state, dispatch] = useReducer(verifyReducer, { step: "idle" });
  const { signMessage } = useWalletConnector();
  const busy = useRef(false);

  const run = useCallback(async (account: ConnectedAccount) => {
    if (busy.current) return;
    busy.current = true;
    dispatch({ type: "START" });
    try {
      const ch = await api.createChallenge({ purpose, chain: account.chain, address: account.address });
      const signature = await signMessage(ch.message);
      dispatch({ type: "SIGNED" });
      const out = await api.verify({ challengeId: ch.challengeId, signature, client: "web", walletProvider: account.walletName ?? undefined });
      dispatch({ type: "VERIFIED", isNewUser: out.isNewUser });
    } catch (err) {
      if (err instanceof WalletRejectedError) dispatch({ type: "FAILED", code: "WALLET_REJECTED" });
      else if (err instanceof ApiError) dispatch({ type: "FAILED", code: err.code, retryAfterSec: err.retryAfterSec });
      else dispatch({ type: "FAILED", code: "INTERNAL" });
    } finally {
      busy.current = false;
    }
  }, [purpose, signMessage]);

  return { state, run, reset: () => dispatch({ type: "RESET" }) };
}

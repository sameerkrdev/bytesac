import { ApiError } from "@repo/api-client";
import { verifyReducer, WalletRejectedError, type ConnectedAccount } from "@repo/app-core";
import type { ChallengePurpose } from "@repo/validator";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { AppState } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

/** After returning to the foreground with no wallet answer, give up on the sign request. */
export const SIGN_FOREGROUND_TIMEOUT_MS = 120_000;

export function useWalletVerification(purpose: ChallengePurpose) {
  const [state, dispatch] = useReducer(verifyReducer, { step: "idle" });
  const { signMessage } = useWalletConnector();
  const { acceptToken } = useAuth();
  const busy = useRef(false);
  const runId = useRef(0);
  const signing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /** Invalidate any in-flight run: its results and errors are ignored from now on. */
  const invalidate = useCallback(() => {
    runId.current += 1;
    busy.current = false;
    signing.current = false;
    clearTimer();
  }, [clearTimer]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || !signing.current || timer.current) return;
      const id = runId.current;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (id !== runId.current) return;
        invalidate();
        dispatch({ type: "FAILED", code: "WALLET_REJECTED" });
      }, SIGN_FOREGROUND_TIMEOUT_MS);
    });
    return () => {
      sub.remove();
      clearTimer();
    };
  }, [invalidate, clearTimer]);

  const run = useCallback(
    async (account: ConnectedAccount) => {
      if (busy.current) return;
      busy.current = true;
      const id = ++runId.current;
      const stale = () => id !== runId.current;
      dispatch({ type: "START" });
      try {
        const ch = await api.createChallenge({ purpose, chain: account.chain, address: account.address });
        if (stale()) return;
        signing.current = true;
        let signature: string;
        try {
          signature = await signMessage(ch.message);
        } finally {
          if (!stale()) {
            signing.current = false;
            clearTimer();
          }
        }
        if (stale()) return;
        dispatch({ type: "SIGNED" });
        const out = await api.verify({
          challengeId: ch.challengeId,
          signature,
          client: "mobile",
          walletProvider: account.walletName ?? undefined,
        });
        if (stale()) return;
        await acceptToken(out.token); // persist rotated/new token before anything else uses the API
        if (stale()) return;
        dispatch({ type: "VERIFIED", isNewUser: out.isNewUser });
      } catch (err) {
        if (stale()) return;
        if (err instanceof WalletRejectedError) dispatch({ type: "FAILED", code: "WALLET_REJECTED" });
        else if (err instanceof ApiError) dispatch({ type: "FAILED", code: err.code, retryAfterSec: err.retryAfterSec });
        else dispatch({ type: "FAILED", code: "INTERNAL" });
      } finally {
        if (!stale()) busy.current = false;
      }
    },
    [purpose, signMessage, acceptToken, clearTimer],
  );

  const reset = useCallback(() => {
    invalidate();
    dispatch({ type: "RESET" });
  }, [invalidate]);
  return { state, run, reset };
}

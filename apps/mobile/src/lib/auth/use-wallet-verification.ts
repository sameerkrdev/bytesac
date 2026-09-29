import { ApiError, verifyReducer, WalletRejectedError, type ConnectedAccount } from "@repo/api-client";
import type { ChallengePurpose } from "@repo/contracts";
import { useCallback, useReducer, useRef } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

export function useWalletVerification(purpose: ChallengePurpose) {
  const [state, dispatch] = useReducer(verifyReducer, { step: "idle" });
  const { signMessage } = useWalletConnector();
  const { acceptToken } = useAuth();
  const busy = useRef(false);

  const run = useCallback(
    async (account: ConnectedAccount) => {
      if (busy.current) return;
      busy.current = true;
      dispatch({ type: "START" });
      try {
        const ch = await api.createChallenge({ purpose, chain: account.chain, address: account.address });
        const signature = await signMessage(ch.message);
        dispatch({ type: "SIGNED" });
        const out = await api.verify({
          challengeId: ch.challengeId,
          signature,
          client: "mobile",
          walletProvider: account.walletName ?? undefined,
        });
        await acceptToken(out.token); // persist rotated/new token before anything else uses the API
        dispatch({ type: "VERIFIED", isNewUser: out.isNewUser });
      } catch (err) {
        if (err instanceof WalletRejectedError) dispatch({ type: "FAILED", code: "WALLET_REJECTED" });
        else if (err instanceof ApiError) dispatch({ type: "FAILED", code: err.code, retryAfterSec: err.retryAfterSec });
        else dispatch({ type: "FAILED", code: "INTERNAL" });
      } finally {
        busy.current = false;
      }
    },
    [purpose, signMessage, acceptToken],
  );

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);
  return { state, run, reset };
}

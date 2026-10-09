import { ApiError } from "@repo/api-client";
import { shortAddress, verifyReducer, WalletRejectedError, type ConnectedAccount } from "@repo/app-core";
import { CHAINS, type AssetChain, type ChallengePurpose, type SignInChain } from "@repo/validator";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AppState } from "react-native";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

/** After returning to the foreground with no wallet answer, give up on the sign request. */
export const SIGN_FOREGROUND_TIMEOUT_MS = 120_000;

/** The wallet that holds the chain today; a move needs its signature too (D-120). */
export type PreviousWallet = { address: string; walletName: string | null };
export type Notice = { kind: "info" | "error"; text: string };

// EVM addresses compare case-insensitively; Solana (base58) addresses exactly.
const same = (a: string, b: string, solana: boolean) => (solana ? a === b : a.toLowerCase() === b.toLowerCase());

export function useWalletVerification(purpose: ChallengePurpose) {
  const [state, dispatch] = useReducer(verifyReducer, { step: "idle" });
  const { signMessage } = useWalletConnector();
  const { acceptToken } = useAuth();
  const busy = useRef(false);
  const runId = useRef(0);
  const signing = useRef(false);
  // Reassign: the new wallet's signature waits here while the user connects the chain's current wallet.
  const pending = useRef<{ challengeId: string; message: string; signature: string; walletProvider?: string; signableChains?: AssetChain[] } | null>(null);
  const [awaitingPrevious, setAwaitingPrevious] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
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
    async (account: ConnectedAccount, chains?: AssetChain[], previous?: PreviousWallet) => {
      if (busy.current) return;
      busy.current = true;
      const id = ++runId.current;
      const stale = () => id !== runId.current;
      setNotice(null);
      const sign = async (message: string) => {
        signing.current = true;
        try {
          return await signMessage(message);
        } finally {
          if (!stale()) {
            signing.current = false;
            clearTimer();
          }
        }
      };
      try {
        const wrongWallet = (text: string) => { dispatch({ type: "RESET" }); setNotice({ kind: "error", text }); };
        const to = chains?.[0];
        const reassign = purpose === "reassign_chain" && to !== undefined && previous !== undefined;
        if (reassign && pending.current) {
          const p = pending.current;
          if (!same(account.address, previous.address, account.chain === "solana")) return wrongWallet(`Connect ${previous.walletName ?? "the current wallet"} (${shortAddress(previous.address)}) to approve the move.`);
          dispatch({ type: "START" });
          const previousSignature = await sign(p.message);
          if (stale()) return;
          dispatch({ type: "SIGNED" });
          const out = await api.reassignChain({ challengeId: p.challengeId, signature: p.signature, previousSignature, client: "mobile", walletProvider: p.walletProvider, signableChains: p.signableChains });
          if (stale()) return;
          await acceptToken(out.token);
          if (stale()) return;
          pending.current = null;
          setAwaitingPrevious(false);
          dispatch({ type: "VERIFIED", isNewUser: out.isNewUser });
          return;
        }
        if (reassign) {
          if (same(account.address, previous.address, account.chain === "solana")) return wrongWallet("Connect the wallet you want to move this chain to.");
          if (CHAINS[to].family !== CHAINS[account.chain].family) return wrongWallet(`This wallet can't hold ${CHAINS[to].label}. Connect a ${CHAINS[to].family === "evm" ? "EVM" : "Solana"} wallet.`);
        }
        dispatch({ type: "START" });
        const ch = await api.createChallenge({ purpose, chain: (reassign ? to : account.chain) as SignInChain, address: account.address, chains });
        if (stale()) return;
        const signature = await sign(ch.message);
        if (stale()) return;
        // D-119: an empty list means the connection told us nothing; send it as unknown.
        const body = { challengeId: ch.challengeId, signature, walletProvider: account.walletName ?? undefined, signableChains: account.signableChains?.length ? account.signableChains : undefined };
        if (reassign) {
          pending.current = { ...body, message: ch.message };
          setAwaitingPrevious(true);
          dispatch({ type: "RESET" });
          setNotice({ kind: "info", text: `Now approve in ${previous.walletName ?? "your current wallet"} (${shortAddress(previous.address)}) to confirm the move.` });
          return;
        }
        dispatch({ type: "SIGNED" });
        const out = await api.verify({ ...body, client: "mobile" });
        if (stale()) return;
        await acceptToken(out.token); // persist rotated/new token before anything else uses the API
        if (stale()) return;
        dispatch({ type: "VERIFIED", isNewUser: out.isNewUser });
      } catch (err) {
        if (stale()) return;
        if (err instanceof WalletRejectedError) dispatch({ type: "FAILED", code: "WALLET_REJECTED" });
        else if (err instanceof ApiError) {
          // A stale or refused move cannot be resumed with the held signature.
          pending.current = null;
          setAwaitingPrevious(false);
          dispatch({ type: "FAILED", code: err.code, retryAfterSec: err.retryAfterSec });
          const held = (err.details as { assets?: unknown } | undefined)?.assets;
          if (err.code === "CHAIN_NOT_EMPTY" && Array.isArray(held) && held.length > 0) setNotice({ kind: "info", text: `You still hold: ${held.join(", ")}.` });
        } else dispatch({ type: "FAILED", code: "INTERNAL" });
      } finally {
        if (!stale()) busy.current = false;
      }
    },
    [purpose, signMessage, acceptToken, clearTimer],
  );

  const reset = useCallback((text?: string) => {
    invalidate();
    pending.current = null;
    setAwaitingPrevious(false);
    setNotice(text ? { kind: "info", text } : null);
    dispatch({ type: "RESET" });
  }, [invalidate]);
  return { state, run, reset, notice, awaitingPrevious };
}

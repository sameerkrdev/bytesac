"use client";

import { ApiError } from "@repo/api-client";
import { shortAddress, verifyReducer, WalletRejectedError } from "@repo/app-core";
import { CHAINS, type AssetChain, type ChallengePurpose, type SignInChain } from "@repo/validator";
import { useCallback, useReducer, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useWalletConnector, type ConnectedAccount } from "@/lib/wallet/use-wallet-connector";

/** The wallet that holds the chain today; a move needs its signature too (D-120). */
export type PreviousWallet = { address: string; walletName: string | null };
export type Notice = { kind: "info" | "error"; text: string };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function useWalletVerification(purpose: ChallengePurpose) {
  const [state, dispatch] = useReducer(verifyReducer, { step: "idle" });
  const [notice, setNotice] = useState<Notice | null>(null);
  const { signMessage } = useWalletConnector();
  const busy = useRef(false);
  // Reassign: the new wallet's signature waits here while the user switches to the chain's current wallet.
  const pending = useRef<{ challengeId: string; message: string; signature: string; walletProvider?: string; signableChains?: AssetChain[] } | null>(null);
  const [awaitingPrevious, setAwaitingPrevious] = useState(false);

  const run = useCallback(async (account: ConnectedAccount, chains?: AssetChain[], previous?: PreviousWallet) => {
    if (busy.current) return;
    busy.current = true;
    setNotice(null);
    try {
      const wrongWallet = (text: string) => { dispatch({ type: "RESET" }); setNotice({ kind: "error", text }); };
      const to = chains?.[0];
      const reassign = purpose === "reassign_chain" && to !== undefined && previous !== undefined;
      if (reassign && pending.current) {
        const p = pending.current;
        if (!same(account.address, previous.address)) return wrongWallet(`Connect ${previous.walletName ?? "the current wallet"} (${shortAddress(previous.address)}) to approve the move.`);
        dispatch({ type: "START" });
        const previousSignature = await signMessage(p.message);
        dispatch({ type: "SIGNED" });
        const out = await api.reassignChain({ challengeId: p.challengeId, signature: p.signature, previousSignature, client: "web", walletProvider: p.walletProvider, signableChains: p.signableChains });
        pending.current = null;
        setAwaitingPrevious(false);
        dispatch({ type: "VERIFIED", isNewUser: out.isNewUser });
        return;
      }
      if (reassign) {
        if (same(account.address, previous.address)) return wrongWallet("Connect the wallet you want to move this chain to.");
        if (CHAINS[to].family !== CHAINS[account.chain].family) return wrongWallet(`This wallet can't hold ${CHAINS[to].label}. Connect a ${CHAINS[to].family === "evm" ? "EVM" : "Solana"} wallet.`);
      }
      dispatch({ type: "START" });
      const ch = await api.createChallenge({ purpose, chain: (reassign ? to : account.chain) as SignInChain, address: account.address, chains });
      const signature = await signMessage(ch.message);
      const body = { challengeId: ch.challengeId, signature, walletProvider: account.walletName ?? undefined, signableChains: account.signableChains };
      if (reassign) {
        pending.current = { ...body, message: ch.message };
        setAwaitingPrevious(true);
        dispatch({ type: "RESET" });
        setNotice({ kind: "info", text: `Now approve in ${previous.walletName ?? "your current wallet"} (${shortAddress(previous.address)}) to confirm the move.` });
        return;
      }
      dispatch({ type: "SIGNED" });
      const out = await api.verify({ ...body, client: "web" });
      dispatch({ type: "VERIFIED", isNewUser: out.isNewUser });
    } catch (err) {
      if (err instanceof WalletRejectedError) dispatch({ type: "FAILED", code: "WALLET_REJECTED" });
      else if (err instanceof ApiError) {
        // A stale or refused move cannot be resumed with the held signature.
        pending.current = null; setAwaitingPrevious(false);
        dispatch({ type: "FAILED", code: err.code, retryAfterSec: err.retryAfterSec });
        const held = (err.details as { assets?: unknown } | undefined)?.assets;
        if (err.code === "CHAIN_NOT_EMPTY" && Array.isArray(held) && held.length > 0) setNotice({ kind: "info", text: `You still hold: ${held.join(", ")}.` });
      } else dispatch({ type: "FAILED", code: "INTERNAL" });
    } finally {
      busy.current = false;
    }
  }, [purpose, signMessage]);

  const reset = useCallback((text?: string) => { pending.current = null; setAwaitingPrevious(false); setNotice(text ? { kind: "info", text } : null); dispatch({ type: "RESET" }); }, []);
  return { state, run, reset, notice, awaitingPrevious };
}

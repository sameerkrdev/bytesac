"use client";

import { describeError, type VerifyState, shortAddress } from "@repo/app-core";
import { CHAINS } from "@repo/validator";
import { Check, Copy, Loader2, PenLine, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectedAccount } from "@/lib/wallet/use-wallet-connector";

interface Props {
  account: ConnectedAccount | null;
  network: "supported" | "unsupported" | "none";
  state: VerifyState;
  onSign(): void;
  onRetry(): void;
  onRestart(): void;
  onDisconnect(): void;
  onSwitchNetwork(): void;
  onChooseNetwork?(): void;
  linkedAddresses?: ReadonlyArray<{ chain: string; address: string }>;
  expired?: boolean;
}

function Step({ done, label, n }: { done: boolean; label: string; n: number }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span aria-hidden className={`grid size-6 place-items-center rounded-full border ${done ? "border-sage bg-sage text-space" : "border-border-dark text-stone"}`}>
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <span className={done ? "text-ivory" : "text-stone"}>{label}</span>
      {done && <span className="sr-only">(complete)</span>}
    </li>
  );
}

export function VerifyWalletCard(p: Props) {
  const [copied, setCopied] = useState(false);
  const retryAfter = p.state.step === "error" ? (p.state.retryAfterSec ?? 0) : 0;
  const [remaining, setRemaining] = useState(retryAfter);
  useEffect(() => {
    setRemaining(retryAfter);
    if (retryAfter <= 0) return;
    const t = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [retryAfter, p.state]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const busy = p.state.step === "signing" || p.state.step === "verifying";
  const err = p.state.step === "error" ? describeError(p.state.code) : null;
  const alreadyLinked = Boolean(p.account && p.linkedAddresses?.some((a) => a.chain === p.account!.chain && a.address.toLowerCase() === p.account!.address.toLowerCase()));

  return (
    <Card className="w-full max-w-md rounded-2xl border-border-dark bg-slate">
      <CardHeader className="space-y-4">
        <ol aria-label="Sign-in steps" className="flex items-center gap-4">
          <Step n={1} done={p.network !== "none"} label="Connected" />
          <Step n={2} done={p.state.step === "done"} label="Sign to verify" />
        </ol>
        <CardTitle className="font-display text-2xl font-semibold text-ivory">Verify your wallet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {p.expired && (
          <p role="status" className="rounded-xl border border-info/40 bg-space/60 p-3 text-sm text-ivory">Your session expired. Sign in with your wallet again.</p>
        )}
        {p.network === "unsupported" ? (
          <div role="alert" className="space-y-3 rounded-xl border border-warning/40 p-4 text-sm text-ivory">
            <p>Your wallet is on a network Bytesac doesn't support yet. Switch to a supported network: Ethereum, Base, BNB Chain, Arbitrum or Solana.</p>
            <Button className="min-h-11" onClick={p.onSwitchNetwork}>Switch network</Button>
          </div>
        ) : p.account ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-stone">Wallet</dt><dd className="text-ivory">{p.account.walletName ?? "Wallet"}</dd>
              <dt className="text-stone">Network</dt><dd><span className="rounded-lg border border-border-dark px-2 py-0.5 text-xs text-ivory">{CHAINS[p.account.chain].label}</span></dd>
              <dt className="text-stone">Address</dt>
              <dd className="flex items-center gap-2 font-mono text-ivory">
                <span title={p.account.address}>{shortAddress(p.account.address)}</span>
                <button type="button" aria-label="Copy address" className="grid size-11 place-items-center rounded-lg text-stone hover:text-ivory"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(p.account!.address); setCopied(true); } catch { /* clipboard unavailable */ }
                  }}>
                  {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
                </button>
              </dd>
            </dl>
            <div className="flex gap-3 rounded-xl border border-border-dark bg-space/60 p-4 text-sm text-ivory">
              <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-mint" />
              <p>You're signing a message to prove you control this address. It does not authorize any transaction or spending.</p>
            </div>
            {err && (
              <div role="alert" className="rounded-xl border border-danger/40 p-4 text-sm">
                <p className="font-medium text-ivory">{err.title}</p>
                <p className="text-muted-foreground">
                  {err.message}
                  {remaining > 0 ? ` Try again in ${remaining} s.` : ""}
                </p>
              </div>
            )}
            {err?.recovery === "restart" ? (
              <Button className="min-h-11 w-full" onClick={p.onRestart}>Start again</Button>
            ) : err && (err.recovery === "retry" || err.recovery === "wait") ? (
              <Button className="min-h-11 w-full" disabled={remaining > 0} onClick={p.onRetry}>{remaining > 0 ? `Try again in ${remaining} s` : "Try again"}</Button>
            ) : err?.recovery === "reauthenticate" ? (
              <Button className="min-h-11 w-full" onClick={() => window.location.replace("/sign-in?reason=expired")}>Sign in again</Button>
            ) : err?.recovery === "fix-input" ? null : (
              <Button className="min-h-11 w-full" disabled={busy || p.state.step === "done" || alreadyLinked} onClick={p.onSign}>
                {p.state.step === "signing" ? <><Loader2 aria-hidden className="animate-spin" />Waiting for wallet…</>
                  : p.state.step === "verifying" ? <><Loader2 aria-hidden className="animate-spin" />Verifying…</>
                  : <><PenLine aria-hidden />Sign message</>}
              </Button>
            )}
            {alreadyLinked && !err && (
              <p className="text-sm text-muted-foreground">This account is already linked. Choose another network or account in your wallet.</p>
            )}
            {p.onChooseNetwork && (
              <Button variant="secondary" className="min-h-11 w-full" onClick={p.onChooseNetwork}>Choose network</Button>
            )}
          </>
        ) : null}
        <Button variant="ghost" className="min-h-11 w-full" onClick={p.onDisconnect}>Disconnect</Button>
      </CardContent>
    </Card>
  );
}

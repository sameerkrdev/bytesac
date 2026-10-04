"use client";
import { ArrowRight, Wallet } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChainBadge } from "@/components/visual/chain-badge";

/** First step of sign-in: connect a wallet. Signing comes next, as its own explicit step. */
export function WelcomeCard({ expired, onConnect }: { expired: boolean; onConnect(): void }) {
  return (
    <div className="space-y-8 rounded-shell border border-line bg-surface p-6 shadow-float sm:p-8">
      <ol aria-label="Sign-in steps" className="flex items-center gap-4 text-sm">
        <li className="flex items-center gap-2 text-ink"><span aria-hidden className="grid size-6 place-items-center rounded-full border border-primary font-mono text-[0.6875rem]">1</span>Connect</li>
        <li aria-hidden className="h-px w-8 bg-line-strong" />
        <li className="flex items-center gap-2 text-ink-faint"><span aria-hidden className="grid size-6 place-items-center rounded-full border border-line-strong font-mono text-[0.6875rem]">2</span>Sign to verify</li>
      </ol>
      {expired && (
        <p role="status" className="rounded-tile border border-info/20 bg-info-soft p-3 text-sm text-ink">Your session expired. Sign in with your wallet again.</p>
      )}
      <div className="space-y-3">
        <h1 className="type-title text-ink">Welcome to Bytesac</h1>
        <p className="text-ink-muted">Connect the wallet you invest from. You&apos;ll sign a short message next — it proves the wallet is yours and can&apos;t move funds.</p>
      </div>
      <div className="space-y-3">
        <Button size="lg" className="w-full" onClick={onConnect}><Wallet aria-hidden />Connect wallet</Button>
        <p className="text-center text-xs text-ink-faint">Sign in with a Solana or EVM wallet</p>
        <div className="flex flex-wrap justify-center gap-1.5">{["solana", "ethereum", "base", "bnb", "arbitrum"].map((c) => <ChainBadge key={c} chain={c} />)}</div>
      </div>
      <p className="border-t border-line pt-5 text-sm text-ink-muted">New to Bytesac? <Link href="/how-it-works" className="inline-flex items-center gap-1 text-ink underline-offset-4 hover:underline">See how it works<ArrowRight aria-hidden className="size-3.5" /></Link></p>
    </div>
  );
}

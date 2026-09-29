"use client";
import { Wallet } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export function WelcomeCard({ expired, onConnect }: { expired: boolean; onConnect(): void }) {
  return (
    <div className="w-full max-w-md space-y-6 text-center">
      <div className="flex justify-center"><Logo size={56} /></div>
      {expired && (
        <p role="status" className="rounded-xl border border-info/40 bg-slate p-3 text-sm text-ivory">Your session expired. Sign in with your wallet again.</p>
      )}
      <h1 className="font-display text-3xl font-bold text-ivory md:text-4xl">Welcome to Bytesac</h1>
      <p className="text-base leading-relaxed text-muted-foreground">Build, discover and invest in on-chain investment baskets.</p>
      <Button className="min-h-11 w-full" onClick={onConnect}><Wallet aria-hidden />Connect wallet</Button>
    </div>
  );
}

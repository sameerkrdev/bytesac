"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { InvestWizard } from "@/components/invest/invest-wizard";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** Where the user fixes each reason they cannot invest yet. */
const ACTIONS: Record<string, { href: string; label: string }> = {
  EMAIL_NOT_VERIFIED: { href: "/profile", label: "Verify your email" },
  PHONE_NOT_VERIFIED: { href: "/profile", label: "Verify your phone" },
  EVM_ADDRESS_REQUIRED: { href: "/profile", label: "Link an EVM wallet" },
  SOLANA_ADDRESS_REQUIRED: { href: "/profile", label: "Link a Solana wallet" },
  BTC_ADDRESS_REQUIRED: { href: "/profile", label: "Link a Bitcoin wallet" },
  OPERATION_IN_PROGRESS: { href: "/portfolio", label: "Finish your current operation" },
};

/** Invest when the basket is investable and the user is eligible; otherwise the reason, with a link to fix it. */
export function InvestButton({ slug, name, minimumUsdc, incrementUsdc }: { slug: string; name: string; minimumUsdc: string | null; incrementUsdc: string | null }) {
  const [open, setOpen] = useState(false);
  const inv = useQuery({ queryKey: ["investability", slug], queryFn: () => api.getInvestability(slug), retry: false });

  if (inv.isPending) return <Button disabled className="min-h-11">Checking…</Button>;
  if (!inv.data) return <Button disabled className="min-h-11">Investing is unavailable right now</Button>;
  const { investable, reasons, eligibility, basketId } = inv.data;
  if (!investable) {
    return (
      <div className="space-y-2">
        <Button disabled className="min-h-11">Not investable yet</Button>
        <ul className="text-sm text-stone">{reasons.map((r) => <li key={`${r.instrumentId ?? ""}${r.code}`}>{r.message}</li>)}</ul>
      </div>
    );
  }
  if (!eligibility) return <Link href="/sign-in" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80">Sign in to invest</Link>;
  if (!eligibility.eligible) {
    return (
      <div className="space-y-2">
        <Button disabled className="min-h-11">Invest</Button>
        <ul className="space-y-1 text-sm">
          {eligibility.reasons.map((r) => {
            const a = ACTIONS[r.code];
            return <li key={r.code}>{a ? <Link href={a.href} className="inline-flex min-h-11 items-center text-mint underline">{a.label}</Link> : <span className="text-stone">{r.message}</span>}</li>;
          })}
        </ul>
      </div>
    );
  }
  return (
    <>
      <Button className="min-h-11" onClick={() => setOpen(true)}>Invest</Button>
      {open && <InvestWizard basketId={basketId} name={name} minimumUsdc={minimumUsdc} incrementUsdc={incrementUsdc} open={open} onOpenChange={setOpen} />}
    </>
  );
}

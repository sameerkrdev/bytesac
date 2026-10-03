"use client";

import { INELIGIBLE_ACTION } from "@repo/app-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { InvestWizard } from "@/components/invest/invest-wizard";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const ROUTE = { profile: "/profile", portfolio: "/portfolio" } as const;

/** Invest when the basket is investable and the user is eligible; otherwise the reason, with a link to fix it. */
export function InvestButton({ slug, name, minimumUsdc, incrementUsdc }: { slug: string; name: string; minimumUsdc: string | null; incrementUsdc: string | null }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
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
          {eligibility.reasons.filter((r, n, all) => r.code !== "DECLARATION_REQUIRED" || all.findIndex((x) => x.code === r.code) === n).map((r) => {
            if (r.code === "DECLARATION_REQUIRED") return <li key={r.code} className="space-y-2"><p className="text-stone">{r.message}</p><DeclarationForm onSaved={() => void qc.invalidateQueries({ queryKey: ["investability", slug] })} /></li>;
            const a = INELIGIBLE_ACTION[r.code];
            return <li key={`${r.instrumentId ?? ""}${r.code}`}>{a ? <Link href={ROUTE[a.target]} className="inline-flex min-h-11 items-center text-mint underline">{a.label}</Link> : <span className="text-stone">{r.message}</span>}</li>;
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

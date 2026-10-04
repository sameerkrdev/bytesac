"use client";

import { INELIGIBLE_ACTION } from "@repo/app-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { InvestWizard } from "@/components/invest/invest-wizard";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";

const ROUTE = { profile: "/profile", portfolio: "/portfolio" } as const;

/** Invest when the basket is investable and the user is eligible; otherwise the reason, with a link to fix it. */
export function InvestButton({ slug, name, minimumUsdc, incrementUsdc, mode = "dialog" }: { slug: string; name: string; minimumUsdc: string | null; incrementUsdc: string | null; mode?: "dialog" | "page" }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const inv = useQuery({ queryKey: ["investability", slug], queryFn: () => api.getInvestability(slug), retry: false });

  if (inv.isPending) return <Button disabled>Checking…</Button>;
  if (!inv.data) return <Button disabled>Investing is unavailable right now</Button>;
  const { investable, reasons, eligibility, basketId } = inv.data;
  if (!investable) {
    return (
      <div className="space-y-2">
        <Button disabled>Not investable yet</Button>
        <ul className="text-sm text-ink-muted">{reasons.map((r) => <li key={`${r.instrumentId ?? ""}${r.code}`}>{r.message}</li>)}</ul>
      </div>
    );
  }
  if (!eligibility) return <Link href="/sign-in" className={buttonVariants({ size: "lg" })}>Sign in to invest</Link>;
  if (!eligibility.eligible) {
    return (
      <div className="space-y-2">
        <Button disabled>Invest</Button>
        <ul className="space-y-1 text-sm">
          {eligibility.reasons.filter((r, n, all) => r.code !== "DECLARATION_REQUIRED" || all.findIndex((x) => x.code === r.code) === n).map((r) => {
            if (r.code === "DECLARATION_REQUIRED") return <li key={r.code} className="space-y-2"><p className="text-ink-muted">{r.message}</p><DeclarationForm onSaved={() => void qc.invalidateQueries({ queryKey: ["investability", slug] })} /></li>;
            const a = INELIGIBLE_ACTION[r.code];
            return <li key={`${r.instrumentId ?? ""}${r.code}`}>{a ? <Link href={ROUTE[a.target]} className="inline-flex min-h-11 items-center text-ink underline underline-offset-4">{a.label}</Link> : <span className="text-ink-muted">{r.message}</span>}</li>;
          })}
        </ul>
      </div>
    );
  }
  return (
    <>
      {mode === "page" ? <Link href={`/baskets/${slug}/invest`} className={buttonVariants({ size: "lg" })}>Invest</Link> : <Button size="lg" onClick={() => setOpen(true)}>Invest</Button>}
      {open && <InvestWizard basketId={basketId} name={name} minimumUsdc={minimumUsdc} incrementUsdc={incrementUsdc} open={open} onOpenChange={setOpen} />}
    </>
  );
}

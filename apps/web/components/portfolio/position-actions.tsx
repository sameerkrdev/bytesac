"use client";

import type { Headline, Portfolio } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, GitCompareArrows, Pencil, RefreshCw, Scale } from "lucide-react";
import Link from "next/link";
import { ErrorBox } from "@/components/portfolio/exit-dialogs";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Position = Portfolio["positions"][number];

const HEADLINES: Record<Headline, { label: string; icon: typeof Clock; cls: string }> = {
  EXECUTION_PENDING: { label: "Operation in progress", icon: Clock, cls: "text-warning border-warning/40" },
  REPAIR_REQUIRED: { label: "Needs repair", icon: AlertTriangle, cls: "text-danger border-danger/40" },
  EXECUTION_INCOMPLETE: { label: "Plan incomplete", icon: AlertTriangle, cls: "text-warning border-warning/40" },
  REBALANCE_AVAILABLE: { label: "New version available", icon: RefreshCw, cls: "text-mint border-mint/40" },
  DRIFTED: { label: "Drifted from target", icon: Scale, cls: "text-warning border-warning/40" },
  CUSTOMIZED: { label: "Custom allocation", icon: Pencil, cls: "text-stone border-border-dark" },
  ALIGNED: { label: "Aligned", icon: CheckCircle2, cls: "text-success border-success/40" },
};
const link = "inline-flex min-h-11 items-center rounded-lg border border-border-dark px-3 text-sm text-ivory hover:bg-slate";

/** The headline state of an open position and the action that goes with it. Nothing here moves assets; every plan is reviewed and signed on the next page. */
export function PositionActions({ position: p, repairAsset }: { position: Position; repairAsset?: string }) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["portfolio"] });
  const keep = useMutation({ mutationFn: () => api.keepCustom(p.id), onSuccess: done });
  const revert = useMutation({ mutationFn: () => api.revertCustom(p.id), onSuccess: done });
  const h = HEADLINES[p.headline];
  const base = `/portfolio/${p.id}/rebalance`;
  const skipped = p.states.version === "SKIPPED" && p.headline !== "REBALANCE_AVAILABLE";
  const err = keep.error ?? revert.error;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium", h.cls)}><h.icon aria-hidden className="size-3.5" />{h.label}</span>
        {skipped && p.latestVersion && <span className="text-xs text-stone">You skipped version {p.latestVersion.number}</span>}
        <span className="text-xs text-stone">Applied version {p.appliedVersionNumber}</span>
      </div>
      <div className="flex flex-wrap gap-3">
        {(p.headline === "REBALANCE_AVAILABLE" || skipped) && p.latestVersion && <Link href={`${base}?target=latest`} className={link}>Review update</Link>}
        {p.headline === "DRIFTED" && (
          <>
            <Link href={`${base}?target=${p.states.version === "CURRENT" ? "applied" : "latest"}`} className={link}>Rebalance to target</Link>
            <Button variant="secondary" className="min-h-11" disabled={keep.isPending} onClick={() => keep.mutate()}>Keep custom</Button>
          </>
        )}
        {p.headline === "CUSTOMIZED" && <Button variant="secondary" className="min-h-11" disabled={revert.isPending} onClick={() => revert.mutate()}>Revert custom</Button>}
        {p.headline === "REPAIR_REQUIRED" && <Link href={`/portfolio/repair/${repairAsset ?? "cash"}`} className={link}><GitCompareArrows aria-hidden className="mr-2 size-4" />Repair</Link>}
        {p.headline === "EXECUTION_INCOMPLETE" && <Link href={`${base}?target=${p.states.version === "CURRENT" ? "applied" : "latest"}`} className={link}>Continue</Link>}
        {p.headline === "EXECUTION_PENDING" && <Link href="#open-operations" className={link}>View operation</Link>}
      </div>
      {err && <ErrorBox error={err} />}
    </div>
  );
}

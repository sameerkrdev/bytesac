"use client";

import { HEADLINE_LABEL, isSkipped, positionActions, type PositionAction } from "@repo/app-core";
import type { Headline, Portfolio } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, GitCompareArrows, Pencil, RefreshCw, Scale } from "lucide-react";
import Link from "next/link";
import { ErrorBox } from "@/components/portfolio/exit-dialogs";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Position = Portfolio["positions"][number];

const STYLE: Record<Headline, { icon: typeof Clock; cls: string }> = {
  EXECUTION_PENDING: { icon: Clock, cls: "text-warning border-warning/40" },
  REPAIR_REQUIRED: { icon: AlertTriangle, cls: "text-danger border-danger/40" },
  EXECUTION_INCOMPLETE: { icon: AlertTriangle, cls: "text-warning border-warning/40" },
  REBALANCE_AVAILABLE: { icon: RefreshCw, cls: "text-mint border-mint/40" },
  DRIFTED: { icon: Scale, cls: "text-warning border-warning/40" },
  CUSTOMIZED: { icon: Pencil, cls: "text-stone border-border-dark" },
  ALIGNED: { icon: CheckCircle2, cls: "text-success border-success/40" },
};
const link = "inline-flex min-h-11 items-center rounded-lg border border-border-dark px-3 text-sm text-ivory hover:bg-slate";

/** The headline state of an open position and the action that goes with it. Nothing here moves assets; every plan is reviewed and signed on the next page. */
export function PositionActions({ position: p, repairAsset }: { position: Position; repairAsset?: string }) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["portfolio"] });
  const keep = useMutation({ mutationFn: () => api.keepCustom(p.id), onSuccess: done });
  const revert = useMutation({ mutationFn: () => api.revertCustom(p.id), onSuccess: done });
  const h = { ...HEADLINE_LABEL[p.headline], ...STYLE[p.headline] };
  const base = `/portfolio/${p.id}/rebalance`;
  const skipped = isSkipped(p);
  const err = keep.error ?? revert.error;
  const action = (a: PositionAction) => {
    switch (a.kind) {
      case "review": case "rebalance": case "continue": return <Link key={a.kind} href={`${base}?target=${a.target}`} className={link}>{a.label}</Link>;
      case "keepCustom": return <Button key={a.kind} variant="secondary" className="min-h-11" disabled={keep.isPending} onClick={() => keep.mutate()}>{a.label}</Button>;
      case "revertCustom": return <Button key={a.kind} variant="secondary" className="min-h-11" disabled={revert.isPending} onClick={() => revert.mutate()}>{a.label}</Button>;
      case "repair": return <Link key={a.kind} href={`/portfolio/repair/${repairAsset ?? "cash"}`} className={link}><GitCompareArrows aria-hidden className="mr-2 size-4" />{a.label}</Link>;
      case "viewOperation": return <Link key={a.kind} href="#open-operations" className={link}>{a.label}</Link>;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium", h.cls)}><h.icon aria-hidden className="size-3.5" />{h.label}</span>
        {skipped && p.latestVersion && <span className="text-xs text-stone">You skipped version {p.latestVersion.number}</span>}
        <span className="text-xs text-stone">Applied version {p.appliedVersionNumber}</span>
      </div>
      <div className="flex flex-wrap gap-3">{positionActions(p).map((a) => action(a))}</div>
      {err && <ErrorBox error={err} />}
    </div>
  );
}

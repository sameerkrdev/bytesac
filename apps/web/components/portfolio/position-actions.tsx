"use client";

import { HEADLINE_LABEL, isSkipped, positionActions, type PositionAction } from "@repo/app-core";
import type { Headline, Portfolio } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, GitCompareArrows, Pencil, RefreshCw, Scale } from "lucide-react";
import Link from "next/link";
import { ErrorBox } from "@/components/portfolio/exit-dialogs";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Position = Portfolio["positions"][number];

const STYLE: Record<Headline, { icon: typeof Clock; cls: string }> = {
  EXECUTION_PENDING: { icon: Clock, cls: "bg-warning-soft text-warning" },
  REPAIR_REQUIRED: { icon: AlertTriangle, cls: "bg-danger-soft text-danger" },
  EXECUTION_INCOMPLETE: { icon: AlertTriangle, cls: "bg-warning-soft text-warning" },
  REBALANCE_AVAILABLE: { icon: RefreshCw, cls: "bg-info-soft text-info" },
  DRIFTED: { icon: Scale, cls: "bg-warning-soft text-warning" },
  CUSTOMIZED: { icon: Pencil, cls: "bg-surface-muted text-ink-muted" },
  ALIGNED: { icon: CheckCircle2, cls: "bg-success-soft text-success" },
};

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
  const action = (a: PositionAction, i: number) => {
    const link = buttonVariants({ variant: i === 0 ? "default" : "secondary" });
    switch (a.kind) {
      case "review": case "rebalance": case "continue": return <Link key={a.kind} href={`${base}?target=${a.target}`} className={link}>{a.label}</Link>;
      case "keepCustom": return <Button key={a.kind} variant={i === 0 ? "default" : "secondary"} disabled={keep.isPending} onClick={() => keep.mutate()}>{a.label}</Button>;
      case "revertCustom": return <Button key={a.kind} variant={i === 0 ? "default" : "secondary"} disabled={revert.isPending} onClick={() => revert.mutate()}>{a.label}</Button>;
      case "repair": return <Link key={a.kind} href={`/portfolio/repair/${repairAsset ?? "cash"}`} className={link}><GitCompareArrows aria-hidden className="size-4" />{a.label}</Link>;
      case "viewOperation": return <Link key={a.kind} href="/portfolio#open-operations" className={link}>{a.label}</Link>;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium", h.cls)}><h.icon aria-hidden className="size-3.5" />{h.label}</span>
        {skipped && p.latestVersion && <span className="text-xs text-ink-muted">You skipped version {p.latestVersion.number}</span>}
        <span className="text-xs text-ink-muted">Applied version {p.appliedVersionNumber}</span>
      </div>
      <div className="flex flex-wrap gap-2">{positionActions(p).map((a, i) => action(a, i))}</div>
      {err && <ErrorBox error={err} />}
    </div>
  );
}

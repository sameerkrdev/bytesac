"use client";

import { HEADLINE_HELP, HEADLINE_LABEL, portfolioAllocation, positionValue, usd } from "@repo/app-core";
import type { Headline, Portfolio } from "@repo/validator";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, GitCompareArrows, Pencil, Scale } from "lucide-react";
import Link from "next/link";
import { PositionActions } from "@/components/portfolio/position-actions";
import { StatusBadge } from "@/components/status-badge";
import { Figure } from "@/components/ui/kit";
import { AllocationBar, AllocationLegend, AllocationRing } from "@/components/visual/allocation-ring";
import { ChainBadge } from "@/components/visual/chain-badge";
import { cn } from "@/lib/utils";

type Position = Portfolio["positions"][number];

export { HEADLINE_HELP, positionValue, usd };

const ICON: Record<Headline, typeof Clock> = {
  EXECUTION_PENDING: Clock, REPAIR_REQUIRED: AlertTriangle, EXECUTION_INCOMPLETE: AlertTriangle, REBALANCE_AVAILABLE: GitCompareArrows, DRIFTED: Scale, CUSTOMIZED: Pencil, ALIGNED: CheckCircle2,
};

export function HeadlineBadge({ headline }: { headline: Headline }) {
  return <StatusBadge {...HEADLINE_LABEL[headline]} />;
}

/** Total value, allocation by asset across every open position, and the networks involved. */
export function PortfolioSummary({ portfolio, compact = false }: { portfolio: Portfolio; compact?: boolean }) {
  const open = portfolio.positions;
  const { total, slices, legend, chains, attention } = portfolioAllocation(portfolio);

  return (
    <section aria-label="Portfolio summary" className={cn("grid gap-8 rounded-shell border border-line bg-surface p-6 sm:p-8", !compact && "lg:grid-cols-[minmax(0,1fr)_auto_18rem] lg:items-center")}>
      <div className="space-y-5">
        <div>
          <p className="type-eyebrow text-ink-faint">Portfolio value</p>
          <p className="mt-2">{total === null ? <span className="type-figure text-4xl text-ink-muted">Value unavailable</span> : <Figure value={usd(total)} size="xl" />}</p>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div><dt className="text-xs text-ink-faint">Baskets</dt><dd className="text-ink">{open.length}</dd></div>
          <div><dt className="text-xs text-ink-faint">Need your attention</dt><dd className={attention ? "text-warning" : "text-ink"}>{attention}</dd></div>
          <div><dt className="text-xs text-ink-faint">Open operations</dt><dd className="text-ink">{portfolio.openOperations.length}</dd></div>
        </dl>
        <p className="max-w-md text-xs text-ink-faint">Values use current market prices for the holdings Bytesac has reconciled in your wallets. Performance history over time isn’t available yet.</p>
      </div>
      {!compact && slices.length > 0 && (
        <AllocationRing slices={legend} size={176} thickness={14} className="mx-auto" label={`Portfolio by asset: ${legend.map((s) => `${s.label} ${(s.bps / 100).toFixed(0)}%`).join(", ")}`}>
          <div><p className="type-figure text-2xl text-ink">{slices.length}</p><p className="text-[0.6875rem] text-ink-muted">assets</p></div>
        </AllocationRing>
      )}
      {!compact && slices.length > 0 && (
        <div className="space-y-4">
          <AllocationLegend slices={legend} />
          <div className="flex flex-wrap gap-1.5">{[...chains].map((c) => <ChainBadge key={c} chain={c} compact />)}</div>
        </div>
      )}
    </section>
  );
}

/** Positions that need a decision, each with its cause stated first and the actions that fit. */
export function AttentionList({ portfolio }: { portfolio: Portfolio }) {
  const items = portfolio.positions.filter((p) => p.headline !== "ALIGNED");
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="attention-title" className="space-y-4">
      <h2 id="attention-title" className="type-heading text-ink">Needs your attention</h2>
      <ul className="grid gap-4 lg:grid-cols-2">
        {items.map((p) => {
          const Icon = ICON[p.headline];
          const repair = portfolio.repairs.find((r) => r.positions.some((x) => x.positionId === p.id))?.asset;
          return (
            <li key={p.id} className="flex flex-col gap-4 rounded-card border border-line bg-surface p-6">
              <div className="flex items-start gap-3">
                <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center rounded-full", p.headline === "REPAIR_REQUIRED" ? "bg-danger-soft text-danger" : p.headline === "REBALANCE_AVAILABLE" ? "bg-info-soft text-info" : "bg-warning-soft text-warning")}><Icon className="size-4.5" /></span>
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-ink"><Link href={`/portfolio/${p.id}`} className="underline-offset-4 hover:underline">{p.basketName}</Link></p>
                  <p className="text-sm text-ink-muted">{HEADLINE_HELP[p.headline]}</p>
                  {p.headline === "REBALANCE_AVAILABLE" && p.latestVersion && <p className="text-xs text-ink-faint">Version {p.appliedVersionNumber} → {p.latestVersion.number}</p>}
                </div>
              </div>
              <div className="mt-auto"><PositionActions position={p} repairAsset={repair} /></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A compact row per position for overviews: name, headline, value and actual-vs-target bar. */
export function PositionRows({ positions }: { positions: Position[] }) {
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {positions.map((p) => {
        const v = positionValue(p);
        return (
          <li key={p.id}>
            <Link href={`/portfolio/${p.id}`} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-surface-muted sm:grid-cols-[minmax(0,1fr)_10rem_7rem_auto] sm:items-center">
              <span className="min-w-0"><span className="block truncate font-medium text-ink">{p.basketName}</span><span className="mt-1 block"><HeadlineBadge headline={p.headline} /></span></span>
              <AllocationBar slices={p.holdings.map((h) => ({ key: h.deploymentId, label: h.symbol, bps: h.actualBps ?? 0 }))} label={`${p.basketName} current allocation`} />
              <span className="text-ink tabular-nums sm:text-right">{v === null ? "—" : usd(v)}</span>
              <ArrowUpRight aria-hidden className="hidden size-4 text-ink-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 sm:block" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

import { formatBps, formatUnits } from "@repo/app-core";
import { ASSET_CHAINS, type Portfolio } from "@repo/validator";
import { AlertTriangle, ArrowUpRight, Check, CircleDot } from "lucide-react";
import { formatDate } from "@/lib/format-date";
import { positionValue, usd } from "@/components/portfolio/summary";
import Link from "next/link";
import { CloseDialog, LeaveDialog, SellDialog } from "@/components/portfolio/exit-dialogs";
import { PositionActions } from "@/components/portfolio/position-actions";
import { StatusBadge } from "@/components/status-badge";
import { AssetMark } from "@/components/visual/chain-badge";
import { cn } from "@/lib/utils";

type Position = Portfolio["positions"][number];

/** Target and actual weight on one track: the target is a tick, the actual a filled bar. */
export function WeightTrack({ actual, target, symbol, band }: { actual: number | null; target: number | null; symbol: string; band?: number }) {
  const lo = target !== null && band ? Math.max(0, target - band) : null;
  const hi = target !== null && band ? Math.min(10_000, target + band) : null;
  return (
    <div className="relative h-2 w-full rounded-pill bg-surface-sunken" role="img" aria-label={`${symbol}: ${actual === null ? "actual weight unavailable" : `actual ${formatBps(actual)}`}, target ${target === null ? "none" : formatBps(target)}${lo !== null && hi !== null ? `, band ${formatBps(lo)} to ${formatBps(hi)}` : ""}`}>
      {lo !== null && hi !== null && <div className="absolute -inset-y-0.5 rounded-pill bg-data4/40" style={{ left: `${lo / 100}%`, width: `${(hi - lo) / 100}%` }} />}
      <div className="absolute inset-y-0 left-0 rounded-pill bg-data2" style={{ width: `${Math.min((actual ?? 0) / 100, 100)}%` }} />
      {target !== null && <div className="absolute -inset-y-1 w-0.5 rounded-pill bg-ink" style={{ left: `calc(${Math.min(target / 100, 100)}% - 1px)` }} />}
    </div>
  );
}

/** Open positions (value, actual against target weights, reconciliation notices, exit actions) or former ones (sell what is left). */
export function PositionsList({ positions, former, repairs = [], linkDetail = true }: { positions: Position[]; former?: boolean; repairs?: Portfolio["repairs"]; linkDetail?: boolean }) {
  return (
    <ul className="space-y-5">
      {positions.map((p) => {
        const value = p.holdings.length > 0 ? positionValue(p) : null;
        const short = p.holdings.filter((h) => h.reconciliation === "SHORT");
        const dust = !former && value !== null && value < 1;
        const surplus = p.holdings.filter((h) => h.reconciliation === "SURPLUS");
        return (
          <li key={p.id} className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-4 p-6 pb-5">
              <div className="min-w-0 space-y-1">
                <Link href={`/baskets/${p.basketSlug}`} className="type-heading text-ink underline-offset-4 hover:underline">{p.basketName}</Link>
                <p className="text-sm text-ink-muted">{former ? `Left ${formatDate(p.closedAt ?? p.openedAt)} · assets are in your wallets, outside the basket` : `Opened ${formatDate(p.openedAt)} · drift band ±${formatBps(p.driftThresholdBps)}`}</p>
              </div>
              <div className="text-right">
                <p className="type-figure text-3xl text-ink">{value === null ? "Value unavailable" : usd(value)}</p>
                {!former && linkDetail && <Link href={`/portfolio/${p.id}`} className="mt-1 inline-flex items-center gap-1 text-xs text-ink-muted underline-offset-4 hover:text-ink hover:underline">Position detail<ArrowUpRight aria-hidden className="size-3.5" /></Link>}
              </div>
            </div>
            {!former && <div className="px-6 pb-5"><PositionActions position={p} repairAsset={repairs.find((r) => r.positions.some((x) => x.positionId === p.id))?.asset} /></div>}
            {(short.length > 0 || surplus.length > 0) && (
              <div className="space-y-2 px-6 pb-5">
                {short.length > 0 && <p role="status" className="flex gap-3 rounded-tile border border-warning/25 bg-warning-soft p-3 text-sm text-ink"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" /><span>Your wallet holds less {short.map((h) => h.symbol).join(", ")} than Bytesac recorded for this basket, so part of it may have been moved. Shortfalls are shared across your baskets in proportion. Nothing is bought or sold automatically.</span></p>}
                {surplus.length > 0 && <p role="status" className="flex gap-3 rounded-tile border border-line bg-surface-muted p-3 text-sm text-ink-muted"><CircleDot aria-hidden className="mt-0.5 size-4 shrink-0" />Extra {surplus.map((h) => h.symbol).join(", ")} in your wallet is outside your baskets.</p>}
              </div>
            )}
            <div className="border-t border-line">
              <div className={cn("hidden gap-4 px-6 py-2.5 text-[0.6875rem] text-ink-faint md:grid", former ? "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)]")}>
                <span>Asset · network</span>{!former && <span>Your weight · target tick · band</span>}<span className="text-right">Recorded for this basket · checked on chain</span>
              </div>
              <ul className="divide-y divide-line border-t border-line md:border-t-0">
                {p.holdings.map((h, i) => (
                  <li key={h.deploymentId} className={cn("grid gap-3 px-6 py-4 text-sm md:items-center md:gap-4", former ? "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,1fr)]")}>
                    <span className="flex min-w-0 items-center gap-3">
                      <AssetMark symbol={h.symbol} index={i} size={30} />
                      <span className="min-w-0"><span className="block text-ink">{h.symbol} <span className="text-ink-muted">on {ASSET_CHAINS[h.chain].label}</span></span>
                        {h.reconciliation === "SHORT" && <StatusBadge tone="warning" label="Wallet holds less than recorded" className="mt-1" />}
                        {h.reconciliation === "SURPLUS" && <StatusBadge tone="neutral" label="Extra outside baskets" className="mt-1" />}
                      </span>
                    </span>
                    {!former && (
                      <span className="flex items-center gap-3">
                        <WeightTrack actual={h.actualBps} target={h.targetBps} symbol={h.symbol} band={p.driftThresholdBps} />
                        <span className="w-36 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums"><span className="text-ink">{h.actualBps === null ? "n/a" : formatBps(h.actualBps)}</span> <span className="text-ink-faint">{`target ${h.targetBps === null ? "n/a" : formatBps(h.targetBps)}`}</span></span>
                      </span>
                    )}
                    <span className="text-ink md:text-right">{formatUnits(h.quantity, h.decimals)} {h.symbol}{h.valueUsd !== null && <span className="text-ink-muted"> · ${h.valueUsd}</span>}{h.reconciliation === "OK" && <span className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-success md:justify-end"><Check aria-hidden className="size-3" />Verified in wallet</span>}</span>
                  </li>
                ))}
                {BigInt(p.cashMicro) > 0n && (
                  <li className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 text-sm"><span className="text-ink">Cash (USDC)</span><span className="text-ink">{formatUnits(p.cashMicro, 6)} USDC</span></li>
                )}
              </ul>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line bg-surface-muted/50 px-6 py-4">
              {!former && <LeaveDialog position={p} />}
              {dust && <CloseDialog position={p} />}
              <SellDialog position={p} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

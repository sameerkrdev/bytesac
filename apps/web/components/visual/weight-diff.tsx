"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

export type WeightRow = { key: string; label: string; fromBps: number | null; toBps: number | null };

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

/**
 * Current → new target weights for a strategy update, one row per asset, with the change spelled out.
 * This compares two TARGETS (applied version vs new version); it never claims anything about the user's wallet.
 */
export function WeightDiff({ rows, fromLabel = "Current target", toLabel = "New version", className }: { rows: WeightRow[]; fromLabel?: string; toLabel?: string; className?: string }) {
  const reduce = useReducedMotion();
  const max = Math.max(1, ...rows.flatMap((r) => [r.fromBps ?? 0, r.toBps ?? 0]));
  return (
    <div className={cn("w-full", className)}>
      <div className="grid grid-cols-[minmax(4.5rem,1fr)_minmax(0,2.4fr)_4.5rem] items-center gap-x-4 pb-2 type-eyebrow text-ink-faint">
        <span>Asset</span>
        <span className="flex gap-4"><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-3 rounded-pill bg-line-strong" />{fromLabel}</span><span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-1.5 w-3 rounded-pill bg-primary" />{toLabel}</span></span>
        <span className="text-right">Change</span>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r, i) => {
          const from = r.fromBps ?? 0, to = r.toBps ?? 0, d = to - from;
          const change = r.fromBps === null ? "Added" : r.toBps === null ? "Removed" : d === 0 ? "No change" : `${d > 0 ? "↑ +" : "↓ −"}${pct(Math.abs(d))}`;
          return (
            <li key={r.key} className="grid grid-cols-[minmax(4.5rem,1fr)_minmax(0,2.4fr)_4.5rem] items-center gap-x-4 py-3">
              <span className="truncate text-sm font-medium text-ink">{r.label}</span>
              <span className="space-y-1.5" aria-label={`${r.label}: ${r.fromBps === null ? "not held" : pct(from)} to ${r.toBps === null ? "removed" : pct(to)}`}>
                <span className="flex items-center gap-2">
                  <span className="h-1.5 rounded-pill bg-line-strong" style={{ width: `${(from / max) * 100}%` }} />
                  <span className="font-mono text-[0.6875rem] text-ink-faint tabular-nums">{r.fromBps === null ? "—" : pct(from)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <motion.span className="h-1.5 rounded-pill bg-primary" initial={reduce ? false : { width: `${(from / max) * 100}%` }} whileInView={{ width: `${(to / max) * 100}%` }} viewport={{ once: true, amount: 0.6 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 + i * 0.08 }} style={{ width: `${(to / max) * 100}%` }} />
                  <span className="font-mono text-[0.6875rem] text-ink tabular-nums">{r.toBps === null ? "—" : pct(to)}</span>
                </span>
              </span>
              <span className={cn("text-right font-mono text-xs tabular-nums", d === 0 && r.fromBps !== null && r.toBps !== null ? "text-ink-faint" : "text-ink")}>{change}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

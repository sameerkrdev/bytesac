"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Slice = { key: string; label: string; bps: number };

/** Categorical data palette (theme-aware CSS roles). Order matters: largest slice gets the strongest colour. */
export const DATA_COLORS = ["var(--c-data1)", "var(--c-data2)", "var(--c-data3)", "var(--c-data4)", "var(--c-data5)", "var(--c-data6)"];
export const colorAt = (i: number) => DATA_COLORS[i % DATA_COLORS.length]!;

/**
 * A target-allocation ring. Segments draw in sequence when it enters the view; the centre slot takes a label.
 * It shows a strategy's TARGET weights only — holdings are shown elsewhere and never with this component's styling alone.
 */
export function AllocationRing({ slices, size = 220, thickness = 18, gapDeg = 2.2, children, className, label, animate = true }: {
  slices: Slice[]; size?: number; thickness?: number; gapDeg?: number; children?: ReactNode; className?: string; label: string; animate?: boolean;
}) {
  const reduce = useReducedMotion();
  const total = slices.reduce((s, x) => s + x.bps, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  let start = -90;
  const arcs = slices.map((s, i) => {
    const sweep = (s.bps / total) * 360;
    const a0 = start + gapDeg / 2;
    const a1 = start + Math.max(sweep - gapDeg / 2, gapDeg / 2 + 0.01);
    start += sweep;
    const p = (a: number) => [c + r * Math.cos((a * Math.PI) / 180), c + r * Math.sin((a * Math.PI) / 180)] as const;
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return { key: s.key, d: `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`, color: colorAt(i), i };
  });
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--c-line)" strokeWidth={thickness} opacity={0.5} />
        {arcs.map((a) => (
          <motion.path key={a.key} d={a.d} fill="none" stroke={a.color} strokeWidth={thickness} strokeLinecap="butt"
            initial={animate && !reduce ? { pathLength: 0, opacity: 0 } : false}
            whileInView={{ pathLength: 1, opacity: 1 }} viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.15 + a.i * 0.12 }} />
        ))}
      </svg>
      {children && <div className="absolute inset-0 grid place-items-center text-center">{children}</div>}
    </div>
  );
}

/** Legend rows that pair with the ring: swatch, label, weight. */
export function AllocationLegend({ slices, className, format = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%` }: { slices: Slice[]; className?: string; format?: (bps: number) => string }) {
  return (
    <ul className={cn("divide-y divide-line", className)}>
      {slices.map((s, i) => (
        <li key={s.key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: colorAt(i) }} />
            <span className="truncate text-ink">{s.label}</span>
          </span>
          <span className="font-mono text-xs text-ink-muted tabular-nums">{format(s.bps)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A single horizontal stacked bar: compact allocation for cards and tables. */
export function AllocationBar({ slices, className, label }: { slices: Slice[]; className?: string; label: string }) {
  const total = slices.reduce((s, x) => s + x.bps, 0) || 1;
  return (
    <div role="img" aria-label={label} className={cn("flex h-1.5 w-full gap-0.5 overflow-hidden rounded-pill", className)}>
      {slices.map((s, i) => <span key={s.key} className="h-full first:rounded-l-pill last:rounded-r-pill" style={{ width: `${(s.bps / total) * 100}%`, background: colorAt(i) }} />)}
    </div>
  );
}

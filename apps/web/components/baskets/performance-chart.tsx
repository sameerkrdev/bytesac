"use client";

import { formatFraction } from "@repo/app-core/format";
import type { PublicBasketDetail } from "@repo/validator";
import { useState } from "react";
import { cn } from "@/lib/utils";

const RANGES = [{ id: "30d", label: "30 d", days: 30 }, { id: "90d", label: "90 d", days: 90 }, { id: "1y", label: "1 y", days: 365 }, { id: "all", label: "All", days: Infinity }] as const;
const DAY = 86_400_000;
const W = 720, H = 280, L = 44, R = 8, T = 16, B = 28;

const TILES = [["sinceLaunch", "Since launch", 1], ["d30", "30 days", 30], ["d90", "90 days", 90], ["y1", "1 year", 365]] as const;

type Props = { performance: PublicBasketDetail["performance"]; metrics: PublicBasketDetail["metrics"]; label: string };

/**
 * Simulated model performance with the mandatory label (D-064). Net is the headline; gross is secondary and dashed.
 * Hover or arrow keys inspect a day; the data table carries every value for screen readers.
 */
export function PerformanceChart({ performance, metrics, label }: Props) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  const [hover, setHover] = useState<number | null>(null);
  const unavailable = !metrics.available;
  const soon = (days: number) => `Available after ${days} days of data`;
  const tile = (value: string | null, days: number, signed = true) => (unavailable ? "Performance unavailable" : value === null ? soon(days) : formatFraction(value, signed));

  const all = performance.series;
  const last = all.at(-1);
  const span = RANGES.find((r) => r.id === range)!.days;
  const cut = last ? Date.parse(last.day) - span * DAY : 0;
  const pts = all.filter((p) => Date.parse(p.day) >= cut);
  const first = pts[0];
  const values = pts.flatMap((p) => [Number(p.net), Number(p.gross)]);
  const lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo || 1) * 0.12;
  const x = (day: string) => L + ((Date.parse(day) - Date.parse(first!.day)) / ((Date.parse(pts.at(-1)!.day) - Date.parse(first!.day)) || 1)) * (W - L - R);
  const y = (v: string) => T + (1 - (Number(v) - (lo - pad)) / (hi - lo + 2 * pad)) * (H - T - B);
  const line = (key: "net" | "gross") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];
  const h = hover !== null ? pts[Math.min(hover, pts.length - 1)] : undefined;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - box.left) / box.width) * (W - L - R);
    const t = Date.parse(first!.day) + (rel / (W - L - R)) * (Date.parse(pts.at(-1)!.day) - Date.parse(first!.day));
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(Date.parse(pts[i]!.day) - t) < Math.abs(Date.parse(pts[best]!.day) - t)) best = i;
    setHover(best);
  };

  return (
    <section aria-label="Simulated model performance" className="space-y-6">
      <div className="space-y-2">
        <h2 className="type-heading text-ink">Simulated model performance</h2>
        <p className="max-w-2xl text-sm text-ink-muted">{label}</p>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3">
        {TILES.map(([key, title, days]) => (
          <div key={key} className="space-y-1 bg-surface p-4">
            <dt className="text-xs text-ink-muted">{title} (net)</dt>
            <dd className={cn("type-figure text-2xl", metrics.net[key] && Number(metrics.net[key]) < 0 ? "text-danger" : "text-ink", (unavailable || metrics.net[key] === null) && "text-sm font-normal tracking-normal text-ink-faint")}>{tile(metrics.net[key], days)}</dd>
            {!unavailable && metrics.gross[key] !== null && <dd className="text-xs text-ink-faint">Gross {formatFraction(metrics.gross[key], true)}</dd>}
          </div>
        ))}
        <div className="space-y-1 bg-surface p-4">
          <dt className="text-xs text-ink-muted">Volatility (annualized)</dt>
          <dd className={cn("type-figure text-2xl text-ink", (unavailable || metrics.volatility === null) && "text-sm font-normal tracking-normal text-ink-faint")}>{tile(metrics.volatility, 30, false)}</dd>
        </div>
        <div className="space-y-1 bg-surface p-4">
          <dt className="text-xs text-ink-muted">Max drawdown</dt>
          <dd className={cn("type-figure text-2xl text-ink", (unavailable || metrics.maxDrawdown === null) && "text-sm font-normal tracking-normal text-ink-faint")}>{tile(metrics.maxDrawdown, 30, false)}</dd>
        </div>
      </dl>

      {unavailable ? <p className="text-sm text-ink">Performance unavailable</p> : pts.length < 2 ? <p className="text-sm text-ink-muted">The chart appears once there are two days of data.</p> : (
        <div className="space-y-4 rounded-card border border-line bg-surface p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
              <span><span aria-hidden className="mr-2 inline-block h-0.5 w-6 bg-accent align-middle" />Net (solid)</span>
              <span><span aria-hidden className="mr-2 inline-block w-6 border-t-2 border-dashed border-ink-faint align-middle" />Gross (dashed)</span>
            </p>
            <div role="group" aria-label="Chart range" className="inline-flex rounded-pill border border-line bg-surface-muted p-0.5">
              {RANGES.map((r) => (
                <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => { setRange(r.id); setHover(null); }}
                  className={cn("min-h-9 rounded-pill px-3.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink", range === r.id && "bg-surface text-ink shadow-soft")}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" className="h-auto w-full touch-pan-y text-ink-faint"
              aria-label={`Simulated index, base 100, from ${first!.day} to ${pts.at(-1)!.day}. Net moved from ${Number(first!.net).toFixed(2)} to ${Number(pts.at(-1)!.net).toFixed(2)}; gross from ${Number(first!.gross).toFixed(2)} to ${Number(pts.at(-1)!.gross).toFixed(2)}. A data table follows.`}>
              <defs>
                <linearGradient id="net-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.16" />
                  <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {ticks.map((t, k) => (
                <g key={k}>
                  <line x1={L} x2={W - R} y1={y(String(t))} y2={y(String(t))} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="2 4" />
                  <text x={L - 8} y={y(String(t))} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor" className="font-mono">{t.toFixed(1)}</text>
                </g>
              ))}
              <text x={L} y={H - 6} fontSize={11} fill="currentColor" className="font-mono">{first!.day}</text>
              <text x={W - R} y={H - 6} textAnchor="end" fontSize={11} fill="currentColor" className="font-mono">{pts.at(-1)!.day}</text>
              <polygon aria-hidden fill="url(#net-fill)" points={`${L},${H - B} ${pts.map((p) => `${x(p.day).toFixed(1)},${y(p.net).toFixed(1)}`).join(" ")} ${W - R},${H - B}`} />
              <path d={line("gross")} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="5 4" />
              <path d={line("net")} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" />
              {h && (
                <g aria-hidden>
                  <line x1={x(h.day)} x2={x(h.day)} y1={T} y2={H - B} stroke="var(--c-ink-faint)" strokeOpacity={0.6} />
                  <circle cx={x(h.day)} cy={y(h.gross)} r={3.5} fill="var(--c-surface)" stroke="var(--c-ink-faint)" strokeWidth={1.5} />
                  <circle cx={x(h.day)} cy={y(h.net)} r={4.5} fill="var(--c-surface)" stroke="var(--c-accent)" strokeWidth={2} />
                </g>
              )}
              <rect aria-hidden x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
            </svg>
            {h && (
              <div aria-hidden className="glass pointer-events-none absolute top-2 rounded-tile px-3 py-2 text-xs shadow-float"
                style={{ left: `clamp(0px, calc(${(x(h.day) / W) * 100}% - 70px), calc(100% - 140px))` }}>
                <p className="font-mono text-ink-faint">{h.day}</p>
                <p className="mt-1 flex justify-between gap-4 text-ink"><span>Net</span><span className="font-mono">{Number(h.net).toFixed(2)}</span></p>
                <p className="flex justify-between gap-4 text-ink-muted"><span>Gross</span><span className="font-mono">{Number(h.gross).toFixed(2)}</span></p>
              </div>
            )}
          </div>
          <p className="text-xs text-ink-muted">Index of the simulated model portfolio from its start value. Not your returns.</p>
          <details className="text-sm text-ink">
            <summary className="flex min-h-11 cursor-pointer items-center text-ink-muted hover:text-ink">View data table</summary>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Simulated index values by day</caption>
                <thead className="text-xs text-ink-muted"><tr><th scope="col" className="py-2 pr-4 font-medium">Day</th><th scope="col" className="pr-4 font-medium">Net</th><th scope="col" className="font-medium">Gross</th></tr></thead>
                <tbody className="font-mono text-xs">{pts.map((p) => <tr key={p.day} className="border-t border-line"><th scope="row" className="py-2 pr-4 font-normal">{p.day}</th><td className="pr-4">{Number(p.net).toFixed(2)}</td><td>{Number(p.gross).toFixed(2)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

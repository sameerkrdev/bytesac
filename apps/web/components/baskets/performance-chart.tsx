"use client";

import { formatFraction } from "@repo/app-core";
import type { PublicBasketDetail } from "@repo/validator";
import { useState } from "react";
import { Button } from "@/components/ui/button";

const RANGES = [{ id: "30d", label: "30 d", days: 30 }, { id: "90d", label: "90 d", days: 90 }, { id: "1y", label: "1 y", days: 365 }, { id: "all", label: "All", days: Infinity }] as const;
const DAY = 86_400_000;
const W = 600, H = 240, L = 56, R = 12, T = 12, B = 28;

const TILES = [["sinceLaunch", "Since launch", 1], ["d30", "30 days", 30], ["d90", "90 days", 90], ["y1", "1 year", 365]] as const;

type Props = { performance: PublicBasketDetail["performance"]; metrics: PublicBasketDetail["metrics"]; label: string };

export function PerformanceChart({ performance, metrics, label }: Props) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
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
  const pad = (hi - lo || 1) * 0.1;
  const x = (day: string) => L + ((Date.parse(day) - Date.parse(first!.day)) / ((Date.parse(pts.at(-1)!.day) - Date.parse(first!.day)) || 1)) * (W - L - R);
  const y = (v: string) => T + (1 - (Number(v) - (lo - pad)) / (hi - lo + 2 * pad)) * (H - T - B);
  const line = (key: "net" | "gross") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];

  return (
    <section aria-label="Simulated model performance" className="space-y-4">
      <h2 className="font-display text-xl font-semibold text-ivory">Simulated model performance</h2>
      <p className="text-sm text-stone">{label}</p>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {TILES.map(([key, title, days]) => (
          <div key={key} className="rounded-xl border border-border-dark bg-slate p-3">
            <dt className="text-xs text-stone">{title} (net)</dt>
            <dd className="text-lg font-semibold text-ivory">{tile(metrics.net[key], days)}</dd>
            {!unavailable && metrics.gross[key] !== null && <dd className="text-xs text-stone">Gross {formatFraction(metrics.gross[key], true)}</dd>}
          </div>
        ))}
        <div className="rounded-xl border border-border-dark bg-slate p-3">
          <dt className="text-xs text-stone">Volatility (annualized)</dt>
          <dd className="text-lg font-semibold text-ivory">{tile(metrics.volatility, 30, false)}</dd>
        </div>
        <div className="rounded-xl border border-border-dark bg-slate p-3">
          <dt className="text-xs text-stone">Max drawdown</dt>
          <dd className="text-lg font-semibold text-ivory">{tile(metrics.maxDrawdown, 30, false)}</dd>
        </div>
      </dl>

      {unavailable ? <p className="text-sm text-ivory">Performance unavailable</p> : pts.length < 2 ? <p className="text-sm text-stone">The chart appears once there are two days of data.</p> : (
        <div className="space-y-3">
          <div role="group" aria-label="Chart range" className="flex flex-wrap gap-2">
            {RANGES.map((r) => <Button key={r.id} type="button" variant={range === r.id ? "default" : "secondary"} className="min-h-11" aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</Button>)}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" className="h-auto w-full text-stone"
            aria-label={`Simulated index, base 100, from ${first!.day} to ${pts.at(-1)!.day}. Net moved from ${Number(first!.net).toFixed(2)} to ${Number(pts.at(-1)!.net).toFixed(2)}; gross from ${Number(first!.gross).toFixed(2)} to ${Number(pts.at(-1)!.gross).toFixed(2)}. A data table follows.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(String(t))} y2={y(String(t))} stroke="currentColor" strokeOpacity={0.25} />
                <text x={L - 6} y={y(String(t))} textAnchor="end" dominantBaseline="middle" fontSize={11} fill="currentColor">{t.toFixed(1)}</text>
              </g>
            ))}
            <text x={L} y={H - 8} fontSize={11} fill="currentColor">{first!.day}</text>
            <text x={W - R} y={H - 8} textAnchor="end" fontSize={11} fill="currentColor">{pts.at(-1)!.day}</text>
            <path d={line("gross")} fill="none" stroke="currentColor" strokeWidth={2} strokeDasharray="6 4" />
            <path d={line("net")} fill="none" className="stroke-mint" strokeWidth={2.5} />
          </svg>
          <p className="flex flex-wrap gap-x-6 text-xs text-stone">
            <span><span aria-hidden className="mr-2 inline-block h-0.5 w-6 bg-mint align-middle" />Net (solid)</span>
            <span><span aria-hidden className="mr-2 inline-block w-6 border-t-2 border-dashed border-stone align-middle" />Gross (dashed)</span>
          </p>
          <details className="text-sm text-ivory">
            <summary className="flex min-h-11 cursor-pointer items-center">View data table</summary>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Simulated index values by day</caption>
                <thead className="text-xs text-stone"><tr><th scope="col" className="py-2 pr-4 font-medium">Day</th><th scope="col" className="pr-4 font-medium">Net</th><th scope="col" className="font-medium">Gross</th></tr></thead>
                <tbody>{pts.map((p) => <tr key={p.day} className="border-t border-border-dark"><th scope="row" className="py-2 pr-4 font-normal">{p.day}</th><td className="pr-4">{Number(p.net).toFixed(2)}</td><td>{Number(p.gross).toFixed(2)}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

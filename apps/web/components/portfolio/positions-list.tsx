"use client";

import { formatBps, formatUnits } from "@repo/app-core";
import { ASSET_CHAINS, type Portfolio } from "@repo/validator";
import Link from "next/link";
import { LeaveDialog, SellDialog } from "@/components/portfolio/exit-dialogs";
import { StatusBadge } from "@/components/status-badge";

type Position = Portfolio["positions"][number];

const Bar = ({ label, bps, tone }: { label: string; bps: number | null; tone: string }) => (
  <div className="flex items-center gap-2 text-xs text-stone">
    <span className="w-14">{label}</span>
    <div aria-hidden className="h-2 flex-1 rounded bg-border-dark"><div className={`h-2 rounded ${tone}`} style={{ width: `${Math.min((bps ?? 0) / 100, 100)}%` }} /></div>
    <span className="w-14 text-right text-ivory">{bps === null ? "n/a" : formatBps(bps)}</span>
  </div>
);

/** Open positions (value, actual against target weights, reconciliation notices, exit actions) or former ones (sell what is left). */
export function PositionsList({ positions, former }: { positions: Position[]; former?: boolean }) {
  return (
    <ul className="space-y-4">
      {positions.map((p) => {
        const values = p.holdings.map((h) => h.valueUsd);
        const total = values.length > 0 && values.every((v) => v !== null) ? values.reduce((s, v) => s + Number(v), 0).toFixed(2) : null;
        const short = p.holdings.filter((h) => h.reconciliation === "SHORT");
        const surplus = p.holdings.filter((h) => h.reconciliation === "SURPLUS");
        return (
          <li key={p.id} className="space-y-4 rounded-2xl border border-border-dark bg-slate p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Link href={`/baskets/${p.basketSlug}`} className="font-display text-xl font-semibold text-mint underline">{p.basketSlug}</Link>
                <p className="text-sm text-stone">{former ? `Left ${new Date(p.closedAt ?? p.openedAt).toLocaleDateString()} · assets are in your wallets, outside the basket` : `Opened ${new Date(p.openedAt).toLocaleDateString()}`}</p>
              </div>
              <p className="text-lg text-ivory">{total === null ? "Value unavailable" : `$${total}`}</p>
            </div>
            {short.length > 0 && <p role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm text-ivory">Your wallet holds less {short.map((h) => h.symbol).join(", ")} than Bytesac recorded for this basket, so part of it may have been moved. Shortfalls are shared across your baskets in proportion. Nothing is bought or sold automatically.</p>}
            {surplus.length > 0 && <p role="status" className="rounded-xl border border-border-dark p-3 text-sm text-stone">Extra {surplus.map((h) => h.symbol).join(", ")} in your wallet is outside your baskets.</p>}
            <ul className="divide-y divide-border-dark">
              {p.holdings.map((h) => (
                <li key={h.deploymentId} className="space-y-2 py-3 text-sm">
                  <p className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ivory">{h.symbol} <span className="text-stone">on {ASSET_CHAINS[h.chain].label}</span></span>
                    <span className="text-ivory">{formatUnits(h.quantity, h.decimals)} {h.symbol}{h.valueUsd !== null && <span className="text-stone"> · ${h.valueUsd}</span>}</span>
                  </p>
                  {!former && <><Bar label="Actual" bps={h.actualBps} tone="bg-mint" /><Bar label="Target" bps={h.targetBps} tone="bg-stone" /></>}
                  {h.reconciliation === "SHORT" && <StatusBadge tone="warning" label="Wallet holds less than recorded" />}
                  {h.reconciliation === "SURPLUS" && <StatusBadge tone="neutral" label="Extra outside baskets" />}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-3">
              {!former && <LeaveDialog position={p} />}
              <SellDialog position={p} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

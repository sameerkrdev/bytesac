"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSET_TYPE_LABEL, formatBps } from "@repo/app-core";
import type { BasketAssetView } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "listAssets">;

/** A percentage field that stores whole basis points. More than two decimals is refused, never rounded. */
export function PercentInput({ id, label, value, onChange, disabled, optional }: {
  id: string; label: string; value: number | null; onChange(bps: number | null): void; disabled?: boolean; optional?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : String(value / 100));
  const [error, setError] = useState<string | null>(null);
  function change(next: string) {
    setText(next);
    if (next.trim() === "") { setError(null); return onChange(optional ? null : 0); }
    const n = Number(next);
    const bps = Math.round(n * 100);
    if (!Number.isFinite(n) || n < 0) return setError("Enter a percentage.");
    if (Math.abs(bps - n * 100) > 1e-6) return setError("Use at most two decimals.");
    setError(null);
    onChange(bps);
  }
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-ivory">{label}</Label>
      <div className="flex items-center gap-2">
        <Input id={id} inputMode="decimal" value={text} disabled={disabled} aria-invalid={Boolean(error)} className="min-h-11 w-28 bg-space text-ivory" onChange={(e) => change(e.target.value)} />
        <span className="text-xs text-stone">%{value !== null && ` · ${value} bps`}</span>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Registry search plus the weight table. Weights are entered by hand; nothing is ever normalized for the manager. */
export function AllocationEditor({ assets, onChange, readOnly, client = api }: { assets: BasketAssetView[]; onChange(a: BasketAssetView[]): void; readOnly: boolean; client?: Client }) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const results = useQuery({ queryKey: ["assets", "search", q], queryFn: () => client.listAssets({ q }), enabled: q.length > 0 && !readOnly, retry: false });

  const total = assets.reduce((s, a) => s + a.targetWeightBps, 0);
  const largest = Math.max(0, ...assets.map((a) => a.targetWeightBps));
  const patch = (id: string, p: Partial<BasketAssetView>) => onChange(assets.map((a) => (a.instrumentId === id ? { ...a, ...p } : a)));

  return (
    <div className="space-y-6">
      {!readOnly && (
        <div className="space-y-2">
          <Label htmlFor="asset-search" className="text-xs font-medium text-ivory">Search the asset registry</Label>
          <Input id="asset-search" type="search" placeholder="Name or symbol" value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-11 max-w-md bg-space text-ivory placeholder:text-stone" />
          {results.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(results.error).title}</p>}
          {results.data && (results.data.items.length === 0 ? <p className="text-sm text-stone">No matching assets.</p> : (
            <ul aria-label="Search results" className="divide-y divide-border-dark">
              {results.data.items.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="text-sm text-ivory">{r.name} <span className="text-stone">{r.symbol}</span></span>
                  <span className="text-xs text-stone">{ASSET_TYPE_LABEL[r.assetType]}</span>
                  <Button variant="secondary" className="ml-auto min-h-11" aria-label={`Add ${r.name}`} disabled={assets.some((a) => a.instrumentId === r.id)}
                    onClick={() => onChange([...assets, { instrumentId: r.id, name: r.name, symbol: r.symbol, assetType: r.assetType, instrumentStatus: "ACTIVE", hasActiveDeployment: true, targetWeightBps: 0, minWeightBps: null, maxWeightBps: null, rationale: null }])}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}

      <dl aria-label="Allocation summary" className="grid grid-cols-2 gap-3 rounded-xl border border-border-dark p-4 sm:grid-cols-4">
        <div><dt className="text-xs text-stone">Total</dt><dd className="text-sm font-medium text-ivory">{formatBps(total)}</dd></div>
        <div><dt className="text-xs text-stone">Remaining</dt><dd className="text-sm font-medium text-ivory">{formatBps(10_000 - total)}</dd></div>
        <div><dt className="text-xs text-stone">Assets</dt><dd className="text-sm font-medium text-ivory">{assets.length}</dd></div>
        <div><dt className="text-xs text-stone">Largest</dt><dd className="text-sm font-medium text-ivory">{formatBps(largest)}</dd></div>
      </dl>

      {assets.length === 0 ? <p className="text-sm text-stone">No assets yet. Search the registry to add some.</p> : (
        <ul className="space-y-4">
          {assets.map((a) => (
            <li key={a.instrumentId} className="space-y-3 rounded-xl border border-border-dark p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-ivory">{a.name} <span className="text-stone">{a.symbol}</span></span>
                <span className="text-xs text-stone">{ASSET_TYPE_LABEL[a.assetType]}</span>
                {!readOnly && <Button variant="secondary" className="ml-auto min-h-11" aria-label={`Remove ${a.name}`} onClick={() => onChange(assets.filter((x) => x.instrumentId !== a.instrumentId))}>Remove</Button>}
              </div>
              <div className="flex flex-wrap gap-4">
                <PercentInput id={`w-${a.instrumentId}`} label={`Weight of ${a.symbol}`} value={a.targetWeightBps} disabled={readOnly} onChange={(v) => patch(a.instrumentId, { targetWeightBps: v ?? 0 })} />
                <PercentInput id={`min-${a.instrumentId}`} label={`Lowest for ${a.symbol} (optional)`} optional value={a.minWeightBps} disabled={readOnly} onChange={(v) => patch(a.instrumentId, { minWeightBps: v })} />
                <PercentInput id={`max-${a.instrumentId}`} label={`Highest for ${a.symbol} (optional)`} optional value={a.maxWeightBps} disabled={readOnly} onChange={(v) => patch(a.instrumentId, { maxWeightBps: v })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`r-${a.instrumentId}`} className="text-xs font-medium text-ivory">Why {a.symbol}? (optional)</Label>
                <Input id={`r-${a.instrumentId}`} value={a.rationale ?? ""} maxLength={500} disabled={readOnly} className="min-h-11 bg-space text-ivory" onChange={(e) => patch(a.instrumentId, { rationale: e.target.value })} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import type { ApiClient } from "@repo/api-client";
import { RWA_ASSET_TYPES, navEntryRequestSchema, putPriceReferenceRequestSchema, type PriceView } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { AssetError, type SectionProps } from "./asset-ui";

type Client = Pick<ApiClient, "opsPutPriceReference" | "opsRecordNav">;

function Price({ p }: { p: PriceView | undefined }) {
  if (!p || p.status === "unavailable") return <p className="text-sm text-stone">Price unavailable</p>;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-ivory">
      {p.value} {p.currency}
      {p.stale && <span className="rounded bg-warning/20 px-1.5 py-0.5 text-xs font-medium text-warning">Stale</span>}
      {p.observedAt && <span className="text-xs text-stone">as of {new Date(p.observedAt).toLocaleString()}</span>}
    </p>
  );
}

export function AssetPricing({ a, locked, onChange, client = api }: SectionProps & { client?: Client }) {
  const id = useId();
  const market = a.priceReferences.find((r) => r.kind === "market" && r.status === "ACTIVE");
  const navRef = a.priceReferences.find((r) => r.kind === "nav" && r.status === "ACTIVE");
  const [cmcId, setCmcId] = useState(market?.externalId ?? "");
  const [nav, setNav] = useState({ value: "", asOf: "", sourceUrl: "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  const putMarket = useMutation({ mutationFn: (externalId: string) => client.opsPutPriceReference(a.id, "market", { externalId }), onSuccess: onChange });
  const putNav = useMutation({ mutationFn: () => client.opsPutPriceReference(a.id, "nav", {}), onSuccess: onChange });
  const record = useMutation({ mutationFn: (b: Parameters<Client["opsRecordNav"]>[1]) => client.opsRecordNav(a.id, b), onSuccess: (d) => { setNav({ value: "", asOf: "", sourceUrl: "" }); onChange(d); } });
  const error = [putMarket, putNav, record].find((m) => m.isError)?.error;
  const isRwa = RWA_ASSET_TYPES.includes(a.assetType);

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-6">
      <h2 id={`${id}-h`} className="font-display text-xl font-semibold text-ivory">Pricing</h2>
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-ivory">Market price (CoinMarketCap)</h3>
        <Price p={a.prices.find((p) => p.kind === "market")} />
        {!locked && (
          <form noValidate className="flex max-w-md flex-wrap items-end gap-3" onSubmit={(e) => {
            e.preventDefault();
            const parsed = putPriceReferenceRequestSchema.safeParse({ externalId: cmcId.trim() });
            if (!parsed.success || !parsed.data.externalId) return setInvalid("Enter the numeric CoinMarketCap id.");
            setInvalid(null);
            putMarket.mutate(parsed.data.externalId);
          }}>
            <div className="min-w-40 flex-1 space-y-2">
              <Label htmlFor={`${id}-cmc`} className="text-xs font-medium text-ivory">CoinMarketCap id</Label>
              <Input id={`${id}-cmc`} inputMode="numeric" className="min-h-11 bg-space text-ivory" value={cmcId} onChange={(e) => setCmcId(e.target.value)} />
            </div>
            <Button type="submit" variant="secondary" className="min-h-11" disabled={putMarket.isPending}>{putMarket.isPending && <Loader2 aria-hidden className="animate-spin" />}Save reference</Button>
          </form>
        )}
        {invalid && <p role="alert" className="text-sm text-danger">{invalid}</p>}
      </div>

      {isRwa && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-ivory">Net asset value (entered by ops)</h3>
          <Price p={a.prices.find((p) => p.kind === "nav")} />
          {!navRef ? (
            !locked && <Button type="button" variant="secondary" className="min-h-11" disabled={putNav.isPending} onClick={() => putNav.mutate()}>Add NAV reference</Button>
          ) : !locked && (
            <form noValidate className="grid max-w-md gap-3" onSubmit={(e) => {
              e.preventDefault();
              const parsed = navEntryRequestSchema.safeParse({ value: nav.value.trim(), asOf: nav.asOf, sourceUrl: nav.sourceUrl.trim() });
              if (!parsed.success) return setInvalid("Enter the value as a plain number, the date, and an https source URL.");
              setInvalid(null);
              record.mutate(parsed.data);
            }}>
              <Label htmlFor={`${id}-nv`} className="text-xs font-medium text-ivory">NAV per token (USD)</Label>
              <Input id={`${id}-nv`} inputMode="decimal" className="min-h-11 bg-space text-ivory" value={nav.value} onChange={(e) => setNav({ ...nav, value: e.target.value })} />
              <Label htmlFor={`${id}-na`} className="text-xs font-medium text-ivory">As of</Label>
              <Input id={`${id}-na`} type="date" className="min-h-11 bg-space text-ivory" value={nav.asOf} onChange={(e) => setNav({ ...nav, asOf: e.target.value })} />
              <Label htmlFor={`${id}-ns`} className="text-xs font-medium text-ivory">Source URL</Label>
              <Input id={`${id}-ns`} type="url" className="min-h-11 bg-space text-ivory" value={nav.sourceUrl} onChange={(e) => setNav({ ...nav, sourceUrl: e.target.value })} />
              <Button type="submit" variant="secondary" className="min-h-11 w-fit" disabled={record.isPending}>{record.isPending && <Loader2 aria-hidden className="animate-spin" />}Record NAV</Button>
            </form>
          )}
          {a.navObservations.length > 0 && (
            <table className="w-full max-w-xl text-left text-sm">
              <caption className="sr-only">NAV history</caption>
              <thead className="text-xs text-stone"><tr><th className="py-2 pr-4 font-medium">As of</th><th className="pr-4 font-medium">Value</th><th className="font-medium">Source</th></tr></thead>
              <tbody>
                {a.navObservations.map((n) => (
                  <tr key={n.id} className="border-t border-border-dark">
                    <td className="py-2 pr-4 text-ivory">{n.asOf}</td><td className="pr-4 text-ivory">{n.value} {n.currency}</td>
                    <td><a href={n.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-mint underline">Source</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {error && <AssetError error={error} />}
    </section>
  );
}

"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSET_ITEM_STATUS_LABEL } from "@repo/app-core";
import { ASSET_CHAINS, assetProviderKindSchema, createRouteRequestSchema, executionMethodSchema, processingModelSchema } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { AssetError, ItemActions, type SectionProps } from "./asset-ui";

type Client = Pick<ApiClient, "opsCreateRoute" | "opsAssetItemAction" | "opsListAssetProviders" | "opsCreateAssetProvider" | "opsListAssets">;
const blank = { providerId: "", deploymentId: "", method: "swap", venue: "", settlementInstrumentId: "", minimumAmount: "", processingModel: "sync", notes: "" };

export function AssetRoutes({ a, locked, isAdmin, onChange, client = api }: SectionProps & { client?: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const [f, setF] = useState(blank);
  const [newProvider, setNewProvider] = useState<{ name: string; kind: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const providers = useQuery({ queryKey: ["ops", "asset-providers"], queryFn: () => client.opsListAssetProviders(), retry: false });
  // ponytail: first page only; add a search box if the registry outgrows one page.
  const instruments = useQuery({ queryKey: ["ops", "assets", "settlement-choices"], queryFn: () => client.opsListAssets({}), retry: false });
  const createProvider = useMutation({
    mutationFn: (b: Parameters<Client["opsCreateAssetProvider"]>[0]) => client.opsCreateAssetProvider(b),
    onSuccess: (p) => { setNewProvider(null); setF((s) => ({ ...s, providerId: p.id })); void qc.invalidateQueries({ queryKey: ["ops", "asset-providers"] }); },
  });
  const create = useMutation({ mutationFn: (b: Parameters<Client["opsCreateRoute"]>[1]) => client.opsCreateRoute(a.id, b), onSuccess: (d) => { setF(blank); onChange(d); } });
  const act = useMutation({ mutationFn: (v: { rid: string; action: Parameters<Client["opsAssetItemAction"]>[3] }) => client.opsAssetItemAction(a.id, "routes", v.rid, v.action), onSuccess: onChange });
  const error = [createProvider, create, act].find((m) => m.isError)?.error ?? providers.error ?? instruments.error;
  const live = a.deployments.filter((d) => d.status !== "RETIRED");
  const providerName = (pid: string) => providers.data?.find((p) => p.id === pid)?.name ?? "Provider";
  const settlement = (iid: string | null) => instruments.data?.items.find((i) => i.id === iid)?.symbol;

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="font-display text-xl font-semibold text-ivory">Execution routes</h2>
      {a.routes.length === 0 ? <p className="text-sm text-stone">No routes yet.</p> : (
        <ul className="divide-y divide-border-dark">
          {a.routes.map((r) => {
            const d = a.deployments.find((x) => x.id === r.deploymentId);
            return (
              <li key={r.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-ivory">{r.venue} · {r.method.replaceAll("_", " ")}</span>
                  <StatusBadge {...ASSET_ITEM_STATUS_LABEL[r.status]} />
                </div>
                <p className="text-xs text-stone">
                  {providerName(r.providerId)} · {d ? ASSET_CHAINS[d.chain].label : "Unknown chain"} · {r.processingModel}
                  {r.settlementInstrumentId && ` · settles in ${settlement(r.settlementInstrumentId) ?? "another asset"}`}{r.minimumAmount && ` · minimum ${r.minimumAmount}`}
                </p>
                {r.notes && <p className="whitespace-pre-wrap text-xs text-stone">{r.notes}</p>}
                {isAdmin && <div className="flex flex-wrap gap-2"><ItemActions status={r.status} disabled={locked} pending={act.isPending} onAct={(action) => act.mutate({ rid: r.id, action })} /></div>}
              </li>
            );
          })}
        </ul>
      )}

      {locked ? <p className="text-sm text-stone">Routes can&apos;t be changed while the asset is under review or retired.</p> : (
        <form noValidate className="grid max-w-xl gap-4" onSubmit={(e) => {
          e.preventDefault();
          const parsed = createRouteRequestSchema.safeParse({
            deploymentId: f.deploymentId, providerId: f.providerId, venue: f.venue, method: f.method, processingModel: f.processingModel,
            settlementInstrumentId: f.settlementInstrumentId || undefined, minimumAmount: f.minimumAmount.trim() || undefined, notes: f.notes.trim() || undefined,
          });
          if (!parsed.success) return setInvalid("Choose a provider and a deployment, name the venue, and enter the minimum as a plain number.");
          setInvalid(null);
          create.mutate(parsed.data);
        }}>
          <h3 className="text-sm font-medium text-ivory">Add a route</h3>
          <div className="space-y-2">
            <Label htmlFor={`${id}-prov`} className="text-xs font-medium text-ivory">Provider</Label>
            <Select id={`${id}-prov`} value={f.providerId} onChange={set("providerId")}>
              <option value="">Select a provider</option>
              {providers.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            {!newProvider && <Button type="button" variant="secondary" className="min-h-11" onClick={() => setNewProvider({ name: "", kind: "dex_aggregator" })}>New provider</Button>}
          </div>
          {newProvider && (
            <div className="grid gap-3 rounded-xl border border-border-dark p-3">
              <Label htmlFor={`${id}-pn`} className="text-xs font-medium text-ivory">Provider name</Label>
              <Input id={`${id}-pn`} className="min-h-11 bg-space text-ivory" value={newProvider.name} onChange={(e) => setNewProvider({ ...newProvider, name: e.target.value })} />
              <Label htmlFor={`${id}-pk`} className="text-xs font-medium text-ivory">Provider kind</Label>
              <Select id={`${id}-pk`} value={newProvider.kind} onChange={(e) => setNewProvider({ ...newProvider, kind: e.target.value })}>
                {assetProviderKindSchema.options.map((k) => <option key={k} value={k}>{k.replaceAll("_", " ")}</option>)}
              </Select>
              <div className="flex gap-2">
                <Button type="button" className="min-h-11" disabled={createProvider.isPending || newProvider.name.trim().length < 2}
                  onClick={() => createProvider.mutate({ name: newProvider.name.trim(), kind: assetProviderKindSchema.parse(newProvider.kind) })}>Create provider</Button>
                <Button type="button" variant="secondary" className="min-h-11" onClick={() => setNewProvider(null)}>Cancel</Button>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-dep`} className="text-xs font-medium text-ivory">Deployment</Label>
            <Select id={`${id}-dep`} value={f.deploymentId} onChange={set("deploymentId")}>
              <option value="">Select a deployment</option>
              {live.map((d) => <option key={d.id} value={d.id}>{ASSET_CHAINS[d.chain].label} · {d.address ?? "native"}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-method`} className="text-xs font-medium text-ivory">Method</Label>
            <Select id={`${id}-method`} value={f.method} onChange={set("method")}>
              {executionMethodSchema.options.map((m) => <option key={m} value={m}>{m.replaceAll("_", " ")}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-venue`} className="text-xs font-medium text-ivory">Venue</Label>
            <Input id={`${id}-venue`} className="min-h-11 bg-space text-ivory" value={f.venue} onChange={set("venue")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-settle`} className="text-xs font-medium text-ivory">Settlement asset</Label>
            <Select id={`${id}-settle`} value={f.settlementInstrumentId} onChange={set("settlementInstrumentId")}>
              <option value="">None</option>
              {instruments.data?.items.map((i) => <option key={i.id} value={i.id}>{i.symbol} · {i.name}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-min`} className="text-xs font-medium text-ivory">Minimum amount (optional)</Label>
            <Input id={`${id}-min`} inputMode="decimal" className="min-h-11 bg-space text-ivory" value={f.minimumAmount} onChange={set("minimumAmount")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-pm`} className="text-xs font-medium text-ivory">Processing model</Label>
            <Select id={`${id}-pm`} value={f.processingModel} onChange={set("processingModel")}>
              {processingModelSchema.options.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-notes`} className="text-xs font-medium text-ivory">Notes (optional)</Label>
            <Textarea id={`${id}-notes`} value={f.notes} maxLength={2000} onChange={set("notes")} />
          </div>
          {invalid && <p role="alert" className="text-sm text-danger">{invalid}</p>}
          <Button type="submit" className="min-h-11 w-fit" disabled={create.isPending}>{create.isPending && <Loader2 aria-hidden className="animate-spin" />}Add route</Button>
        </form>
      )}
      {error && <AssetError error={error} />}
    </section>
  );
}

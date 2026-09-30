"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSET_ITEM_STATUS_LABEL } from "@repo/app-core";
import { ASSET_CHAINS, assetChainSchema, createDeploymentRequestSchema, tokenStandardSchema, updateDeploymentRequestSchema, type AssetChain, type OpsAssetDetail, type TokenStandard } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, XCircle } from "lucide-react";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { AssetError, ItemActions, type SectionProps } from "./asset-ui";

type Client = Pick<ApiClient, "opsCreateDeployment" | "opsUpdateDeployment" | "opsVerifyDeployment" | "opsAssetItemAction">;
type Deployment = OpsAssetDetail["deployments"][number];

function verificationOf(d: Deployment) {
  if (d.verification === "manual") return { icon: CircleHelp, text: "Manual — check source", cls: "text-warning" };
  if (!d.observedAt) return { icon: CircleHelp, text: "Not verified yet", cls: "text-stone" };
  if (d.observedDecimals === null) return { icon: XCircle, text: "Not a token", cls: "text-danger" };
  if (d.observedDecimals !== d.decimals) return { icon: AlertTriangle, text: "Decimals differ from chain", cls: "text-danger" };
  return { icon: CheckCircle2, text: "Matches chain", cls: "text-success" };
}

/** Inline correction of a DRAFT deployment: address, decimals and source URL (chain and standard are retire-and-re-add). */
function EditDeployment({ d, pending, onSave, onCancel }: { d: Deployment; pending: boolean; onSave(b: Parameters<Client["opsUpdateDeployment"]>[2]): void; onCancel(): void }) {
  const id = useId();
  const [f, setF] = useState({ address: d.address ?? "", decimals: String(d.decimals), sourceUrl: d.sourceUrl ?? "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  return (
    <form noValidate className="grid max-w-xl gap-3 rounded-xl border border-border-dark p-3" onSubmit={(e) => {
      e.preventDefault();
      const parsed = updateDeploymentRequestSchema.safeParse({ ...(d.address ? { address: f.address.trim() } : {}), decimals: f.decimals === "" ? Number.NaN : Number(f.decimals), sourceUrl: f.sourceUrl.trim() || null });
      if (!parsed.success) return setInvalid(parsed.error.issues[0]?.message ?? "Check the deployment details.");
      setInvalid(null);
      onSave(parsed.data);
    }}>
      {d.address && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-addr`} className="text-xs font-medium text-ivory">Address</Label>
          <Input id={`${id}-addr`} className="min-h-11 bg-space font-mono text-ivory" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${id}-dec`} className="text-xs font-medium text-ivory">Decimals</Label>
        <Input id={`${id}-dec`} type="number" inputMode="numeric" min={0} max={36} className="min-h-11 bg-space text-ivory" value={f.decimals} onChange={(e) => setF({ ...f, decimals: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-src`} className="text-xs font-medium text-ivory">Source URL</Label>
        <Input id={`${id}-src`} type="url" className="min-h-11 bg-space text-ivory" value={f.sourceUrl} onChange={(e) => setF({ ...f, sourceUrl: e.target.value })} />
      </div>
      {invalid && <p role="alert" className="text-sm text-danger">{invalid}</p>}
      <div className="flex gap-2">
        <Button type="submit" className="min-h-11" disabled={pending}>Save deployment</Button>
        <Button type="button" variant="secondary" className="min-h-11" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function AssetDeployments({ a, locked, isAdmin, onChange, client = api }: SectionProps & { client?: Client }) {
  const id = useId();
  const [chain, setChain] = useState<AssetChain>("ethereum");
  const [tokenStandard, setStandard] = useState<TokenStandard>("erc20");
  const [address, setAddress] = useState("");
  const [decimals, setDecimals] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (b: Parameters<Client["opsCreateDeployment"]>[1]) => client.opsCreateDeployment(a.id, b),
    onSuccess: (d) => { setAddress(""); setDecimals(""); setSourceUrl(""); onChange(d); },
  });
  const [editing, setEditing] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: (v: { did: string; body: Parameters<Client["opsUpdateDeployment"]>[2] }) => client.opsUpdateDeployment(a.id, v.did, v.body),
    onSuccess: (d) => { setEditing(null); onChange(d); },
  });
  const verify = useMutation({ mutationFn: (did: string) => client.opsVerifyDeployment(a.id, did), onSuccess: onChange });
  const act = useMutation({ mutationFn: (v: { did: string; action: Parameters<Client["opsAssetItemAction"]>[3] }) => client.opsAssetItemAction(a.id, "deployments", v.did, v.action), onSuccess: onChange });
  const native = tokenStandard === "native";
  const needsSource = ASSET_CHAINS[chain].verification === "manual" || native;
  const error = [create, update, verify, act].find((m) => m.isError)?.error;

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="font-display text-xl font-semibold text-ivory">Deployments</h2>
      {a.deployments.length === 0 ? <p className="text-sm text-stone">No deployments yet.</p> : (
        <ul className="divide-y divide-border-dark">
          {a.deployments.map((d) => {
            const v = verificationOf(d);
            return (
              <li key={d.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium text-ivory">{ASSET_CHAINS[d.chain].label} · {d.tokenStandard}</span>
                  <StatusBadge {...ASSET_ITEM_STATUS_LABEL[d.status]} />
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${v.cls}`}><v.icon aria-hidden className="size-3.5" />{v.text}</span>
                </div>
                {d.address && <p className="break-all font-mono text-xs text-stone">{d.address}</p>}
                <p className="text-xs text-stone">
                  Decimals entered {d.decimals}, on chain {d.observedDecimals ?? "—"}
                  {d.observedSymbol && ` · ${d.observedSymbol}`}{d.observedName && ` · ${d.observedName}`}
                  {d.sourceUrl && <> · <a href={d.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-mint underline">Source</a></>}
                </p>
                <div className="flex flex-wrap gap-2">
                  {d.status === "DRAFT" && d.verification === "onchain" && (
                    <Button type="button" variant="secondary" className="min-h-11" disabled={locked || verify.isPending} onClick={() => verify.mutate(d.id)}>
                      {verify.isPending && verify.variables === d.id && <Loader2 aria-hidden className="animate-spin" />}Re-verify
                    </Button>
                  )}
                  {d.status === "DRAFT" && !locked && <Button type="button" variant="secondary" className="min-h-11" onClick={() => setEditing(d.id)}>Edit</Button>}
                  {isAdmin && <ItemActions status={d.status} disabled={locked} pending={act.isPending} onAct={(action) => act.mutate({ did: d.id, action })} />}
                </div>
                {editing === d.id && !locked && <EditDeployment d={d} pending={update.isPending} onSave={(body) => update.mutate({ did: d.id, body })} onCancel={() => setEditing(null)} />}
              </li>
            );
          })}
        </ul>
      )}

      {locked ? <p className="text-sm text-stone">Deployments can&apos;t be changed while the asset is under review or retired.</p> : (
        <form noValidate className="grid max-w-xl gap-4" onSubmit={(e) => {
          e.preventDefault();
          const parsed = createDeploymentRequestSchema.safeParse({
            chain, tokenStandard, address: native ? undefined : address.trim(), decimals: decimals === "" ? Number.NaN : Number(decimals), sourceUrl: sourceUrl.trim() || undefined,
          });
          if (!parsed.success) return setInvalid(parsed.error.issues[0]?.message ?? "Check the deployment details.");
          if (needsSource && !parsed.data.sourceUrl) return setInvalid("Add a source URL: this deployment can't be checked on chain.");
          setInvalid(null);
          create.mutate(parsed.data);
        }}>
          <h3 className="text-sm font-medium text-ivory">Add a deployment</h3>
          <div className="space-y-2">
            <Label htmlFor={`${id}-chain`} className="text-xs font-medium text-ivory">Chain</Label>
            <Select id={`${id}-chain`} value={chain} onChange={(e) => setChain(assetChainSchema.parse(e.target.value))}>
              {assetChainSchema.options.map((c) => <option key={c} value={c}>{ASSET_CHAINS[c].label}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-std`} className="text-xs font-medium text-ivory">Standard</Label>
            <Select id={`${id}-std`} value={tokenStandard} onChange={(e) => setStandard(tokenStandardSchema.parse(e.target.value))}>
              {tokenStandardSchema.options.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
          {!native && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-addr`} className="text-xs font-medium text-ivory">Address</Label>
              <Input id={`${id}-addr`} className="min-h-11 bg-space font-mono text-ivory" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${id}-dec`} className="text-xs font-medium text-ivory">Decimals</Label>
            <Input id={`${id}-dec`} type="number" inputMode="numeric" min={0} max={36} className="min-h-11 bg-space text-ivory" value={decimals} onChange={(e) => setDecimals(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-src`} className="text-xs font-medium text-ivory">{needsSource ? "Source URL (required: this can't be checked on chain)" : "Source URL (optional)"}</Label>
            <Input id={`${id}-src`} type="url" className="min-h-11 bg-space text-ivory" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </div>
          {invalid && <p role="alert" className="text-sm text-danger">{invalid}</p>}
          <Button type="submit" className="min-h-11 w-fit" disabled={create.isPending}>{create.isPending && <Loader2 aria-hidden className="animate-spin" />}Add deployment</Button>
        </form>
      )}
      {error && <AssetError error={error} />}
    </section>
  );
}

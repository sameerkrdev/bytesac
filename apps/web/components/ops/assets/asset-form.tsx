"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSET_TYPE_LABEL } from "@repo/app-core";
import { assetTypeSchema, createInstrumentRequestSchema, type AssetType, type CreateInstrumentRequest, type OpsAssetDetail } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { AssetError } from "./asset-ui";

type IssuerClient = Pick<ApiClient, "opsListAssetIssuers" | "opsCreateAssetIssuer">;

function IssuerSelect({ value, onChange, disabled, client }: { value: string; onChange(id: string): void; disabled?: boolean; client: IssuerClient }) {
  const id = useId();
  const qc = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const issuers = useQuery({ queryKey: ["ops", "asset-issuers"], queryFn: () => client.opsListAssetIssuers(), retry: false });
  const create = useMutation({
    mutationFn: (n: string) => client.opsCreateAssetIssuer({ name: n }),
    onSuccess: (i) => { setName(null); onChange(i.id); void qc.invalidateQueries({ queryKey: ["ops", "asset-issuers"] }); },
  });
  return (
    <div className="space-y-2">
      <Label htmlFor={`${id}-i`} className="text-xs font-medium text-ivory">Issuer</Label>
      <Select id={`${id}-i`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">No issuer</option>
        {issuers.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </Select>
      {name === null ? (
        <Button type="button" variant="secondary" className="min-h-11" disabled={disabled} onClick={() => setName("")}>New issuer</Button>
      ) : (
        <div className="space-y-2 rounded-xl border border-border-dark p-3">
          <Label htmlFor={`${id}-n`} className="text-xs font-medium text-ivory">Issuer name</Label>
          <Input id={`${id}-n`} className="min-h-11 bg-space text-ivory" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button" className="min-h-11" disabled={create.isPending || name.trim().length < 2} onClick={() => create.mutate(name.trim())}>Create issuer</Button>
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setName(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {(issuers.isError || create.isError) && <AssetError error={issuers.error ?? create.error} />}
    </div>
  );
}

const fieldCls = "min-h-11 bg-space text-ivory";

/** The create page. Submits, then opens the editor. */
export function CreateAssetForm({ client = api }: { client?: IssuerClient & Pick<ApiClient, "opsCreateAsset"> }) {
  const id = useId();
  const router = useRouter();
  const [f, setF] = useState({ name: "", symbol: "", assetType: "CRYPTO" as AssetType, issuerId: "", description: "" });
  const [invalid, setInvalid] = useState<string | null>(null);
  const create = useMutation({ mutationFn: (b: CreateInstrumentRequest) => client.opsCreateAsset(b), onSuccess: (d) => router.push(`/ops/assets/${d.id}`) });

  return (
    <form noValidate className="grid max-w-xl gap-4" onSubmit={(e) => {
      e.preventDefault();
      const parsed = createInstrumentRequestSchema.safeParse({ ...f, issuerId: f.issuerId || null, description: f.description.trim() || undefined });
      if (!parsed.success) return setInvalid("Enter a name (2 to 120 characters) and a symbol (up to 20).");
      setInvalid(null);
      create.mutate(parsed.data);
    }}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`} className="text-xs font-medium text-ivory">Name</Label>
        <Input id={`${id}-name`} className={fieldCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-sym`} className="text-xs font-medium text-ivory">Symbol</Label>
        <Input id={`${id}-sym`} className={`${fieldCls} uppercase`} value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-type`} className="text-xs font-medium text-ivory">Type</Label>
        <Select id={`${id}-type`} value={f.assetType} onChange={(e) => setF({ ...f, assetType: assetTypeSchema.parse(e.target.value) })}>
          {assetTypeSchema.options.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
        </Select>
      </div>
      <IssuerSelect value={f.issuerId} onChange={(issuerId) => setF({ ...f, issuerId })} client={client} />
      <div className="space-y-2">
        <Label htmlFor={`${id}-desc`} className="text-xs font-medium text-ivory">Description (optional)</Label>
        <Textarea id={`${id}-desc`} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </div>
      {invalid && <p role="alert" className="text-sm text-danger">{invalid}</p>}
      {create.isError && <AssetError error={create.error} />}
      <Button type="submit" className="min-h-11 w-fit" disabled={create.isPending}>{create.isPending && <Loader2 aria-hidden className="animate-spin" />}Create asset</Button>
    </form>
  );
}

/** Symbol and type are locked once the instrument is approved (the API refuses the change). */
export function AssetDetailsForm({ a, locked, onChange, client = api }: { a: OpsAssetDetail; locked: boolean; onChange(d: OpsAssetDetail): void; client?: IssuerClient & Pick<ApiClient, "opsUpdateAsset"> }) {
  const id = useId();
  const [f, setF] = useState({ name: a.name, symbol: a.symbol, issuerId: a.issuerId ?? "", description: a.description ?? "", riskNotes: a.riskNotes ?? "" });
  const identityLocked = a.status !== "DRAFT" && a.status !== "CHANGES_REQUIRED";
  const save = useMutation({ mutationFn: () => client.opsUpdateAsset(a.id, { name: f.name.trim(), issuerId: f.issuerId || null, description: f.description.trim(), riskNotes: f.riskNotes.trim(), ...(identityLocked ? {} : { symbol: f.symbol.trim() }) }), onSuccess: onChange });
  const lock = <span title="Locked after approval" className="inline-flex items-center gap-1 text-xs text-stone"><Lock aria-hidden className="size-3.5" />Locked after approval</span>;

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="font-display text-xl font-semibold text-ivory">Details</h2>
      <form className="grid max-w-xl gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`} className="text-xs font-medium text-ivory">Name</Label>
          <Input id={`${id}-name`} className={fieldCls} value={f.name} disabled={locked} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-sym`} className="text-xs font-medium text-ivory">Symbol</Label>
          {identityLocked ? <p className="flex flex-wrap items-center gap-3 text-sm text-ivory">{a.symbol}{lock}</p>
            : <Input id={`${id}-sym`} className={`${fieldCls} uppercase`} value={f.symbol} disabled={locked} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} />}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-ivory">Type</p>
          <p className="flex flex-wrap items-center gap-3 text-sm text-ivory">{ASSET_TYPE_LABEL[a.assetType]}{identityLocked && lock}</p>
        </div>
        <IssuerSelect value={f.issuerId} onChange={(issuerId) => setF({ ...f, issuerId })} disabled={locked} client={client} />
        <div className="space-y-2">
          <Label htmlFor={`${id}-desc`} className="text-xs font-medium text-ivory">Description</Label>
          <Textarea id={`${id}-desc`} value={f.description} maxLength={2000} disabled={locked} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-risk`} className="text-xs font-medium text-ivory">Risk notes</Label>
          <Textarea id={`${id}-risk`} value={f.riskNotes} maxLength={2000} disabled={locked} onChange={(e) => setF({ ...f, riskNotes: e.target.value })} />
        </div>
        {!locked && <Button type="submit" className="min-h-11 w-fit" disabled={save.isPending}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save details</Button>}
      </form>
      {save.isError && <AssetError error={save.error} />}
    </section>
  );
}

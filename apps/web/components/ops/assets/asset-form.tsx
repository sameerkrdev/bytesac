"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSET_TYPE_LABEL, SECTOR_LABEL } from "@repo/app-core";
import { INSTRUMENT_SECTORS, assetTypeSchema, createInstrumentRequestSchema, instrumentSectorSchema, type AssetType, type CreateInstrumentRequest, type OpsAssetDetail } from "@repo/validator";
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
import { Field, StepForm } from "@/components/ui/step-form";
import { AssetError } from "./asset-ui";
import { LogoPicker, uploadAssetLogo, type LogoClient } from "./asset-logo";

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
      <Label htmlFor={`${id}-i`} className="text-xs font-medium text-ink">Issuer</Label>
      <Select id={`${id}-i`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">No issuer</option>
        {issuers.data?.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </Select>
      {name === null ? (
        <Button type="button" variant="secondary"  disabled={disabled} onClick={() => setName("")}>New issuer</Button>
      ) : (
        <div className="space-y-2 rounded-tile border border-line p-3">
          <Label htmlFor={`${id}-n`} className="text-xs font-medium text-ink">Issuer name</Label>
          <Input id={`${id}-n`}  value={name} onChange={(e) => setName(e.target.value)} />
          <div className="flex gap-2">
            <Button type="button"  disabled={create.isPending || name.trim().length < 2} onClick={() => create.mutate(name.trim())}>Create issuer</Button>
            <Button type="button" variant="secondary"  onClick={() => setName(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {(issuers.isError || create.isError) && <AssetError error={issuers.error ?? create.error} />}
    </div>
  );
}

const fieldCls = "min-h-11";

/**
 * The create flow in four steps: identity, issuer and description, logo (optional), review. Nothing is created before
 * the last step; the logo is uploaded right after the asset exists, then the editor opens.
 */
export function CreateAssetForm({ client = api }: { client?: IssuerClient & Pick<ApiClient, "opsCreateAsset"> & Partial<LogoClient> }) {
  const id = useId();
  const router = useRouter();
  const [f, setF] = useState({ name: "", symbol: "", assetType: "CRYPTO" as AssetType, issuerId: "", description: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logo, setLogo] = useState<File | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async (body: CreateInstrumentRequest) => {
      const d = await client.opsCreateAsset(body);
      if (logo && client.opsPresignAssetLogo && client.opsConfirmAssetLogo && client.opsRemoveAssetLogo) {
        // The asset exists either way; a logo failure is reported on the editor rather than losing the asset.
        try { await uploadAssetLogo(client as LogoClient, d.id, logo); } catch { setLogoError("The asset was created, but the logo didn't upload. Add it from the asset page."); }
      }
      return d;
    },
    onSuccess: (d) => router.push(`/ops/assets/${d.id}`),
  });
  const parsed = () => createInstrumentRequestSchema.safeParse({ ...f, issuerId: f.issuerId || null, description: f.description.trim() || undefined });
  const checkIdentity = () => {
    const e: Record<string, string> = {};
    if (f.name.trim().length < 2 || f.name.trim().length > 120) e.name = "Enter a name of 2 to 120 characters.";
    if (f.symbol.trim().length < 1 || f.symbol.trim().length > 20) e.symbol = "Enter a symbol of up to 20 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  return (
    <StepForm label="New asset" className="max-w-2xl" submitLabel="Create asset" pending={create.isPending}
      onSubmit={() => { const p = parsed(); if (p.success) create.mutate(p.data); else setErrors({ name: "Enter a name (2 to 120 characters) and a symbol (up to 20)." }); }}
      error={<>{create.isError && <AssetError error={create.error} />}{logoError && <p role="status" className="text-sm text-warning">{logoError}</p>}</>}
      steps={[
        {
          id: "identity", title: "What it is", description: "The registry entry investors and managers see. Symbol and type lock after approval.", validate: checkIdentity,
          content: (
            <>
              <Field label="Name" htmlFor={`${id}-name`} error={errors.name}><Input id={`${id}-name`} className={fieldCls} value={f.name} aria-invalid={Boolean(errors.name)} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
              <Field label="Symbol" htmlFor={`${id}-sym`} error={errors.symbol}><Input id={`${id}-sym`} className={`${fieldCls} uppercase`} value={f.symbol} aria-invalid={Boolean(errors.symbol)} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} /></Field>
              <Field label="Type" htmlFor={`${id}-type`}>
                <Select id={`${id}-type`} value={f.assetType} onChange={(e) => setF({ ...f, assetType: assetTypeSchema.parse(e.target.value) })}>
                  {assetTypeSchema.options.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
                </Select>
              </Field>
            </>
          ),
        },
        {
          id: "issuer", title: "Issuer and description", description: "Optional. Tokenized assets usually have an issuer.",
          content: (
            <>
              <IssuerSelect value={f.issuerId} onChange={(issuerId) => setF({ ...f, issuerId })} client={client} />
              <Field label="Description (optional)" htmlFor={`${id}-desc`}><Textarea id={`${id}-desc`} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            </>
          ),
        },
        { id: "logo", title: "Logo", description: "Optional. Shown wherever the asset appears.", content: <LogoPicker symbol={f.symbol} file={logo} onFile={setLogo} /> },
        {
          id: "review", title: "Review",
          content: (
            <dl className="divide-y divide-line rounded-tile border border-line bg-surface text-sm">
              {([["Name", f.name.trim()], ["Symbol", f.symbol.trim()], ["Type", ASSET_TYPE_LABEL[f.assetType]], ["Description", f.description.trim() || "—"], ["Logo", logo ? logo.name : "None"]] as const).map(([k, v]) => (
                <div key={k} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]"><dt className="text-ink-muted">{k}</dt><dd className="break-words text-ink">{v}</dd></div>
              ))}
            </dl>
          ),
        },
      ]} />
  );
}

/** Symbol and type are locked once the instrument is approved (the API refuses the change). */
export function AssetDetailsForm({ a, locked, onChange, client = api }: { a: OpsAssetDetail; locked: boolean; onChange(d: OpsAssetDetail): void; client?: IssuerClient & Pick<ApiClient, "opsUpdateAsset"> }) {
  const id = useId();
  const [f, setF] = useState({ name: a.name, symbol: a.symbol, issuerId: a.issuerId ?? "", description: a.description ?? "", riskNotes: a.riskNotes ?? "", links: a.links.map((l) => `${l.label} | ${l.url}`).join("\n") });
  const identityLocked = a.status !== "DRAFT" && a.status !== "CHANGES_REQUIRED";
  const save = useMutation({ mutationFn: () => client.opsUpdateAsset(a.id, { name: f.name.trim(), issuerId: f.issuerId || null, description: f.description.trim(), riskNotes: f.riskNotes.trim(), links: f.links.split("\n").filter((l) => l.trim()).map((l) => { const [label = "", ...url] = l.split("|"); return { label: label.trim(), url: url.join("|").trim() }; }), ...(identityLocked ? {} : { symbol: f.symbol.trim() }) }), onSuccess: onChange });
  const lock = <span title="Locked after approval" className="inline-flex items-center gap-1 text-xs text-ink-muted"><Lock aria-hidden className="size-3.5" />Locked after approval</span>;

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="type-heading text-ink">Details</h2>
      <form className="grid max-w-xl gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-name`} className="text-xs font-medium text-ink">Name</Label>
          <Input id={`${id}-name`} className={fieldCls} value={f.name} disabled={locked} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-sym`} className="text-xs font-medium text-ink">Symbol</Label>
          {identityLocked ? <p className="flex flex-wrap items-center gap-3 text-sm text-ink">{a.symbol}{lock}</p>
            : <Input id={`${id}-sym`} className={`${fieldCls} uppercase`} value={f.symbol} disabled={locked} onChange={(e) => setF({ ...f, symbol: e.target.value.toUpperCase() })} />}
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-ink">Type</p>
          <p className="flex flex-wrap items-center gap-3 text-sm text-ink">{ASSET_TYPE_LABEL[a.assetType]}{identityLocked && lock}</p>
        </div>
        <IssuerSelect value={f.issuerId} onChange={(issuerId) => setF({ ...f, issuerId })} disabled={locked} client={client} />
        <div className="space-y-2">
          <Label htmlFor={`${id}-desc`} className="text-xs font-medium text-ink">Description</Label>
          <Textarea id={`${id}-desc`} value={f.description} maxLength={2000} disabled={locked} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-risk`} className="text-xs font-medium text-ink">Risk notes</Label>
          <Textarea id={`${id}-risk`} value={f.riskNotes} maxLength={2000} disabled={locked} onChange={(e) => setF({ ...f, riskNotes: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-links`} className="text-xs font-medium text-ink">Links (one per line: label | https://url, up to 10)</Label>
          <Textarea id={`${id}-links`} value={f.links} disabled={locked} onChange={(e) => setF({ ...f, links: e.target.value })} />
        </div>
        {!locked && <Button type="submit" className="min-h-11 w-fit" disabled={save.isPending}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save details</Button>}
      </form>
      {save.isError && <AssetError error={save.error} />}
    </section>
  );
}

/** Sector and tags are descriptive (they only feed discovery), so they stay editable on a live asset. Retired tags can be kept or removed, not added. */
export function AssetClassification({ a, locked, onChange, client = api }: { a: OpsAssetDetail; locked: boolean; onChange(d: OpsAssetDetail): void; client?: Pick<ApiClient, "opsListAssetTags" | "opsUpdateAsset"> }) {
  const id = useId();
  const [sector, setSector] = useState(a.sector);
  const [picked, setPicked] = useState(() => new Set(a.tags.map((t) => t.id)));
  const tags = useQuery({ queryKey: ["ops", "asset-tags"], queryFn: () => client.opsListAssetTags(), retry: false });
  const save = useMutation({ mutationFn: () => client.opsUpdateAsset(a.id, { sector, tagIds: [...picked] }), onSuccess: onChange });
  const options = (tags.data?.tags ?? []).filter((t) => t.status === "active" || picked.has(t.id));
  const toggle = (tid: string) => setPicked((s) => { const n = new Set(s); if (!n.delete(tid)) n.add(tid); return n; });

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="type-heading text-ink">Sector and tags</h2>
      <form className="grid max-w-xl gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-sector`} className="text-xs font-medium text-ink">Sector</Label>
          <Select id={`${id}-sector`} value={sector} disabled={locked} onChange={(e) => setSector(instrumentSectorSchema.parse(e.target.value))}>
            {INSTRUMENT_SECTORS.map((s) => <option key={s} value={s}>{SECTOR_LABEL[s]}</option>)}
          </Select>
        </div>
        <fieldset className="space-y-1" disabled={locked}>
          <legend className="text-xs font-medium text-ink">Tags</legend>
          {tags.isError && <AssetError error={tags.error} />}
          {options.map((t) => (
            <label key={t.id} className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={picked.has(t.id)} onChange={() => toggle(t.id)} />{t.label}{t.status === "retired" && <span className="text-xs text-ink-muted">(retired)</span>}
            </label>
          ))}
          {tags.data && options.length === 0 && <p className="text-sm text-ink-muted">No tags yet.</p>}
        </fieldset>
        {!locked && <Button type="submit" className="min-h-11 w-fit" disabled={save.isPending}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save sector and tags</Button>}
      </form>
      {save.isError && <AssetError error={save.error} />}
    </section>
  );
}

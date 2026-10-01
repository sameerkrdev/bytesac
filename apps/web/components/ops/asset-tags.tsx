"use client";

import type { ApiClient } from "@repo/api-client";
import { createAssetTagRequestSchema } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ConfirmReason } from "@/components/baskets/confirm-reason";
import { useMe } from "@/components/me-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsListAssetTags" | "opsCreateAssetTag" | "opsRetireAssetTag">;

/** Admin-only tag vocabulary: create and retire (never delete; assets keep a retired tag until ops remove it). */
export function AssetTags({ client = api }: { client?: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [f, setF] = useState({ key: "", label: "" });
  const [invalid, setInvalid] = useState(false);
  const isAdmin = me?.platformRoles.includes("ops_admin");
  const tags = useQuery({ queryKey: ["ops", "asset-tags"], queryFn: () => client.opsListAssetTags(), enabled: isAdmin, retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ops", "asset-tags"] });
  const create = useMutation({ mutationFn: (b: Parameters<Client["opsCreateAssetTag"]>[0]) => client.opsCreateAssetTag(b), onSuccess: () => { setF({ key: "", label: "" }); return refresh(); } });
  const retire = useMutation({ mutationFn: (tid: string) => client.opsRetireAssetTag(tid), onSuccess: refresh });

  if (!isAdmin) return <p role="alert" className="text-base text-ivory">You don&apos;t have access to this area.</p>;
  return (
    <div className="space-y-8">
      <h1 className="font-display text-3xl font-bold text-ivory">Asset tags</h1>
      <form noValidate className="grid max-w-xl gap-4" onSubmit={(e) => {
        e.preventDefault();
        const parsed = createAssetTagRequestSchema.safeParse({ key: f.key.trim(), label: f.label.trim() });
        setInvalid(!parsed.success);
        if (parsed.success) create.mutate(parsed.data);
      }}>
        <div className="space-y-2">
          <Label htmlFor={`${id}-key`} className="text-xs font-medium text-ivory">Key (lowercase letters, numbers, hyphens)</Label>
          <Input id={`${id}-key`} className="min-h-11 bg-space text-ivory" value={f.key} autoComplete="off" spellCheck={false} onChange={(e) => setF({ ...f, key: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-label`} className="text-xs font-medium text-ivory">Label</Label>
          <Input id={`${id}-label`} className="min-h-11 bg-space text-ivory" value={f.label} maxLength={40} onChange={(e) => setF({ ...f, label: e.target.value })} />
        </div>
        {invalid && <p role="alert" className="text-xs text-danger">Use a 2 to 32 character key (a-z, 0-9, hyphen) and a label up to 40 characters.</p>}
        <Button type="submit" className="min-h-11 w-fit" disabled={create.isPending}>Create tag</Button>
        {create.isError && <OpsError error={create.error} />}
      </form>

      {tags.isError ? <OpsError error={tags.error} /> : !tags.data ? <p role="status" className="text-sm text-muted-foreground">Loading…</p> : (
        <ul className="space-y-3">
          {tags.data.tags.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border-dark bg-slate p-3">
              <span className="font-mono text-xs text-stone">{t.key}</span>
              <span className="text-sm font-medium text-ivory">{t.label}</span>
              <span className="text-xs text-stone">{t.status === "active" ? "Active" : `Retired ${new Date(t.retiredAt ?? t.createdAt).toLocaleDateString()}`}</span>
              {t.status === "active" && <span className="ml-auto"><ConfirmReason label={`Retire ${t.key}`} description="Retired tags can no longer be added to assets. Assets keep the tag until you remove it." pending={retire.isPending} onConfirm={() => retire.mutate(t.id)} /></span>}
            </li>
          ))}
        </ul>
      )}
      {retire.isError && <OpsError error={retire.error} />}
    </div>
  );
}

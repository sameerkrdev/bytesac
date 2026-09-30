"use client";

import type { ApiClient } from "@repo/api-client";
import { createDisclosureTemplateRequestSchema, disclosureConditionSchema, type DisclosureTemplateView, type ListDisclosureTemplatesResponse } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { ConfirmReason } from "@/components/baskets/confirm-reason";
import { useMe } from "@/components/me-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { OpsError } from "../ops-error";

type Client = Pick<ApiClient, "opsListDisclosureTemplates" | "opsCreateDisclosureTemplate" | "opsRetireDisclosureTemplate">;

const CONDITION = { always: "Always", has_stablecoin: "Basket holds a stablecoin", has_rwa: "Basket holds tokenized real-world assets" } as const;

/** Writes the next version of a key. The API retires the previous active version. */
function NewVersionForm({ active, pending, onSubmit }: { active: DisclosureTemplateView; pending: boolean; onSubmit(body: Parameters<Client["opsCreateDisclosureTemplate"]>[0]): void }) {
  const id = useId();
  const [title, setTitle] = useState(active.title);
  const [body, setBody] = useState(active.body);
  const [condition, setCondition] = useState(active.condition);
  const parsed = createDisclosureTemplateRequestSchema.safeParse({ key: active.key, title, body, condition });
  return (
    <form className="max-w-xl space-y-3 rounded-xl border border-border-dark p-4" aria-label={`New version of ${active.key}`} onSubmit={(e) => { e.preventDefault(); if (parsed.success) onSubmit(parsed.data); }}>
      <div className="space-y-1">
        <Label htmlFor={`${id}-t`} className="text-xs font-medium text-ivory">Title</Label>
        <Input id={`${id}-t`} value={title} maxLength={120} className="min-h-11 bg-space text-ivory" onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-b`} className="text-xs font-medium text-ivory">Body (plain text)</Label>
        <Textarea id={`${id}-b`} value={body} maxLength={5000} onChange={(e) => setBody(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-c`} className="text-xs font-medium text-ivory">Shown when</Label>
        <Select id={`${id}-c`} value={condition} onChange={(e) => setCondition(disclosureConditionSchema.parse(e.target.value))}>
          {disclosureConditionSchema.options.map((c) => <option key={c} value={c}>{CONDITION[c]}</option>)}
        </Select>
      </div>
      <Button type="submit" className="min-h-11" disabled={!parsed.success || pending}>{pending && <Loader2 aria-hidden className="animate-spin" />}Publish new version</Button>
    </form>
  );
}

export function DisclosureTemplates({ client = api }: { client?: Client }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.platformRoles.includes("ops_admin") ?? false;
  const key = ["ops", "disclosure-templates"];
  const query = useQuery({ queryKey: key, queryFn: () => client.opsListDisclosureTemplates(), enabled: isAdmin, retry: false });
  const [editing, setEditing] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: (run: () => Promise<ListDisclosureTemplatesResponse>) => run(),
    onSuccess: (d) => { qc.setQueryData(key, d); setEditing(null); },
  });

  if (!isAdmin) return <p role="alert" className="text-base text-ivory">Only ops admins can manage disclosure templates.</p>;
  if (query.isError) return <OpsError error={query.error} />;
  if (!query.data) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold text-ivory">Disclosures</h1>
        <p className="text-sm text-stone">Platform notices are added to every basket version when it is submitted. A new version applies to later submissions and is re-pinned when an approved version is published.</p>
      </div>
      {act.isError && <OpsError error={act.error} />}
      {query.data.groups.map((g) => {
        // A fully retired key can still get a new version, based on its latest one.
        const base = g.templates.find((t) => t.status === "active") ?? g.templates.reduce((a, t) => (t.version > a.version ? t : a));
        return (
          <section key={g.key} aria-label={g.key} className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ivory">{g.key}</h2>
            <ul className="space-y-3">
              {g.templates.map((t) => (
                <li key={t.id} className="space-y-1 rounded-xl border border-border-dark p-3">
                  <p className="text-sm font-medium text-ivory">Version {t.version}: {t.title} <span className="text-xs font-normal text-stone">· {t.status === "active" ? "Active" : "Retired"} · {CONDITION[t.condition]}</span></p>
                  <p className="whitespace-pre-wrap text-sm text-stone">{t.body}</p>
                  {t.status === "active" && (
                    <ConfirmReason label={`Retire version ${t.version} of ${g.key}`} destructive pending={act.isPending}
                      description="New submissions will no longer include this notice until another version is published." onConfirm={() => act.mutate(() => client.opsRetireDisclosureTemplate(t.id))} />
                  )}
                </li>
              ))}
            </ul>
            {editing === g.key
              ? <NewVersionForm active={base} pending={act.isPending} onSubmit={(body) => act.mutate(() => client.opsCreateDisclosureTemplate(body))} />
              : <Button variant="secondary" className="min-h-11" aria-label={`New version of ${g.key}`} onClick={() => setEditing(g.key)}>New version</Button>}
          </section>
        );
      })}
    </div>
  );
}

"use client";

import type { ApiClient } from "@repo/api-client";
import { routePolicyInputSchema, type RoutingView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useMe } from "@/components/me-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsGetRouting" | "opsDenyRouteTool" | "opsAllowRouteTool">;
type Tool = RoutingView["bridges"][number];

/** LI.FI bridges and exchanges with their deny state. A denied tool is left out of every estimate and quote; only an ops admin can deny or allow (the server checks again). */
export function Routing({ client = api }: { client?: Client }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.platformRoles.includes("ops_admin") ?? false;
  const view = useQuery({ queryKey: ["ops", "routing"], queryFn: () => client.opsGetRouting(), retry: false });
  const [pick, setPick] = useState<{ kind: "bridge" | "exchange"; tool: Tool } | null>(null);
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const refresh = () => { setPick(null); setReason(""); return qc.invalidateQueries({ queryKey: ["ops", "routing"] }); };
  const deny = useMutation({ mutationFn: (b: Parameters<Client["opsDenyRouteTool"]>[0]) => client.opsDenyRouteTool(b), onSuccess: refresh });
  const allow = useMutation({ mutationFn: (id: string) => client.opsAllowRouteTool(id), onSuccess: refresh });

  if (view.isError) return <OpsError error={view.error} />;
  if (!view.data) return <LoadingState />;
  const table = (kind: "bridge" | "exchange", title: string, tools: Tool[]) => (
    <section aria-label={title} className="space-y-2">
      <h2 className="font-display text-xl font-semibold text-ivory">{title}</h2>
      <ul className="divide-y divide-border-dark">
        {tools.map((t) => (
          <li key={t.key} className="flex flex-wrap items-center gap-3 py-2 text-sm text-ivory">
            <span className="font-medium">{t.name}</span><span className="font-mono text-xs text-stone">{t.key}</span>
            {t.denyEntryId ? <span className="text-xs font-medium text-warning">Denied</span> : <span className="text-xs text-stone">Allowed</span>}
            {isAdmin && (t.denyEntryId
              ? <Button type="button" variant="secondary" className="ml-auto min-h-11" disabled={allow.isPending} onClick={() => allow.mutate(t.denyEntryId!)}>Allow {t.name}</Button>
              : <Button type="button" variant="secondary" className="ml-auto min-h-11" onClick={() => { setPick({ kind, tool: t }); setInvalid(null); }}>Deny {t.name}</Button>)}
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="space-y-8">
      <PageHeader title="Routing" />
      <p className="text-sm text-stone">A denied bridge or exchange is left out of every estimate and quote within a minute. It only narrows the routes; it never moves anything.</p>
      {!isAdmin && <p className="text-xs text-stone">Only an ops admin can deny or allow a tool.</p>}
      {pick && (
        <form className="grid max-w-xl gap-3 rounded-xl border border-border-dark p-3" onSubmit={(e) => {
          e.preventDefault();
          const parsed = routePolicyInputSchema.safeParse({ kind: pick.kind, toolKey: pick.tool.key, reason });
          setInvalid(parsed.success ? null : (parsed.error.issues[0]?.message ?? "Add a reason."));
          if (parsed.success) deny.mutate(parsed.data);
        }}>
          <label className="space-y-1 text-xs font-medium text-ivory">Reason for denying {pick.tool.name}
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="min-h-11 bg-space text-ivory" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="min-h-11" disabled={deny.isPending}>Confirm deny</Button>
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setPick(null)}>Cancel</Button>
          </div>
          {invalid && <p role="alert" className="text-xs text-danger">{invalid}</p>}
        </form>
      )}
      {(deny.error ?? allow.error) ? <OpsError error={deny.error ?? allow.error} /> : null}
      {table("bridge", "Bridges", view.data.bridges)}
      {table("exchange", "Exchanges", view.data.exchanges)}
      <section aria-label="History" className="space-y-2">
        <h2 className="font-display text-xl font-semibold text-ivory">History</h2>
        {view.data.entries.length === 0 ? <p className="text-sm text-stone">Nothing denied yet.</p> : (
          <ul className="space-y-1 text-sm text-stone">
            {view.data.entries.map((x) => <li key={x.id}>{x.kind} {x.toolKey}: denied {new Date(x.createdAt).toLocaleDateString()} · {x.reason}{x.removedAt && ` · allowed again ${new Date(x.removedAt).toLocaleDateString()}`}{x.stale && <span className="font-medium text-warning"> · Stale — LI.FI no longer lists this key; re-deny under the new key</span>}</li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

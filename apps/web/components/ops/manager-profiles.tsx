"use client";

import type { ApiClient } from "@repo/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { ConfirmReason } from "@/components/baskets/confirm-reason";
import { StatusBadge } from "@/components/status-badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsListManagerProfiles" | "opsHideManagerProfile" | "opsUnhideManagerProfile">;
type Status = NonNullable<Parameters<Client["opsListManagerProfiles"]>[0]>["status"];
const STATUS = { draft: { label: "Draft", tone: "neutral" }, published: { label: "Published", tone: "success" }, hidden: { label: "Hidden", tone: "warning" } } as const;

/** Moderation of public manager profiles: hide (reason required, confirmed) and unhide (returns the profile to draft). */
export function ManagerProfiles({ client = api }: { client?: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status>("published");
  const list = useQuery({ queryKey: ["ops", "manager-profiles", status], queryFn: () => client.opsListManagerProfiles({ status }), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["ops", "manager-profiles"] });
  const hide = useMutation({ mutationFn: (v: { id: string; reason: string }) => client.opsHideManagerProfile(v.id, { reason: v.reason }), onSuccess: refresh });
  const unhide = useMutation({ mutationFn: (pid: string) => client.opsUnhideManagerProfile(pid), onSuccess: refresh });

  return (
    <div className="space-y-6">
      <PageHeader title="Manager profiles" />
      <div className="max-w-xs space-y-2">
        <Label htmlFor={`${id}-status`} className="text-xs font-medium text-ivory">Status</Label>
        <Select id={`${id}-status`} value={status ?? ""} onChange={(e) => setStatus((e.target.value || undefined) as Status)}>
          <option value="">All</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {list.isError ? <OpsError error={list.error} onRetry={() => void list.refetch()} /> : !list.data ? <LoadingState /> : list.data.items.length === 0 ? <p className="text-sm text-stone">No profiles.</p> : (
        <ul className="space-y-3">
          {list.data.items.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border-dark bg-slate p-3">
              <span className="text-sm font-medium text-ivory">{p.displayName}</span>
              <span className="font-mono text-xs text-stone">@{p.handle}</span>
              <StatusBadge {...STATUS[p.status]} />
              {p.hiddenReason && <span className="text-xs text-stone">Reason: {p.hiddenReason}</span>}
              <span className="ml-auto">
                {p.status === "published" && <ConfirmReason label={`Hide ${p.handle}`} description="The profile stops being public, its owner cannot republish it, and basket pages fall back to the opt-in team name. The owner is emailed." reasonLabel="Reason for hiding" destructive pending={hide.isPending} onConfirm={(reason) => hide.mutate({ id: p.id, reason })} />}
                {p.status === "hidden" && <ConfirmReason label={`Unhide ${p.handle}`} description="The profile returns to draft. Its owner can publish it again." pending={unhide.isPending} onConfirm={() => unhide.mutate(p.id)} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      {(hide.isError || unhide.isError) && <OpsError error={hide.error ?? unhide.error} />}
    </div>
  );
}

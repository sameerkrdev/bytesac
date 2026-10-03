"use client";

import type { ApiClient } from "@repo/api-client";
import { BASKET_VERSION_STATUS_LABEL, formatBps } from "@repo/app-core";
import type { BasketDiff, ListBasketVersionsResponse } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { LoadingState } from "@/components/layout/states";

type Client = Pick<ApiClient, "getBasketVersionDiff">;

/** What changed in a version. `names` maps instrument ids to names; a removed asset may have none, so its id is shortened. */
export function DiffSummary({ diff, names }: { diff: BasketDiff; names: Record<string, string> }) {
  const n = (id: string) => names[id] ?? `Asset ${id.slice(0, 8)}`;
  const lines = [
    ...diff.added.map((a) => `Added ${n(a.instrumentId)} at ${formatBps(a.weightBps)}`),
    ...diff.removed.map((a) => `Removed ${n(a.instrumentId)} (was ${formatBps(a.weightBps)})`),
    ...diff.changed.map((a) => `${n(a.instrumentId)}: ${formatBps(a.fromBps)} to ${formatBps(a.toBps)}`),
    ...diff.bandChanged.map((id) => `${n(id)}: weight band changed`),
    ...(diff.constraints ? ["Constraints changed"] : []),
    ...(diff.rebalance ? ["Rebalance disclosures changed"] : []),
    ...(diff.fees ? ["Fees changed"] : []),
    ...(diff.minimums ? ["Minimums changed"] : []),
  ];
  return lines.length === 0 ? <p className="text-xs text-stone">No changes.</p> : <ul className="list-disc pl-5 text-xs text-ivory">{lines.map((l) => <li key={l}>{l}</li>)}</ul>;
}

/** Past versions of a basket, each with its changes on request. */
export function VersionHistory({ bid, versions, names, client = api }: { bid: string; versions: ListBasketVersionsResponse["versions"]; names: Record<string, string>; client?: Client }) {
  const [open, setOpen] = useState<string | null>(null);
  const diff = useQuery({ queryKey: ["basket", bid, "diff", open], queryFn: () => client.getBasketVersionDiff(bid, open as string), enabled: open !== null, retry: false });
  return (
    <ul aria-label="Version history" className="divide-y divide-border-dark">
      {versions.map((v) => (
        <li key={v.id} className="space-y-2 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-ivory">Version {v.versionNumber}</span>
            <StatusBadge {...BASKET_VERSION_STATUS_LABEL[v.status]} />
            <span className="text-xs text-stone">{v.publishedAt ? `Published ${new Date(v.publishedAt).toLocaleDateString()}` : `Created ${new Date(v.createdAt).toLocaleDateString()}`}</span>
            <Button variant="secondary" className="ml-auto min-h-11" aria-expanded={open === v.id} onClick={() => setOpen(open === v.id ? null : v.id)}>
              {open === v.id ? "Hide changes" : "Show changes"}
            </Button>
          </div>
          {v.rationale && <p className="whitespace-pre-wrap text-sm text-stone">{v.rationale}</p>}
          {open === v.id && (diff.isError ? <p role="alert" className="text-sm text-danger">{toDisplayError(diff.error).title}</p> : diff.data ? <DiffSummary diff={diff.data} names={names} /> : <LoadingState />)}
        </li>
      ))}
    </ul>
  );
}

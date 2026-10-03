"use client";

import type { ApiClient } from "@repo/api-client";
import { ORGANIZATION_STATUS_LABEL } from "@repo/app-core";
import { ORGANIZATION_STATUSES, type OrganizationReviewSummary, type OrganizationStatus } from "@repo/validator";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-layout";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsListOrganizations">;
type Queue = "organizations" | "change_requests" | "payout_changes";

const TABS: Array<{ queue: Queue; label: string }> = [
  { queue: "organizations", label: "Organizations" },
  { queue: "change_requests", label: "Change requests" },
  { queue: "payout_changes", label: "Payout wallet changes" },
];
// Drafts are never listed for ops.
const FILTERS = ORGANIZATION_STATUSES.filter((s) => s !== "DRAFT");

const name = (o: OrganizationReviewSummary) => o.displayName ?? o.legalName ?? "Unnamed organization";
const date = (o: OrganizationReviewSummary) => (o.submittedAt ? new Date(o.submittedAt).toLocaleDateString() : "");
const badge = (s: OrganizationStatus) => <StatusBadge {...ORGANIZATION_STATUS_LABEL[s]} />;

export function OrganizationsTable({ client = api }: { client?: Client }) {
  const [queue, setQueue] = useState<Queue>("organizations");
  const [status, setStatus] = useState<OrganizationStatus | undefined>();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useInfiniteQuery({
    queryKey: ["ops", "organizations", queue, status, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.opsListOrganizations({ queue, status: queue === "organizations" ? status : undefined, q: q || undefined, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Organizations" />
      <div role="group" aria-label="Queue" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.queue} type="button" aria-pressed={queue === t.queue} onClick={() => setQueue(t.queue)}
            className={cn("min-h-11 rounded-lg border border-border-dark px-3 text-sm text-stone hover:text-ivory", queue === t.queue && "bg-slate text-ivory")}>
            {t.label}
          </button>
        ))}
      </div>
      {queue === "organizations" && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
          {[undefined, ...FILTERS].map((s) => (
            <button key={s ?? "all"} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
              className={cn("min-h-11 rounded-lg border border-border-dark px-3 text-sm text-stone hover:text-ivory", status === s && "bg-slate text-ivory")}>
              {s ? ORGANIZATION_STATUS_LABEL[s].label : "All"}
            </button>
          ))}
        </div>
      )}
      <Input type="search" aria-label="Search organizations" placeholder="Search display or legal name" value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-11 max-w-md bg-space text-ivory placeholder:text-stone" />

      {list.isError ? <OpsError error={list.error} onRetry={() => void list.refetch()} /> : list.isPending ? <LoadingState /> : items.length === 0 ? (
        <EmptyState title="No organizations found." />
      ) : (
        <>
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="text-xs text-stone">
              <tr><th className="py-2 pr-4 font-medium">Organization</th><th className="pr-4 font-medium">Type</th><th className="pr-4 font-medium">Jurisdiction</th><th className="pr-4 font-medium">Status</th><th className="font-medium">Submitted</th></tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-t border-border-dark">
                  <td className="py-3 pr-4"><Link href={`/ops/organizations/${o.id}`} className="font-medium text-ivory underline-offset-4 hover:underline">{name(o)}</Link></td>
                  <td className="pr-4 text-stone">{o.type === "firm" ? "Firm" : "Individual"}</td>
                  <td className="pr-4 text-stone">{o.jurisdiction}</td>
                  <td className="pr-4">{badge(o.status)}</td>
                  <td className="text-stone">{date(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-3 md:hidden">
            {items.map((o) => (
              <li key={o.id}>
                <Link href={`/ops/organizations/${o.id}`} className="block space-y-2 rounded-xl border border-border-dark bg-slate p-4">
                  <span className="block font-medium text-ivory">{name(o)}</span>
                  <span className="block text-xs text-stone">{o.type === "firm" ? "Firm" : "Individual"} · {o.jurisdiction} · {date(o)}</span>
                  {badge(o.status)}
                </Link>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button variant="secondary" className="min-h-11" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button>
          )}
        </>
      )}
    </div>
  );
}

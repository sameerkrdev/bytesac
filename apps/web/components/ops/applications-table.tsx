"use client";

import type { ApiClient } from "@repo/api-client";
import { APPLICATION_STATUS_LABEL, shortAddress } from "@repo/app-core";
import { APPLICATION_STATUSES, CHAINS, type ApplicationStatus, type ApplicationSummary } from "@repo/validator";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsListApplications">;
// Ops never see unconfirmed applications.
const FILTERS = APPLICATION_STATUSES.filter((s) => s !== "EMAIL_PENDING");

function Applicant({ a }: { a: ApplicationSummary }) {
  return (
    <>
      <span className="block font-medium text-ivory">{a.firmName ?? a.fullName}</span>
      {a.firmName && <span className="block text-xs text-stone">{a.fullName}</span>}
    </>
  );
}
const date = (a: ApplicationSummary) => (a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : "");
const badge = (s: ApplicationStatus) => <StatusBadge {...APPLICATION_STATUS_LABEL[s]} />;

export function ApplicationsTable({ client = api }: { client?: Client }) {
  const [status, setStatus] = useState<ApplicationStatus | undefined>();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const list = useInfiniteQuery({
    queryKey: ["ops", "applications", status, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.opsListApplications({ status, q: q || undefined, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold text-ivory">Applications</h1>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        {[undefined, ...FILTERS].map((s) => (
          <button key={s ?? "all"} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
            className={cn("min-h-11 rounded-lg border border-border-dark px-3 text-sm text-stone hover:text-ivory", status === s && "bg-slate text-ivory")}>
            {s ? APPLICATION_STATUS_LABEL[s].label : "All"}
          </button>
        ))}
      </div>
      <Input type="search" aria-label="Search applications" placeholder="Search name, firm or email" value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-11 max-w-md bg-space text-ivory placeholder:text-stone" />

      {list.isError ? <OpsError error={list.error} /> : list.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No applications found.</p>
      ) : (
        <>
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="text-xs text-stone">
              <tr><th className="py-2 pr-4 font-medium">Applicant</th><th className="pr-4 font-medium">Email</th><th className="pr-4 font-medium">Country</th><th className="pr-4 font-medium">Wallet</th><th className="pr-4 font-medium">Status</th><th className="font-medium">Submitted</th></tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-border-dark">
                  <td className="py-3 pr-4"><Link href={`/ops/applications/${a.id}`} className="underline-offset-4 hover:underline"><Applicant a={a} /></Link></td>
                  <td className="pr-4 text-stone">{a.email}</td>
                  <td className="pr-4 text-stone">{a.country}</td>
                  <td className="pr-4 font-mono text-xs text-stone">{CHAINS[a.walletChain].label} {shortAddress(a.walletAddress)}</td>
                  <td className="pr-4">{badge(a.status)}</td>
                  <td className="text-stone">{date(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-3 md:hidden">
            {items.map((a) => (
              <li key={a.id}>
                <Link href={`/ops/applications/${a.id}`} className="block space-y-2 rounded-xl border border-border-dark bg-slate p-4">
                  <Applicant a={a} />
                  <span className="block text-xs text-stone">{a.email} · {a.country} · {date(a)}</span>
                  {badge(a.status)}
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

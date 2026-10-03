"use client";

import type { ApiClient } from "@repo/api-client";
import { formatUnits } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useId, useState } from "react";
import { dayBound } from "@/components/ops/revenue";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";

type Client = Pick<ApiClient, "getEarnings" | "getOrganization">;
const KIND = { network: "Network", manager_entry: "Entry fee", manager_rebalance: "Rebalance fee", platform: "Platform" } as const;

/** Settled manager fees of an organization. Visible with `earnings.read`; the API checks it again. */
export function Earnings({ orgId, client = api }: { orgId: string; client?: Client }) {
  const id = useId();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = { ...(from && { from: dayBound(from, false) }), ...(to && { to: dayBound(to, true) }) };
  const org = useQuery({ queryKey: ["organization", orgId], queryFn: () => client.getOrganization(orgId), retry: false });
  const allowed = org.data?.myPermissions.includes("earnings.read") ?? false;
  const q = useQuery({ queryKey: ["earnings", orgId, from, to], queryFn: () => client.getEarnings(orgId, range), enabled: allowed, retry: false });
  const csv = `/api/v1/organizations/${orgId}/earnings?${new URLSearchParams({ ...range, format: "csv" })}`;

  if (org.isError) { const e = toDisplayError(org.error); return <p role="alert" className="text-sm text-danger"><span className="font-medium">{e.title}</span> {e.message}</p>; }
  if (!org.data) return <LoadingState />;
  if (!allowed) return <p role="alert" className="text-base text-ivory">You don&apos;t have access to earnings for this organization.</p>;
  return (
    <section aria-labelledby={`${id}-h`} className="max-w-3xl space-y-6">
      <PageHeader id={`${id}-h`} title="Earnings" breadcrumb={[{ label: "Organization", href: "/organization" }]} />
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1"><Label htmlFor={`${id}-f`} className="text-xs font-medium text-ivory">From</Label><Input id={`${id}-f`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-11 bg-space text-ivory" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-t`} className="text-xs font-medium text-ivory">To</Label><Input id={`${id}-t`} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-11 bg-space text-ivory" /></div>
        <a href={csv} className="inline-flex min-h-11 items-center text-sm text-mint underline">Download CSV</a>
      </div>
      {q.isError ? <p role="alert" className="text-sm text-danger">{toDisplayError(q.error).message}</p> : !q.data ? <LoadingState /> : (
        <>
          <p className="text-lg text-ivory">Settled manager fees: {formatUnits(q.data.totalMicro, 6)} USDC</p>
          {q.data.waivedCount > 0 && <p role="status" className="text-sm text-stone">{q.data.waivedCount} manager fee{q.data.waivedCount === 1 ? " was" : "s were"} waived (no verified payout wallet, below $0.01, or price unavailable) and {q.data.waivedCount === 1 ? "is" : "are"} not in the total.</p>}
          <section aria-label="By basket, version, kind and month" className="space-y-2">
            <h2 className="font-display text-xl font-semibold text-ivory">By basket, version and month</h2>
            {q.data.groups.length === 0 ? <p className="text-sm text-stone">Nothing settled in this range.</p> : (
              <ul className="space-y-1 text-sm text-ivory">{q.data.groups.map((g, n) => <li key={n}>{g.month} · {g.basketName ?? "Basket"}{g.versionNumber !== null && ` v${g.versionNumber}`} · {KIND[g.kind]}: {formatUnits(g.amountMicro, 6)} USDC</li>)}</ul>
            )}
          </section>
          <section aria-label="Recent transactions" className="space-y-2">
            <h2 className="font-display text-xl font-semibold text-ivory">Recent transactions</h2>
            {q.data.recent.length === 0 ? <p className="text-sm text-stone">None yet.</p> : (
              <ul className="space-y-1 text-sm text-ivory">
                {q.data.recent.map((r, n) => (
                  <li key={n} className="flex flex-wrap gap-x-3">
                    <span>{new Date(r.settledAt).toLocaleDateString()} · {KIND[r.kind]}: {formatUnits(r.amountMicro, 6)} USDC</span>
                    {r.explorerUrl && <a href={r.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-mint underline">View transaction<ExternalLink aria-hidden className="size-3" /></a>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}

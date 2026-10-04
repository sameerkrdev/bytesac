"use client";

import type { ApiClient } from "@repo/api-client";
import { formatUnits } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { PLATFORM_OPERATION_LABEL } from "@/lib/fees";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsGetRevenue">;
const REASON = { payout_wallet_unavailable: "No verified payout wallet", dust: "Below $0.01", no_price: "Price unavailable" } as const;

/** `YYYY-MM-DD` to the start or end of that day (UTC) as an ISO instant, or undefined. */
export const dayBound = (d: string, end: boolean) => (d ? `${d}T${end ? "23:59:59.999" : "00:00:00.000"}Z` : undefined);

export function Revenue({ client = api }: { client?: Client }) {
  const id = useId();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = { ...(from && { from: dayBound(from, false) }), ...(to && { to: dayBound(to, true) }) };
  const q = useQuery({ queryKey: ["ops", "revenue", from, to], queryFn: () => client.opsGetRevenue(range), retry: false });
  const csv = `/api/v1/ops/revenue?${new URLSearchParams({ ...range, format: "csv" })}`;
  return (
    <div className="space-y-6">
      <PageHeader title="Revenue" />
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1"><Label htmlFor={`${id}-f`} className="text-xs font-medium text-ink">From</Label><Input id={`${id}-f`} type="date" value={from} onChange={(e) => setFrom(e.target.value)}  /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-t`} className="text-xs font-medium text-ink">To</Label><Input id={`${id}-t`} type="date" value={to} onChange={(e) => setTo(e.target.value)}  /></div>
        <a href={csv} className="inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-4">Download CSV</a>
      </div>
      {q.isError ? <OpsError error={q.error} onRetry={() => void q.refetch()} /> : !q.data ? <LoadingState /> : (
        <>
          <p className="text-lg text-ink">Platform fees settled: {formatUnits(q.data.totalMicro, 6)} USDC</p>
          <section aria-label="By operation and month" className="space-y-2">
            <h2 className="type-heading text-ink">By operation and month</h2>
            {q.data.platform.length === 0 ? <p className="text-sm text-ink-muted">Nothing settled in this range.</p> : (
              <ul className="space-y-1 text-sm text-ink">{q.data.platform.map((r) => <li key={`${r.operationKind}${r.month}`}>{r.month} · {PLATFORM_OPERATION_LABEL[r.operationKind]}: {formatUnits(r.amountMicro, 6)} USDC</li>)}</ul>
            )}
          </section>
          <section aria-label="Waived manager fees" className="space-y-2">
            <h2 className="type-heading text-ink">Waived manager fees</h2>
            {q.data.waivedManager.length === 0 ? <p className="text-sm text-ink-muted">None.</p> : (
              <ul className="space-y-1 text-sm text-ink">{q.data.waivedManager.map((w) => <li key={w.reason}>{REASON[w.reason]}: {w.count}</li>)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

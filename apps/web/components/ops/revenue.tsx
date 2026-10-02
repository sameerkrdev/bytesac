"use client";

import type { ApiClient } from "@repo/api-client";
import { formatUnits } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { PLATFORM_OPERATION_LABEL } from "@/lib/fees";
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
      <h1 className="font-display text-3xl font-bold text-ivory">Revenue</h1>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1"><Label htmlFor={`${id}-f`} className="text-xs font-medium text-ivory">From</Label><Input id={`${id}-f`} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-11 bg-space text-ivory" /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-t`} className="text-xs font-medium text-ivory">To</Label><Input id={`${id}-t`} type="date" value={to} onChange={(e) => setTo(e.target.value)} className="min-h-11 bg-space text-ivory" /></div>
        <a href={csv} className="inline-flex min-h-11 items-center text-sm text-mint underline">Download CSV</a>
      </div>
      {q.isError ? <OpsError error={q.error} /> : !q.data ? <p role="status" className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          <p className="text-lg text-ivory">Platform fees settled: {formatUnits(q.data.totalMicro, 6)} USDC</p>
          <section aria-label="By operation and month" className="space-y-2">
            <h2 className="font-display text-xl font-semibold text-ivory">By operation and month</h2>
            {q.data.platform.length === 0 ? <p className="text-sm text-stone">Nothing settled in this range.</p> : (
              <ul className="space-y-1 text-sm text-ivory">{q.data.platform.map((r) => <li key={`${r.operationKind}${r.month}`}>{r.month} · {PLATFORM_OPERATION_LABEL[r.operationKind]}: {formatUnits(r.amountMicro, 6)} USDC</li>)}</ul>
            )}
          </section>
          <section aria-label="Waived manager fees" className="space-y-2">
            <h2 className="font-display text-xl font-semibold text-ivory">Waived manager fees</h2>
            {q.data.waivedManager.length === 0 ? <p className="text-sm text-stone">None.</p> : (
              <ul className="space-y-1 text-sm text-ivory">{q.data.waivedManager.map((w) => <li key={w.reason}>{REASON[w.reason]}: {w.count}</li>)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

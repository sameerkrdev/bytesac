"use client";

import type { ApiClient } from "@repo/api-client";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsLifiTransfers">;

/** LI.FI's own records for a leg's source wallet around its submission, to resolve a stuck leg by hand. The records are provider data and shown as text only. */
/** One LI.FI record (untrusted provider shape): top-level fields as rows, nested values as compact JSON text. Rendered as text only. */
function TransferRecord({ record }: { record: Record<string, unknown> }) {
  return (
    <dl className="divide-y divide-line overflow-hidden rounded-tile border border-line bg-surface text-xs">
      {Object.entries(record).map(([k, v]) => (
        <div key={k} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="font-mono text-ink-faint">{k}</dt>
          <dd className="font-mono break-all text-ink">{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LifiTransfers({ client = api }: { client?: Client }) {
  const [opId, setOpId] = useState("");
  const [legId, setLegId] = useState("");
  const look = useMutation({ mutationFn: () => client.opsLifiTransfers(opId.trim(), legId.trim()) });
  return (
    <section aria-label="LI.FI transfers" className="space-y-3">
      <h2 className="type-heading text-ink">LI.FI transfers for a leg</h2>
      <form className="grid max-w-xl gap-3" onSubmit={(e) => { e.preventDefault(); look.mutate(); }}>
        <label className="space-y-1 text-xs font-medium text-ink">Operation ID<Input value={opId} onChange={(e) => setOpId(e.target.value)} className="min-h-11 bg-canvas font-mono text-ink" /></label>
        <label className="space-y-1 text-xs font-medium text-ink">Leg ID<Input value={legId} onChange={(e) => setLegId(e.target.value)} className="min-h-11 bg-canvas font-mono text-ink" /></label>
        <Button type="submit" className="min-h-11 w-fit" disabled={look.isPending || !opId.trim() || !legId.trim()}>Look up</Button>
      </form>
      {look.error ? <OpsError error={look.error} /> : null}
      {look.data && (look.data.transfers.length === 0 ? <p className="text-sm text-ink-muted">LI.FI has no transfer for {look.data.wallet} in that window.</p> : (
        <ul className="space-y-3">{look.data.transfers.map((t, n) => <li key={n}><TransferRecord record={t} /></li>)}</ul>
      ))}
    </section>
  );
}

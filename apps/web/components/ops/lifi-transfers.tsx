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
export function LifiTransfers({ client = api }: { client?: Client }) {
  const [opId, setOpId] = useState("");
  const [legId, setLegId] = useState("");
  const look = useMutation({ mutationFn: () => client.opsLifiTransfers(opId.trim(), legId.trim()) });
  return (
    <section aria-label="LI.FI transfers" className="space-y-3">
      <h2 className="font-display text-xl font-semibold text-ivory">LI.FI transfers for a leg</h2>
      <form className="grid max-w-xl gap-3" onSubmit={(e) => { e.preventDefault(); look.mutate(); }}>
        <label className="space-y-1 text-xs font-medium text-ivory">Operation ID<Input value={opId} onChange={(e) => setOpId(e.target.value)} className="min-h-11 bg-space font-mono text-ivory" /></label>
        <label className="space-y-1 text-xs font-medium text-ivory">Leg ID<Input value={legId} onChange={(e) => setLegId(e.target.value)} className="min-h-11 bg-space font-mono text-ivory" /></label>
        <Button type="submit" className="min-h-11 w-fit" disabled={look.isPending || !opId.trim() || !legId.trim()}>Look up</Button>
      </form>
      {look.error ? <OpsError error={look.error} /> : null}
      {look.data && (look.data.transfers.length === 0 ? <p className="text-sm text-stone">LI.FI has no transfer for {look.data.wallet} in that window.</p> : (
        <ul className="space-y-2">{look.data.transfers.map((t, n) => <li key={n}><pre className="overflow-x-auto rounded-xl border border-border-dark p-3 text-xs text-stone">{JSON.stringify(t, null, 2)}</pre></li>)}</ul>
      ))}
    </section>
  );
}

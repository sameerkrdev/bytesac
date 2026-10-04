"use client";

import type { PayoutWalletDecisionRequest, PayoutWalletView } from "@repo/validator";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const Wallet = ({ title, w }: { title: string; w: PayoutWalletView | undefined }) => (
  <div className="space-y-1 rounded-tile border border-line p-3">
    <p className="text-xs text-ink-muted">{title}</p>
    {w ? (
      <>
        <p className="break-all font-mono text-sm text-ink">{w.address}</p>
        <p className="text-xs text-ink-muted">Signature verified {w.verifiedAt ? new Date(w.verifiedAt).toLocaleString() : "—"}</p>
      </>
    ) : <p className="text-sm text-ink-muted">None</p>}
  </div>
);

export function OrganizationPayoutChange({ current, proposed, pending, onDecide }: { current: PayoutWalletView | undefined; proposed: PayoutWalletView; pending: boolean; onDecide(body: PayoutWalletDecisionRequest): void }) {
  const id = useId();
  const [note, setNote] = useState("");
  const body = (decision: PayoutWalletDecisionRequest["decision"]): PayoutWalletDecisionRequest => ({ decision, internalNote: note.trim() || undefined });
  return (
    <section aria-labelledby={`${id}-h`} className="max-w-xl space-y-4">
      <h2 id={`${id}-h`} className="type-heading text-ink">Payout wallet change</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Wallet title="Current wallet" w={current} />
        <Wallet title="New wallet" w={proposed} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-note`} className="text-xs font-medium text-ink">Internal note (optional)</Label>
        <Textarea id={`${id}-note`} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button  disabled={pending} onClick={() => onDecide(body("approved"))}>Approve wallet change</Button>
        <Button variant="destructive"  disabled={pending} onClick={() => onDecide(body("rejected"))}>Reject wallet change</Button>
      </div>
    </section>
  );
}

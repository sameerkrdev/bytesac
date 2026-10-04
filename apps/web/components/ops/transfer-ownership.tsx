"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { MEMBERSHIP_ROLE_LABEL } from "@repo/app-core";
import { transferOwnershipRequestSchema, type OrganizationReviewDetail } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useMe } from "@/components/me-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

type Client = Pick<ApiClient, "opsTransferOwnership">;

/** ops_admin only (UI guard; the API re-checks). Targets: active members with an approved verification. */
export function TransferOwnership({ org, client = api }: { org: OrganizationReviewDetail; client?: Client }) {
  const id = useId();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const transfer = useMutation({
    mutationFn: (body: { targetMembershipId: string; reason: string }) => client.opsTransferOwnership(org.id, body),
    onSuccess: () => { setOpen(false); setTarget(""); setReason(""); void qc.invalidateQueries({ queryKey: ["ops", "organization", org.id] }); },
  });

  if (!me?.platformRoles.includes("ops_admin")) return null;
  const targets = org.members.filter((m) => m.status === "ACTIVE" && m.role !== "OWNER" && m.verificationApproved);
  // The API's own message is specific ("This member must complete verification first.").
  const error = transfer.error instanceof ApiError && transfer.error.code === "INVALID_TRANSITION" ? transfer.error.message : transfer.isError ? toDisplayError(transfer.error).title : null;

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3">
      <h2 id={`${id}-h`} className="type-heading text-ink">Ownership</h2>
      <p className="text-xs text-ink-muted">Only on the owner&apos;s request through support. The current owner becomes an admin.</p>
      <Button variant="secondary"  onClick={() => setOpen(true)}>Transfer ownership</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-line bg-canvas">
          <DialogHeader>
            <DialogTitle className="text-ink">Transfer ownership</DialogTitle>
            <DialogDescription>The new owner must be an active member with an approved identity verification. This is audited with your reason.</DialogDescription>
          </DialogHeader>
          <form id={`${id}-f`} noValidate className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            const parsed = transferOwnershipRequestSchema.safeParse({ targetMembershipId: target, reason });
            if (!parsed.success) return setFieldError(parsed.error.issues[0]?.path[0] === "reason" ? "Give a reason of 10 to 1000 characters." : "Pick a new owner.");
            setFieldError(null);
            transfer.mutate(parsed.data);
          }}>
            <div className="space-y-2">
              <Label htmlFor={`${id}-t`} className="text-xs font-medium text-ink">New owner</Label>
              <Select id={`${id}-t`} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Select a member</option>
                {targets.map((m) => <option key={m.id} value={m.id}>{m.publicDisplayName ?? `Member ${m.id.slice(0, 8)}`} · {MEMBERSHIP_ROLE_LABEL[m.role]}</option>)}
              </Select>
              {targets.length === 0 && <p className="text-xs text-ink-muted">No active member has an approved verification yet.</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-r`} className="text-xs font-medium text-ink">Reason (10 to 1000 characters)</Label>
              <Textarea id={`${id}-r`} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
            </div>
            {(fieldError ?? error) && <p role="alert" className="text-sm text-danger">{fieldError ?? error}</p>}
          </form>
          <DialogFooter>
            <Button variant="secondary"  onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" form={`${id}-f`} variant="destructive"  disabled={transfer.isPending}>{transfer.isPending && <Loader2 aria-hidden className="animate-spin" />}Confirm transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

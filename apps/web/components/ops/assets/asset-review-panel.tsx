"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSET_REQUIREMENT_LABEL } from "@repo/app-core";
import { INSTRUMENT_TRANSITIONS, type AssetDecisionRequest, type OpsAssetDetail } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { useMe } from "@/components/me-context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { AssetError, ConfirmAction } from "./asset-ui";

type Client = Pick<ApiClient, "opsSubmitAsset" | "opsDecideAsset" | "opsAssetAction">;
type Lifecycle = Parameters<Client["opsAssetAction"]>[1];

const LIFECYCLE_COPY: Record<Lifecycle, string> = {
  activate: "Make this asset live for signed-in users. Approved deployments and routes go live with it.",
  pause: "Hide this asset and all its deployments and routes from users until it is resumed.",
  resume: "Make this asset visible to users again.",
  deprecate: "Stop offering this asset to users. It can only be retired afterwards.",
  retire: "Retire this asset permanently. Its deployments and routes are retired too, and nothing can be edited afterwards.",
};

export function AssetDecisionForm({ pending, onSubmit }: { pending: boolean; onSubmit(body: AssetDecisionRequest): void }) {
  const id = useId();
  const [decision, setDecision] = useState<AssetDecisionRequest["decision"] | "">("");
  const [message, setMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const needsMessage = decision === "changes_required";
  const ready = decision !== "" && (!needsMessage || message.trim().length > 0);
  return (
    <form className="max-w-xl space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (decision === "" || !ready) return;
      onSubmit({ decision, message: message.trim() || undefined, internalNote: internalNote.trim() || undefined });
    }}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-d`} className="text-xs font-medium text-ivory">Decision</Label>
        <Select id={`${id}-d`} value={decision} onChange={(e) => setDecision(e.target.value as AssetDecisionRequest["decision"] | "")}>
          <option value="">Select a decision</option>
          <option value="approved">Approve</option>
          <option value="changes_required">Changes required</option>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-m`} className="text-xs font-medium text-ivory">{needsMessage ? "Message to the editor (required)" : "Message to the editor (optional)"}</Label>
        <Textarea id={`${id}-m`} value={message} maxLength={2000} required={needsMessage} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-n`} className="text-xs font-medium text-ivory">Internal note (optional)</Label>
        <Textarea id={`${id}-n`} value={internalNote} maxLength={2000} onChange={(e) => setInternalNote(e.target.value)} />
      </div>
      <Button type="submit" className="min-h-11" disabled={!ready || pending}>{pending && <Loader2 aria-hidden className="animate-spin" />}Submit decision</Button>
    </form>
  );
}

export function AssetReviewPanel({ a, onChange, isAdmin, client = api }: { a: OpsAssetDetail; isAdmin: boolean; onChange(d: OpsAssetDetail): void; client?: Client }) {
  const { data: me } = useMe();
  const submit = useMutation({ mutationFn: () => client.opsSubmitAsset(a.id), onSuccess: onChange });
  const decide = useMutation({ mutationFn: (b: AssetDecisionRequest) => client.opsDecideAsset(a.id, b), onSuccess: onChange });
  const lifecycle = useMutation({ mutationFn: (action: Lifecycle) => client.opsAssetAction(a.id, action), onSuccess: onChange });
  const error = [submit, decide, lifecycle].find((m) => m.isError)?.error;
  const editing = a.status === "DRAFT" || a.status === "CHANGES_REQUIRED";
  const actions = INSTRUMENT_TRANSITIONS[a.status].flatMap((to): Lifecycle[] =>
    to === "ACTIVE" ? [a.status === "PAUSED" ? "resume" : "activate"] : to === "PAUSED" ? ["pause"] : to === "DEPRECATED" ? ["deprecate"] : to === "RETIRED" ? ["retire"] : []);

  return (
    <section aria-labelledby="review-h" className="space-y-4">
      <h2 id="review-h" className="font-display text-xl font-semibold text-ivory">Review</h2>
      {editing && (
        <div className="space-y-3">
          {a.missing.length === 0 ? <p className="text-sm text-stone">Every requirement is met.</p> : (
            <>
              <p className="text-sm text-ivory">Before this can be submitted:</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-stone">
                {a.missing.map((k) => <li key={k}>{ASSET_REQUIREMENT_LABEL[k as keyof typeof ASSET_REQUIREMENT_LABEL] ?? k}</li>)}
              </ul>
            </>
          )}
          <Button type="button" className="min-h-11" disabled={a.missing.length > 0 || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending && <Loader2 aria-hidden className="animate-spin" />}{a.status === "CHANGES_REQUIRED" ? "Resubmit for review" : "Submit for review"}
          </Button>
        </div>
      )}
      {a.status === "UNDER_REVIEW" && isAdmin && (
        a.submittedByUserId === me?.user.id
          ? <p role="status" className="rounded-xl border border-border-dark bg-slate p-4 text-sm text-ivory">You submitted this asset — another admin must review it.</p>
          : <AssetDecisionForm pending={decide.isPending} onSubmit={(b) => decide.mutate(b)} />
      )}
      {a.status === "UNDER_REVIEW" && !isAdmin && <p className="text-sm text-stone">Waiting for an admin to review this asset.</p>}
      {isAdmin && actions.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Lifecycle">
          {actions.map((action) => (
            <ConfirmAction key={action} label={action.charAt(0).toUpperCase() + action.slice(1)} destructive={action === "retire" || action === "deprecate"}
              pending={lifecycle.isPending} description={LIFECYCLE_COPY[action]} onConfirm={() => lifecycle.mutate(action)} />
          ))}
        </div>
      )}
      {error && <AssetError error={error} />}
    </section>
  );
}

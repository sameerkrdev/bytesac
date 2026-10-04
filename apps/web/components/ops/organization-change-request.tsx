"use client";

import { ORGANIZATION_DOCUMENT_TYPES, ORGANIZATION_FIELDS, ORGANIZATION_FIELD_KEYS, type DocumentTypeKey, type VersionDecisionRequest, type VersionView } from "@repo/validator";
import { Loader2, PencilLine } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const pick = (v: VersionView, k: string) => str({ ...v.privateDetails, ...v.publicProfile }[k]);
const docLabel = (type: string) => ORGANIZATION_DOCUMENT_TYPES[type as DocumentTypeKey]?.label ?? type;

/** Current approved version beside the proposed one: changed rows are marked with an icon and text. */
export function OrganizationChangeRequest({ current, proposed, pending, onDecide }: { current: VersionView; proposed: VersionView; pending: boolean; onDecide(body: VersionDecisionRequest): void }) {
  const id = useId();
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const rows = ORGANIZATION_FIELD_KEYS.filter((k) => pick(current, k) || pick(proposed, k));
  const currentIds = new Set(current.documents.map((d) => d.id));
  const proposedIds = new Set(proposed.documents.map((d) => d.id));
  const added = proposed.documents.filter((d) => !currentIds.has(d.id));
  const removed = current.documents.filter((d) => !proposedIds.has(d.id));
  const body = (decision: VersionDecisionRequest["decision"]): VersionDecisionRequest => ({ decision, internalNote: note.trim() || undefined, messageToOwner: message.trim() || undefined });

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <h2 id={`${id}-h`} className="type-heading text-ink">Change request (version {proposed.versionNumber})</h2>
      <div className="relative overflow-x-auto"><table className="min-w-[36rem] w-full text-left text-sm">
        <thead className="text-xs text-ink-muted"><tr><th className="py-2 pr-4 font-medium">Field</th><th className="pr-4 font-medium">Current</th><th className="font-medium">Proposed</th></tr></thead>
        <tbody>
          {rows.map((k) => {
            const changed = pick(current, k) !== pick(proposed, k);
            return (
              <tr key={k} className={changed ? "border-t border-warning/25 bg-warning-soft align-top" : "border-t border-line align-top"}>
                <th scope="row" className="py-2 pr-4 font-medium text-ink">
                  {ORGANIZATION_FIELDS[k].label}
                  {changed && <span className="mt-1 flex items-center gap-1 text-xs font-medium text-warning"><PencilLine aria-hidden className="size-3.5" />Changed</span>}
                </th>
                <td className="whitespace-pre-wrap pr-4 text-ink-muted">{pick(current, k) || "—"}</td>
                <td className="whitespace-pre-wrap text-ink">{pick(proposed, k) || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <div className="space-y-1 text-sm text-ink">
        <p className="text-xs text-ink-muted">Documents</p>
        {added.length === 0 && removed.length === 0 && <p className="text-ink-muted">No document changes.</p>}
        {added.map((d) => <p key={d.id}>Added: {docLabel(d.documentType)}</p>)}
        {removed.map((d) => <p key={d.id}>Removed: {docLabel(d.documentType)}</p>)}
      </div>

      {proposed.status === "in_review" ? (
        <form className="max-w-xl space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-2">
            <Label htmlFor={`${id}-msg`} className="text-xs font-medium text-ink">Message to owner (required to request changes)</Label>
            <Textarea id={`${id}-msg`} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-note`} className="text-xs font-medium text-ink">Internal note (optional, never shown to the owner)</Label>
            <Textarea id={`${id}-note`} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button"  disabled={pending} onClick={() => onDecide(body("approved"))}>{pending && <Loader2 aria-hidden className="animate-spin" />}Approve</Button>
            <Button type="button" variant="secondary"  disabled={pending || !message.trim()} onClick={() => onDecide(body("changes_required"))}>Request changes</Button>
            <Button type="button" variant="destructive"  disabled={pending} onClick={() => onDecide(body("rejected"))}>Reject</Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-ink-muted">Waiting for the owner to resubmit.</p>
      )}
    </section>
  );
}

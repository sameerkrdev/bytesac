"use client";

import { APPLICATION_STATUS_LABEL } from "@repo/app-core";
import { APPLICATION_TRANSITIONS, type ApplicationStatus, type TransitionApplicationRequest } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function TransitionForm({ status, pending, walletProven, onSubmit }: { status: ApplicationStatus; walletProven?: boolean; pending: boolean; onSubmit(body: TransitionApplicationRequest): void }) {
  const id = useId();
  // A wallet-proven approval cannot be rejected (the API answers 409), so no option is offered.
  const targets = status === "SCREENING_APPROVED" && walletProven ? [] : APPLICATION_TRANSITIONS[status];
  const [to, setTo] = useState<ApplicationStatus | "">("");
  const [internalNote, setInternalNote] = useState("");
  const [message, setMessage] = useState("");
  if (targets.length === 0) return <p className="text-sm text-ink-muted">No further status changes are possible.</p>;

  const needsMessage = to === "ADDITIONAL_INFORMATION_REQUIRED";
  const ready = to !== "" && (!needsMessage || message.trim().length > 0);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (!ready) return;
      onSubmit({ to, internalNote: internalNote.trim() || undefined, messageToApplicant: message.trim() || undefined });
    }}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-to`} className="text-xs font-medium text-ink">Move to</Label>
        <Select id={`${id}-to`} value={to} onChange={(e) => setTo(e.target.value as ApplicationStatus | "")}>
          <option value="">Select a status</option>
          {targets.map((t) => <option key={t} value={t}>{APPLICATION_STATUS_LABEL[t].label}</option>)}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-note`} className="text-xs font-medium text-ink">Internal note (optional, never shown to the applicant)</Label>
        <Textarea id={`${id}-note`} value={internalNote} maxLength={4000} onChange={(e) => setInternalNote(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-msg`} className="text-xs font-medium text-ink">{needsMessage ? "Message to applicant (required)" : "Message to applicant (optional)"}</Label>
        <Textarea id={`${id}-msg`} value={message} maxLength={4000} required={needsMessage} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <Button type="submit"  disabled={!ready || pending}>
        {pending && <Loader2 aria-hidden className="animate-spin" />}Update status
      </Button>
    </form>
  );
}

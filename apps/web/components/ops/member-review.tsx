"use client";

import type { ApiClient } from "@repo/api-client";
import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL, MEMBER_VERIFICATION_STATUS_LABEL } from "@repo/app-core";
import {
  CHAINS, ORGANIZATION_DOCUMENT_TYPES, ORGANIZATION_FIELDS, ORGANIZATION_FIELD_KEYS, type DecideMemberVerificationRequest, type DocumentTypeKey, type MemberReviewDetail,
} from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsGetMember" | "opsDecideMember">;
type Decision = DecideMemberVerificationRequest["decision"];

const DECISIONS: Array<{ value: Decision; label: string }> = [
  { value: "approved", label: "Approve" }, { value: "changes_required", label: "Changes required" }, { value: "rejected", label: "Reject" },
];
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function MemberDecisionForm({ pending, onSubmit }: { pending: boolean; onSubmit(body: DecideMemberVerificationRequest): void }) {
  const id = useId();
  const [decision, setDecision] = useState<Decision | "">("");
  const [message, setMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const needsMessage = decision === "changes_required";
  const ready = decision !== "" && (!needsMessage || message.trim().length > 0);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (decision === "" || !ready) return;
      onSubmit({ decision, messageToMember: message.trim() || undefined, internalNote: internalNote.trim() || undefined });
    }}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-d`} className="text-xs font-medium text-ivory">Decision</Label>
        <Select id={`${id}-d`} value={decision} onChange={(e) => setDecision(e.target.value as Decision | "")}>
          <option value="">Select a decision</option>
          {DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-m`} className="text-xs font-medium text-ivory">{needsMessage ? "Message to member (required)" : "Message to member (optional)"}</Label>
        <Textarea id={`${id}-m`} value={message} maxLength={4000} required={needsMessage} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-n`} className="text-xs font-medium text-ivory">Internal note (optional, never shown to the member)</Label>
        <Textarea id={`${id}-n`} value={internalNote} maxLength={4000} onChange={(e) => setInternalNote(e.target.value)} />
      </div>
      <Button type="submit" className="min-h-11" disabled={!ready || pending}>{pending && <Loader2 aria-hidden className="animate-spin" />}Submit decision</Button>
    </form>
  );
}

export function MemberReview({ mid, client = api }: { mid: string; client?: Client }) {
  const qc = useQueryClient();
  const key = ["ops", "member", mid];
  const query = useQuery({ queryKey: key, queryFn: () => client.opsGetMember(mid), retry: false });
  const decide = useMutation({
    mutationFn: (body: DecideMemberVerificationRequest) => client.opsDecideMember(mid, body),
    onSuccess: (d: MemberReviewDetail) => { qc.setQueryData(key, d); void qc.invalidateQueries({ queryKey: ["ops", "members"] }); },
  });

  if (query.isError) return <OpsError error={query.error} />;
  const m = query.data;
  if (!m) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;

  const details = m.verification?.details ?? {};
  const keys = ORGANIZATION_FIELD_KEYS.filter((k) => str(details[k]));
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold text-ivory">Member of {m.organization.displayName ?? "an unnamed organization"}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge {...MEMBERSHIP_STATUS_LABEL[m.status]} />
          {m.verification && <StatusBadge {...MEMBER_VERIFICATION_STATUS_LABEL[m.verification.status]} label={`Verification: ${MEMBER_VERIFICATION_STATUS_LABEL[m.verification.status].label}`} />}
          <span className="text-sm text-stone">{MEMBERSHIP_ROLE_LABEL[m.role]}{m.requestedRole && ` → ${MEMBERSHIP_ROLE_LABEL[m.requestedRole]} (requested)`}</span>
          <Link href={`/ops/organizations/${m.organization.id}`} className="text-sm text-mint underline">View organization</Link>
        </div>
      </div>

      <section aria-labelledby="wallets-h" className="space-y-2">
        <h2 id="wallets-h" className="font-display text-xl font-semibold text-ivory">Wallets</h2>
        {m.addresses.length === 0 ? <p className="text-sm text-stone">No linked wallet.</p> : (
          <ul className="space-y-1">{m.addresses.map((a) => <li key={`${a.chain}:${a.address}`} className="break-all font-mono text-xs text-stone">{CHAINS[a.chain].label} · {a.address}</li>)}</ul>
        )}
      </section>

      <section aria-label="Verification details" className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ivory">Verification details</h2>
        {keys.length === 0 ? <p className="text-sm text-stone">Nothing entered.</p> : (
          <dl className="grid gap-4 md:grid-cols-2">
            {keys.map((k) => (
              <div key={k}>
                <dt className="text-xs text-stone">{ORGANIZATION_FIELDS[k].label}</dt>
                <dd className="whitespace-pre-wrap text-sm text-ivory">{str(details[k])}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="mdocs-h" className="space-y-3">
        <h2 id="mdocs-h" className="font-display text-xl font-semibold text-ivory">Documents</h2>
        {!m.verification || m.verification.documents.length === 0 ? <p className="text-sm text-stone">No documents.</p> : (
          <ul className="divide-y divide-border-dark">
            {m.verification.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-medium text-ivory">{ORGANIZATION_DOCUMENT_TYPES[d.documentType as DocumentTypeKey]?.label ?? d.documentType}</span>
                <span className="text-xs text-stone">{d.contentType} · {(d.sizeBytes / 1024).toFixed(0)} KB · {d.status}</span>
                {d.status === "uploaded" && (
                  <a href={`/api/v1/ops/members/${m.id}/documents/${d.id}/download`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-mint underline">
                    <Download aria-hidden className="size-4" />Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="mhistory-h" className="space-y-3">
        <h2 id="mhistory-h" className="font-display text-xl font-semibold text-ivory">Timeline</h2>
        <ol className="space-y-3">
          {m.events.map((e) => (
            <li key={e.id} className={e.internalNote ? "rounded-xl border border-warning/40 bg-warning/5 p-3" : "rounded-xl border border-border-dark p-3"}>
              <p className="text-xs text-stone">
                {new Date(e.createdAt).toLocaleString()} · {e.actorType} · {e.kind.replaceAll("_", " ")}{e.decision && `: ${e.decision.replaceAll("_", " ")}`}
                {e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && ` · ${MEMBERSHIP_STATUS_LABEL[e.fromStatus].label} → ${MEMBERSHIP_STATUS_LABEL[e.toStatus].label}`}
                {e.fromRole && e.toRole && e.fromRole !== e.toRole && ` · ${MEMBERSHIP_ROLE_LABEL[e.fromRole]} → ${MEMBERSHIP_ROLE_LABEL[e.toRole]}`}
              </p>
              {e.reason && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="text-stone">Reason: </span>{e.reason}</p>}
              {e.internalNote && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="mr-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-medium text-warning">Internal</span>{e.internalNote}</p>}
              {e.messageToMember && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="text-stone">To member: </span>{e.messageToMember}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="mdecision-h" className="max-w-xl space-y-4">
        <h2 id="mdecision-h" className="font-display text-xl font-semibold text-ivory">Decision</h2>
        {m.verification?.status === "in_review"
          ? <MemberDecisionForm pending={decide.isPending} onSubmit={(b) => decide.mutate(b)} />
          : <p className="text-sm text-muted-foreground">Nothing to decide: the member has no verification in review.</p>}
      </section>
      {decide.isError && <OpsError error={decide.error} />}
    </div>
  );
}

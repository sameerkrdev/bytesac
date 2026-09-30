"use client";

import type { ApiClient } from "@repo/api-client";
import { ORGANIZATION_STATUS_LABEL, PAYOUT_WALLET_STATUS_LABEL } from "@repo/app-core";
import {
  CHAINS, ORGANIZATION_DOCUMENT_TYPES, ORGANIZATION_FIELDS, ORGANIZATION_FIELD_KEYS, ORGANIZATION_TRANSITIONS,
  type DocumentTypeKey, type OrganizationReviewDetail, type OrganizationStatus, type TransitionOrganizationRequest, type VersionView,
} from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { OpsError } from "./ops-error";
import { OrganizationChangeRequest } from "./organization-change-request";
import { OrganizationPayoutChange } from "./organization-payout-change";

type Client = Pick<ApiClient, "opsGetOrganization" | "opsTransitionOrganization" | "opsDecideOrganizationVersion" | "opsDecidePayoutWallet" | "opsAddOrganizationNote">;

export function OrganizationTransitionForm({ status, pending, onSubmit }: { status: OrganizationStatus; pending: boolean; onSubmit(body: TransitionOrganizationRequest): void }) {
  const id = useId();
  const targets = ORGANIZATION_TRANSITIONS[status];
  const [to, setTo] = useState<OrganizationStatus | "">("");
  const [internalNote, setInternalNote] = useState("");
  const [message, setMessage] = useState("");
  if (targets.length === 0) return <p className="text-sm text-muted-foreground">No further status changes are possible.</p>;

  const needsMessage = to === "CHANGES_REQUIRED";
  const ready = to !== "" && (!needsMessage || message.trim().length > 0);
  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      if (!ready) return;
      onSubmit({ to, internalNote: internalNote.trim() || undefined, messageToOwner: message.trim() || undefined });
    }}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-to`} className="text-xs font-medium text-ivory">Move to</Label>
        <Select id={`${id}-to`} value={to} onChange={(e) => setTo(e.target.value as OrganizationStatus | "")}>
          <option value="">Select a status</option>
          {targets.map((t) => <option key={t} value={t}>{ORGANIZATION_STATUS_LABEL[t].label}</option>)}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-note`} className="text-xs font-medium text-ivory">Internal note (optional, never shown to the owner)</Label>
        <Textarea id={`${id}-note`} value={internalNote} maxLength={4000} onChange={(e) => setInternalNote(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-msg`} className="text-xs font-medium text-ivory">{needsMessage ? "Message to owner (required)" : "Message to owner (optional)"}</Label>
        <Textarea id={`${id}-msg`} value={message} maxLength={4000} required={needsMessage} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <Button type="submit" className="min-h-11" disabled={!ready || pending}>{pending && <Loader2 aria-hidden className="animate-spin" />}Update status</Button>
    </form>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function Fields({ title, version, visibility }: { title: string; version: VersionView | undefined; visibility: "public" | "private" }) {
  const values: Record<string, unknown> = { ...version?.publicProfile, ...version?.privateDetails };
  const keys = ORGANIZATION_FIELD_KEYS.filter((k) => ORGANIZATION_FIELDS[k].visibility === visibility && str(values[k]));
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="font-display text-xl font-semibold text-ivory">{title}</h2>
      {keys.length === 0 ? <p className="text-sm text-stone">Nothing entered.</p> : (
        <dl className="grid gap-4 md:grid-cols-2">
          {keys.map((k) => (
            <div key={k}>
              <dt className="text-xs text-stone">{ORGANIZATION_FIELDS[k].label}</dt>
              <dd className="whitespace-pre-wrap text-sm text-ivory">{str(values[k])}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function OrganizationReviewView({ id, client = api }: { id: string; client?: Client }) {
  const noteId = useId();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const key = ["ops", "organization", id];
  const query = useQuery({ queryKey: key, queryFn: () => client.opsGetOrganization(id), retry: false });
  const onSuccess = (d: OrganizationReviewDetail) => { qc.setQueryData(key, d); void qc.invalidateQueries({ queryKey: ["ops", "organizations"] }); };
  const transition = useMutation({ mutationFn: (b: TransitionOrganizationRequest) => client.opsTransitionOrganization(id, b), onSuccess });
  const decideVersion = useMutation({ mutationFn: (v: { versionId: string; body: Parameters<Client["opsDecideOrganizationVersion"]>[2] }) => client.opsDecideOrganizationVersion(id, v.versionId, v.body), onSuccess });
  const decideWallet = useMutation({ mutationFn: (v: { walletId: string; body: Parameters<Client["opsDecidePayoutWallet"]>[2] }) => client.opsDecidePayoutWallet(id, v.walletId, v.body), onSuccess });
  const addNote = useMutation({ mutationFn: () => client.opsAddOrganizationNote(id, { internalNote: note.trim() }), onSuccess: (d) => { setNote(""); onSuccess(d); } });

  if (query.isError) return <OpsError error={query.error} />;
  const o = query.data;
  if (!o) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;

  const current = o.versions.find((v) => v.id === o.currentVersionId);
  const latest = [...o.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const shown = current ?? latest;
  const proposed = current ? o.versions.find((v) => v.status === "in_review" || v.status === "changes_required") : undefined;
  const replacement = o.payoutWallets.find((w) => w.status === "REPLACEMENT_PENDING");
  const activeWallet = o.payoutWallets.find((w) => w.status === "VERIFIED");
  const errors = [transition, decideVersion, decideWallet, addNote].find((m) => m.isError)?.error;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold text-ivory">{str(shown?.publicProfile.displayName) || "Unnamed organization"}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge {...ORGANIZATION_STATUS_LABEL[o.status]} />
          <span className="text-sm text-stone">{o.type === "firm" ? "Firm" : "Individual"} · {o.jurisdiction}</span>
        </div>
      </div>

      <section aria-labelledby="owner-h" className="space-y-2">
        <h2 id="owner-h" className="font-display text-xl font-semibold text-ivory">Owner</h2>
        <p className="break-all font-mono text-sm text-ivory">User {o.owner.userId ?? "unknown"}</p>
        <ul className="space-y-1">
          {o.owner.addresses.map((a) => <li key={`${a.chain}:${a.address}`} className="break-all font-mono text-xs text-stone">{CHAINS[a.chain].label} · {a.address}</li>)}
        </ul>
      </section>

      <Fields title="Public profile" version={shown} visibility="public" />
      <Fields title="Private details" version={shown} visibility="private" />

      <section aria-labelledby="docs-h" className="space-y-3">
        <h2 id="docs-h" className="font-display text-xl font-semibold text-ivory">Documents</h2>
        {o.documents.length === 0 ? <p className="text-sm text-stone">No documents.</p> : (
          <ul className="divide-y divide-border-dark">
            {o.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <span className="font-medium text-ivory">{ORGANIZATION_DOCUMENT_TYPES[d.documentType as DocumentTypeKey]?.label ?? d.documentType}</span>
                <span className="text-xs text-stone">{d.contentType} · {(d.sizeBytes / 1024).toFixed(0)} KB · {d.status}</span>
                {d.status === "uploaded" && (
                  <a href={`/api/v1/ops/organizations/${o.id}/documents/${d.id}/download`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 text-mint underline">
                    <Download aria-hidden className="size-4" />Download
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wallet-h" className="space-y-3">
        <h2 id="wallet-h" className="font-display text-xl font-semibold text-ivory">Payout wallet</h2>
        {o.payoutWallets.length === 0 ? <p className="text-sm text-stone">No payout wallet.</p> : (
          <ul className="divide-y divide-border-dark">
            {o.payoutWallets.map((w) => (
              <li key={w.id} className="space-y-1 py-3">
                <p className="break-all font-mono text-sm text-ivory">{w.address}</p>
                <div className="flex flex-wrap items-center gap-3 text-xs text-stone">
                  <StatusBadge {...PAYOUT_WALLET_STATUS_LABEL[w.status]} />
                  <span>Signed {w.verifiedAt ? new Date(w.verifiedAt).toLocaleDateString() : "—"}</span>
                  {w.activatedAt && <span>Activated {new Date(w.activatedAt).toLocaleDateString()}</span>}
                  {w.deactivatedAt && <span>Deactivated {new Date(w.deactivatedAt).toLocaleDateString()}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {current && proposed && <OrganizationChangeRequest current={current} proposed={proposed} pending={decideVersion.isPending} onDecide={(body) => decideVersion.mutate({ versionId: proposed.id, body })} />}
      {replacement && <OrganizationPayoutChange current={activeWallet} proposed={replacement} pending={decideWallet.isPending} onDecide={(body) => decideWallet.mutate({ walletId: replacement.id, body })} />}

      <section aria-labelledby="history-h" className="space-y-3">
        <h2 id="history-h" className="font-display text-xl font-semibold text-ivory">Timeline</h2>
        <ol className="space-y-3">
          {o.events.map((e) => (
            <li key={e.id} className={e.internalNote ? "rounded-xl border border-warning/40 bg-warning/5 p-3" : "rounded-xl border border-border-dark p-3"}>
              <p className="text-xs text-stone">
                {new Date(e.createdAt).toLocaleString()} · {e.actorType} · {e.kind.replaceAll("_", " ")}{e.decision && `: ${e.decision.replaceAll("_", " ")}`}
                {e.fromStatus && e.toStatus && ` · ${ORGANIZATION_STATUS_LABEL[e.fromStatus].label} → ${ORGANIZATION_STATUS_LABEL[e.toStatus].label}`}
              </p>
              {e.internalNote && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="mr-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-medium text-warning">Internal</span>{e.internalNote}</p>}
              {e.messageToOwner && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="text-stone">To owner: </span>{e.messageToOwner}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="action-h" className="max-w-xl space-y-4">
        <h2 id="action-h" className="font-display text-xl font-semibold text-ivory">Change status</h2>
        <OrganizationTransitionForm key={o.status} status={o.status} pending={transition.isPending} onSubmit={(b) => transition.mutate(b)} />
      </section>

      <section aria-labelledby="note-h" className="max-w-xl space-y-3">
        <h2 id="note-h" className="font-display text-xl font-semibold text-ivory">Internal note</h2>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addNote.mutate(); }}>
          <Label htmlFor={noteId} className="text-xs font-medium text-ivory">Note (visible to ops only)</Label>
          <Textarea id={noteId} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" variant="secondary" className="min-h-11" disabled={!note.trim() || addNote.isPending}>{addNote.isPending && <Loader2 aria-hidden className="animate-spin" />}Add note</Button>
        </form>
      </section>
      {errors && <OpsError error={errors} />}
    </div>
  );
}


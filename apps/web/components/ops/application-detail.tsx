"use client";

import type { ApiClient } from "@repo/api-client";
import { APPLICATION_STATUS_LABEL, shortAddress } from "@repo/app-core";
import { CHAINS, type ApplicationDetail } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";
import { OpsError } from "./ops-error";
import { TransitionForm } from "./transition-form";

type Client = Pick<ApiClient, "opsGetApplication" | "opsTransitionApplication" | "opsAddApplicationNote">;

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-stone">{label}</dt>
      <dd className="whitespace-pre-wrap text-sm text-ivory">{value}</dd>
    </div>
  );
}

export function ApplicationDetailView({ id, client = api }: { id: string; client?: Client }) {
  const noteId = useId();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const key = ["ops", "application", id];
  const query = useQuery({ queryKey: key, queryFn: () => client.opsGetApplication(id), retry: false });
  const onSuccess = (d: ApplicationDetail) => { qc.setQueryData(key, d); void qc.invalidateQueries({ queryKey: ["ops", "applications"] }); };
  const transition = useMutation({ mutationFn: (b: Parameters<Client["opsTransitionApplication"]>[1]) => client.opsTransitionApplication(id, b), onSuccess });
  const addNote = useMutation({ mutationFn: () => client.opsAddApplicationNote(id, note.trim()), onSuccess: (d) => { setNote(""); onSuccess(d); } });

  if (query.isError) return <OpsError error={query.error} />;
  const a = query.data;
  if (!a) return <LoadingState />;
  const label = APPLICATION_STATUS_LABEL[a.status];

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <PageHeader title={a.firmName ?? a.fullName} breadcrumb={[{ label: "Ops", href: "/ops/applications" }, { label: "Applications", href: "/ops/applications" }]} />
        <StatusBadge {...label} />
      </div>

      <section aria-labelledby="applicant-h" className="space-y-3">
        <h2 id="applicant-h" className="font-display text-xl font-semibold text-ivory">Applicant</h2>
        <dl className="grid gap-4 md:grid-cols-2">
          <Field label="Name" value={a.fullName} />
          <Field label="Type" value={a.applicantType} />
          <Field label="Email" value={a.email} />
          <Field label="Phone" value={a.phone} />
          <Field label="Country" value={a.country} />
          <Field label="Website" value={a.website} />
          <div className="md:col-span-2"><Field label="Professional background" value={a.professionalBackground} /></div>
          <div className="md:col-span-2"><Field label="Investment experience" value={a.investmentExperience} /></div>
          <div className="md:col-span-2"><Field label="Qualifications" value={a.qualifications} /></div>
          <div className="md:col-span-2"><Field label="Reason" value={a.reason} /></div>
          <div className="md:col-span-2"><Field label="Intended baskets" value={a.intendedBaskets} /></div>
        </dl>
      </section>

      <section aria-labelledby="wallet-h" className="space-y-2">
        <h2 id="wallet-h" className="font-display text-xl font-semibold text-ivory">Wallet</h2>
        <p className="break-all font-mono text-sm text-ivory">{CHAINS[a.walletChain].label} · {a.walletAddress} <span className="text-stone">({shortAddress(a.walletAddress)})</span></p>
        {a.walletProvenAt
          ? <StatusBadge tone="success" label="Wallet proven" />
          : <StatusBadge tone="warning" label="Wallet not proven" />}
      </section>

      <section aria-labelledby="history-h" className="space-y-3">
        <h2 id="history-h" className="font-display text-xl font-semibold text-ivory">History</h2>
        <ol className="space-y-3">
          {a.events.map((e) => (
            <li key={e.id} className={e.internalNote ? "rounded-xl border border-warning/40 bg-warning/5 p-3" : "rounded-xl border border-border-dark p-3"}>
              <p className="text-xs text-stone">
                {new Date(e.createdAt).toLocaleString()} · {e.actorType}
                {e.fromStatus && e.toStatus && ` · ${APPLICATION_STATUS_LABEL[e.fromStatus].label} → ${APPLICATION_STATUS_LABEL[e.toStatus].label}`}
                {e.kind === "permission_granted" && " · permission granted"}
                {e.kind === "applicant_reply" && " · applicant reply"}
              </p>
              {e.internalNote && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="mr-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-medium text-warning">Internal</span>{e.internalNote}</p>}
              {e.messageToApplicant && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="text-stone">To applicant: </span>{e.messageToApplicant}</p>}
              {e.applicantMessage && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="text-stone">Applicant: </span>{e.applicantMessage}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="action-h" className="max-w-xl space-y-4">
        <h2 id="action-h" className="font-display text-xl font-semibold text-ivory">Change status</h2>
        <TransitionForm key={a.status} status={a.status} walletProven={a.walletProvenAt !== null} pending={transition.isPending} onSubmit={(b) => transition.mutate(b)} />
        {transition.isError && <OpsError error={transition.error} />}
      </section>

      <section aria-labelledby="note-h" className="max-w-xl space-y-3">
        <h2 id="note-h" className="font-display text-xl font-semibold text-ivory">Internal note</h2>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); addNote.mutate(); }}>
          <Label htmlFor={noteId} className="text-xs font-medium text-ivory">Note (visible to ops only)</Label>
          <Textarea id={noteId} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          <Button type="submit" variant="secondary" className="min-h-11" disabled={!note.trim() || addNote.isPending}>
            {addNote.isPending && <Loader2 aria-hidden className="animate-spin" />}Add note
          </Button>
        </form>
        {addNote.isError && <OpsError error={addNote.error} />}
      </section>
    </div>
  );
}

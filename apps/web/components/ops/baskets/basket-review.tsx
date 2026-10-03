"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { ASSIGNMENT_FLAG_LABEL, ASSIGNMENT_STATUS_LABEL, BASKET_ISSUE_LABEL, BASKET_SECTION_LABEL, BASKET_STATUS_LABEL, BASKET_VERSION_STATUS_LABEL } from "@repo/app-core";
import { BASKET_SECTIONS, REVIEW_CHECKLIST_KEYS, type BasketReviewDecisionRequest, type OpsBasketDetail } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { BasketView } from "@/components/baskets/basket-view";
import { ConfirmReason } from "@/components/baskets/confirm-reason";
import { DiffSummary } from "@/components/baskets/version-history";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { OpsError } from "@/components/ops/ops-error";

type Client = Pick<ApiClient, "opsGetBasket" | "opsDecideBasketVersion" | "opsDecideBasketLead" | "opsPauseBasket" | "opsResumeBasket" | "opsRetireBasket" | "opsDecideBasketRetirement">;
type Decision = BasketReviewDecisionRequest["decision"];
type Result = "pass" | "fail" | "na";

const CHECKLIST: Record<(typeof REVIEW_CHECKLIST_KEYS)[number], string> = {
  completeness: "A. Completeness", assets: "B. Assets", allocation: "C. Allocation", communication: "D. Communication", managers: "E. Managers", fees: "F. Fees", operations: "G. Operations",
};

export function BasketDecisionForm({ isAdmin, pending, onSubmit }: { isAdmin: boolean; pending: boolean; onSubmit(body: BasketReviewDecisionRequest): void }) {
  const id = useId();
  const [decision, setDecision] = useState<Decision | "">("");
  const [results, setResults] = useState<Partial<Record<keyof typeof CHECKLIST, Result>>>({});
  const [notes, setNotes] = useState<Partial<Record<keyof typeof CHECKLIST, string>>>({});
  const [comments, setComments] = useState<Array<{ section: (typeof BASKET_SECTIONS)[number]; comment: string }>>([]);
  const [section, setSection] = useState<(typeof BASKET_SECTIONS)[number]>("basics");
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const needsMessage = decision === "changes_required" || decision === "rejected";
  const needsNote = decision === "escalated";
  const ready = decision !== "" && REVIEW_CHECKLIST_KEYS.every((k) => results[k]) && (!needsMessage || message.trim().length > 0) && (!needsNote || internalNote.trim().length > 0);
  return (
    <form className="max-w-2xl space-y-5" onSubmit={(e) => {
      e.preventDefault();
      if (decision === "" || !ready) return;
      onSubmit({
        decision,
        checklist: Object.fromEntries(REVIEW_CHECKLIST_KEYS.map((k) => [k, { result: results[k] as Result, note: notes[k]?.trim() || undefined }])) as BasketReviewDecisionRequest["checklist"],
        sectionComments: comments.length > 0 ? comments : undefined,
        messageToManager: message.trim() || undefined,
        internalNote: internalNote.trim() || undefined,
      });
    }}>
      <div className="space-y-2">
        <Label htmlFor={`${id}-d`} className="text-xs font-medium text-ivory">Decision</Label>
        <Select id={`${id}-d`} value={decision} onChange={(e) => setDecision(e.target.value as Decision | "")}>
          <option value="">Select a decision</option>
          {isAdmin && <option value="approved">Approve</option>}
          <option value="changes_required">Changes required</option>
          <option value="rejected">Reject</option>
          <option value="escalated">Escalate</option>
        </Select>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs font-medium text-ivory">Checklist</legend>
        {REVIEW_CHECKLIST_KEYS.map((k) => (
          <div key={k} className="grid gap-2 sm:grid-cols-[11rem_8rem_1fr] sm:items-center">
            <Label htmlFor={`${id}-${k}`} className="text-sm text-ivory">{CHECKLIST[k]}</Label>
            <Select id={`${id}-${k}`} value={results[k] ?? ""} onChange={(e) => setResults((r) => ({ ...r, [k]: e.target.value as Result }))}>
              <option value="">Choose</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="na">Not applicable</option>
            </Select>
            <Input aria-label={`Note for ${CHECKLIST[k]}`} maxLength={500} value={notes[k] ?? ""} placeholder="Note (optional)" className="min-h-11 bg-space text-ivory" onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))} />
          </div>
        ))}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-medium text-ivory">Section comments (shown to the manager)</legend>
        {comments.map((c, i) => (
          <p key={i} className="flex flex-wrap items-center gap-3 text-sm text-ivory"><span className="text-stone">{BASKET_SECTION_LABEL[c.section]}:</span> {c.comment}
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setComments((l) => l.filter((_, n) => n !== i))}>Remove</Button></p>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-s`} className="text-xs text-stone">Section</Label>
            <Select id={`${id}-s`} className="w-auto" value={section} onChange={(e) => setSection(e.target.value as typeof section)}>
              {BASKET_SECTIONS.map((s) => <option key={s} value={s}>{BASKET_SECTION_LABEL[s]}</option>)}
            </Select>
          </div>
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor={`${id}-c`} className="text-xs text-stone">Comment</Label>
            <Input id={`${id}-c`} value={comment} maxLength={1000} className="min-h-11 bg-space text-ivory" onChange={(e) => setComment(e.target.value)} />
          </div>
          <Button type="button" variant="secondary" className="min-h-11" disabled={!comment.trim() || comments.length >= 30} onClick={() => { setComments((l) => [...l, { section, comment: comment.trim() }]); setComment(""); }}>Add comment</Button>
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor={`${id}-m`} className="text-xs font-medium text-ivory">{needsMessage ? "Message to manager (required)" : "Message to manager (optional)"}</Label>
        <Textarea id={`${id}-m`} value={message} maxLength={2000} required={needsMessage} onChange={(e) => setMessage(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-n`} className="text-xs font-medium text-ivory">{needsNote ? "Internal note (required, never shown to the manager)" : "Internal note (optional, never shown to the manager)"}</Label>
        <Textarea id={`${id}-n`} value={internalNote} maxLength={2000} required={needsNote} onChange={(e) => setInternalNote(e.target.value)} />
      </div>
      <Button type="submit" className="min-h-11" disabled={!ready || pending}>{pending && <Loader2 aria-hidden className="animate-spin" />}Submit decision</Button>
    </form>
  );
}

export function BasketReview({ bid, client = api }: { bid: string; client?: Client }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isAdmin = me?.platformRoles.includes("ops_admin") ?? false;
  const key = ["ops", "basket", bid];
  const query = useQuery({ queryKey: key, queryFn: () => client.opsGetBasket(bid), retry: false });
  const act = useMutation({
    mutationFn: (run: () => Promise<OpsBasketDetail>) => run(),
    onSuccess: (d) => { qc.setQueryData(key, d); void qc.invalidateQueries({ queryKey: ["ops", "baskets"] }); },
  });

  if (query.isError) return <OpsError error={query.error} />;
  const b = query.data;
  if (!b) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;

  const v = b.openVersion ?? b.publishedVersion;
  const names = Object.fromEntries([...(b.openVersion?.assets ?? []), ...(b.publishedVersion?.assets ?? [])].map((a) => [a.instrumentId, `${a.name} (${a.symbol})`]));
  const pendingLeads = b.assignments.filter((a) => a.role === "lead" && a.status === "PENDING_APPROVAL");
  const canRetire = ["ACTIVE", "PAUSED", "REASSIGNMENT_REQUIRED", "RETIREMENT_PENDING"].includes(b.status);
  // A 403 from a decision is the self-review block; show the server's own message.
  const failure = act.isError && (act.error instanceof ApiError && act.error.code === "FORBIDDEN"
    ? <p role="alert" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">{act.error.message}</p>
    : <OpsError error={act.error} />);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold text-ivory">{v?.name ?? "Basket"}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge {...BASKET_STATUS_LABEL[b.status]} />
          {b.openVersion && <StatusBadge {...BASKET_VERSION_STATUS_LABEL[b.openVersion.status]} label={`Version ${b.openVersion.versionNumber}: ${BASKET_VERSION_STATUS_LABEL[b.openVersion.status].label}`} />}
          <Link href={`/ops/organizations/${b.organization.id}`} className="text-sm text-mint underline">{b.organization.displayName ?? "Unnamed organization"}</Link>
          <span className="text-xs text-stone">Organization {b.organization.status.toLowerCase().replaceAll("_", " ")}</span>
          {b.hasAssetWarning && <span className="text-xs text-warning">An asset was paused or deprecated in the registry.</span>}
        </div>
        {b.status === "PAUSED" && <p className="text-sm text-stone">Paused by {b.pauseKind === "platform" ? "the platform" : "the manager"}{b.pauseReason && `: ${b.pauseReason}`}</p>}
      </div>
      {failure}

      {b.diff && <section aria-label="Changes from the published version" className="space-y-2"><h2 className="font-display text-xl font-semibold text-ivory">Changes from the published version</h2><DiffSummary diff={b.diff} names={names} /></section>}

      <section aria-label="Validation" className="space-y-2">
        <h2 className="font-display text-xl font-semibold text-ivory">Validation</h2>
        {!b.validation || (b.validation.issues.length === 0 && b.validation.warnings.length === 0) ? <p className="text-sm text-stone">No issues.</p> : (
          <ul className="space-y-1 text-sm">
            {b.validation.issues.map((i, n) => <li key={`e${n}`} className="text-danger">{BASKET_SECTION_LABEL[i.section]}: {BASKET_ISSUE_LABEL[i.code]}. {i.message}</li>)}
            {b.validation.warnings.map((i, n) => <li key={`w${n}`} className="text-warning">Warning, {BASKET_SECTION_LABEL[i.section]}: {i.message}</li>)}
          </ul>
        )}
      </section>

      <section aria-label="Managers" className="space-y-2">
        <h2 className="font-display text-xl font-semibold text-ivory">Managers</h2>
        <ul className="divide-y divide-border-dark">
          {b.assignments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm text-ivory">
              <span className="font-medium">{a.displayName ?? "Team member"}</span>
              <span className="text-xs text-stone">{a.role === "lead" ? "Lead" : "Co-manager"} · {a.permissions.map((f) => ASSIGNMENT_FLAG_LABEL[f]).join(", ")}</span>
              <StatusBadge {...ASSIGNMENT_STATUS_LABEL[a.status]} />
            </li>
          ))}
        </ul>
      </section>

      {pendingLeads.length > 0 && (
        <section aria-label="Lead approval" className="space-y-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
          <h2 className="font-display text-xl font-semibold text-ivory">Lead approval</h2>
          {pendingLeads.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-ivory">{a.displayName ?? "Team member"} is proposed as lead.</span>
              {isAdmin ? (
                <>
                  <ConfirmReason label="Approve lead" pending={act.isPending} description="The new lead takes over. The previous lead's assignment ends." onConfirm={() => act.mutate(() => client.opsDecideBasketLead(bid, a.id, { decision: "approved" }))} />
                  <ConfirmReason label="Reject lead" reasonLabel="Reason" destructive pending={act.isPending} description="The proposed lead is not approved." onConfirm={(reason) => act.mutate(() => client.opsDecideBasketLead(bid, a.id, { decision: "rejected", reason }))} />
                </>
              ) : <span className="text-xs text-stone">Only an ops admin can decide.</span>}
            </div>
          ))}
        </section>
      )}

      {v && (
        <section aria-label="Snapshot" className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-ivory">{b.openVersion ? `Version ${b.openVersion.versionNumber} as submitted` : "Published version"}</h2>
          <div className="rounded-xl border border-border-dark p-4"><BasketView content={v} allocation={v.assets.map((a) => ({ ...a, key: a.instrumentId }))} disclosures={v.disclosures} /></div>
        </section>
      )}

      <section aria-label="Reviews" className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ivory">Previous reviews</h2>
        {b.reviews.length === 0 ? <p className="text-sm text-stone">None yet.</p> : (
          <ol className="space-y-3">
            {b.reviews.map((r) => (
              <li key={r.id} className={r.internalNote ? "rounded-xl border border-warning/40 bg-warning/5 p-3" : "rounded-xl border border-border-dark p-3"}>
                <p className="text-xs text-stone">{new Date(r.createdAt).toLocaleString()} · {r.decision.replaceAll("_", " ")}</p>
                {r.messageToManager && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="text-stone">To manager: </span>{r.messageToManager}</p>}
                {r.internalNote && <p className="mt-1 whitespace-pre-wrap text-sm text-ivory"><span className="mr-2 rounded bg-warning/20 px-1.5 py-0.5 text-xs font-medium text-warning">Internal</span>{r.internalNote}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="bdecision-h" className="space-y-4">
        <h2 id="bdecision-h" className="font-display text-xl font-semibold text-ivory">Decision</h2>
        {b.openVersion?.status === "in_review"
          ? <BasketDecisionForm isAdmin={isAdmin} pending={act.isPending} onSubmit={(body) => act.mutate(() => client.opsDecideBasketVersion(bid, (b.openVersion as { id: string }).id, body))} />
          : <p className="text-sm text-muted-foreground">Nothing to decide: no version is in review.</p>}
      </section>

      <section aria-label="Platform actions" className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ivory">Platform actions</h2>
        <div className="flex flex-wrap gap-2">
          {(b.status === "ACTIVE" || (b.status === "PAUSED" && b.pauseKind !== "platform")) && (
            <ConfirmReason label="Pause basket" reasonLabel="Reason" pending={act.isPending} description="The basket stays public with a paused notice. Only an ops admin can resume a platform pause." onConfirm={(reason) => act.mutate(() => client.opsPauseBasket(bid, { reason }))} />
          )}
          {isAdmin && b.status === "PAUSED" && (
            <ConfirmReason label="Resume basket" pending={act.isPending} description="The basket returns to active." onConfirm={() => act.mutate(() => client.opsResumeBasket(bid))} />
          )}
          {isAdmin && canRetire && <ConfirmReason label="Retire basket" reasonLabel="Reason" destructive pending={act.isPending} description="Retiring is permanent. The basket stays readable but nothing can change." onConfirm={(reason) => act.mutate(() => client.opsRetireBasket(bid, { reason }))} />}
        </div>
        {b.status === "RETIREMENT_PENDING" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4">
            <span className="text-sm text-ivory">The manager asked to retire this basket.</span>
            {isAdmin ? (
              <>
                <ConfirmReason label="Approve retirement" destructive pending={act.isPending} description="The basket is retired permanently." onConfirm={() => act.mutate(() => client.opsDecideBasketRetirement(bid, { decision: "approved" }))} />
                <ConfirmReason label="Decline retirement" reasonLabel="Reason" pending={act.isPending} description="The basket returns to the status it had." onConfirm={(reason) => act.mutate(() => client.opsDecideBasketRetirement(bid, { decision: "rejected", reason }))} />
              </>
            ) : <span className="text-xs text-stone">Only an ops admin can decide.</span>}
          </div>
        )}
      </section>

      <section aria-label="Timeline" className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ivory">Timeline</h2>
        <ol className="space-y-2">
          {b.events.map((e) => (
            <li key={e.id} className="text-xs text-stone">{new Date(e.createdAt).toLocaleString()} · {e.actorType} · {e.kind.replaceAll("_", " ")}{e.fromStatus && e.toStatus && e.fromStatus !== e.toStatus && ` · ${e.fromStatus} to ${e.toStatus}`}{e.reason && ` · ${e.reason}`}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

"use client";

import { ApiError, type ApiClient } from "@repo/api-client";
import { BASKET_CATEGORY_LABEL, BASKET_SECTION_LABEL, BASKET_STATUS_LABEL, BASKET_ISSUE_LABEL, BASKET_VERSION_STATUS_LABEL } from "@repo/app-core";
import {
  BASKET_SECTIONS, basketCategorySchema, basketRebalanceSchema, decimalStringSchema, validateBasketVersion, type BasketDetail, type BasketSection, type BasketValidation, type BasketVersionView, type SaveBasketDraftRequest,
} from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Adoption } from "./adoption";
import { AllocationEditor, PercentInput } from "./allocation-editor";
import { AssignmentsPanel } from "./assignments-panel";
import { BasketView, type AllocationRow } from "./basket-view";
import { ConfirmReason } from "./confirm-reason";
import { FeesEditor } from "./fees-editor";
import { ReviewFeedback } from "./review-feedback";
import { DiffSummary, VersionHistory } from "./version-history";

type Client = Pick<ApiClient,
  "getBasket" | "saveBasketDraft" | "previewBasket" | "getBasketVersionDiff" | "listBasketVersions" | "submitBasket" | "withdrawBasket" | "publishBasket" | "createBasketVersion" |
  "basketAdoption" | "pauseBasket" | "resumeBasket" | "requestBasketRetirement" | "listAssets" | "listOrganizationMembers" | "addBasketAssignment" | "updateBasketAssignment" | "endBasketAssignment">;

const EDITABLE = ["draft", "changes_required"];
const FREQUENCY = { none: "No scheduled review", monthly: "Monthly", quarterly: "Quarterly" } as const;

const rows = (v: BasketVersionView): AllocationRow[] => v.assets.map((a) => ({ ...a, key: a.instrumentId }));

/** Optional number field checked with the same schema the server uses. An invalid entry is flagged and not sent on. */
function Threshold({ id, label, help, error, value, disabled, check, onChange }: {
  id: string; label: string; help: string; error: string; value: number | string | undefined; disabled: boolean;
  check(text: string): { success: boolean }; onChange(v: string | undefined): void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const bad = text.trim() !== "" && !check(text.trim()).success;
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-ivory">{label} (optional)</Label>
      <Input id={id} inputMode="decimal" value={text} disabled={disabled} aria-invalid={bad} className="min-h-11 w-36 bg-space text-ivory"
        onChange={(e) => { setText(e.target.value); const t = e.target.value.trim(); if (t === "") onChange(undefined); else if (check(t).success) onChange(t); }} />
      <p className="text-xs text-stone">{help}</p>
      {bad && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function TextField({ id, label, value, max, multiline, required, disabled, onChange }: { id: string; label: string; value: string | null; max: number; multiline?: boolean; required?: boolean; disabled: boolean; onChange(v: string): void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs font-medium text-ivory">{label}{required && " (required)"}</Label>
      {multiline
        ? <Textarea id={id} value={value ?? ""} maxLength={max} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        : <Input id={id} value={value ?? ""} maxLength={max} disabled={disabled} className="min-h-11 bg-space text-ivory" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export function BasketWizard({ bid, client = api }: { bid: string; client?: Client }) {
  const qc = useQueryClient();
  const key = ["basket", bid];
  const [generation, setGeneration] = useState(0);
  const query = useQuery({ queryKey: key, queryFn: () => client.getBasket(bid), retry: false });
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.code === "FORBIDDEN") {
      return <p role="alert" className="text-base text-ivory">You no longer have access to this basket. <Link href="/organization" className="text-mint underline">Back to your organization</Link></p>;
    }
    const e = toDisplayError(query.error);
    return <p role="alert" className="text-sm text-danger"><span className="font-medium">{e.title}</span> {e.message}</p>;
  }
  if (!query.data) return <p role="status" className="text-sm text-muted-foreground">Loading…</p>;
  // A new version or a reload starts the form afresh from the server's copy.
  return (
    <Workspace key={`${query.data.openVersion?.id}:${generation}`} detail={query.data} client={client}
      onDetail={(d) => qc.setQueryData(key, d)}
      onReload={async () => { await qc.refetchQueries({ queryKey: key }); setGeneration((g) => g + 1); }} />
  );
}

function Workspace({ detail, client, onDetail, onReload }: { detail: BasketDetail; client: Client; onDetail(d: BasketDetail): void; onReload(): Promise<void> }) {
  const bid = detail.id;
  const open = detail.openVersion;
  const v = open ?? detail.publishedVersion;
  const [d, setD] = useState<BasketVersionView | null>(v);
  const [tags, setTags] = useState(v?.tags.join(", ") ?? "");
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState<BasketSection>("basics");
  const has = (f: BasketDetail["myPermissions"][number]) => detail.myPermissions.includes(f);
  const editable = has("edit") && open !== null && EDITABLE.includes(open.status);

  const set = (p: Partial<BasketVersionView>) => { setD((x) => (x ? { ...x, ...p } : x)); setDirty(true); };
  const act = useMutation({ mutationFn: (run: () => Promise<BasketDetail>) => run(), onSuccess: onDetail });
  const save = useMutation({
    mutationFn: () => {
      const x = d as BasketVersionView;
      const body: SaveBasketDraftRequest = {
        name: x.name, shortDescription: x.shortDescription?.trim() || null, longDescription: x.longDescription, category: x.category, tags: x.tags, objective: x.objective, thesis: x.thesis,
        methodology: x.methodology, intendedInvestor: x.intendedInvestor, horizon: x.horizon, keyAssumptions: x.keyAssumptions, knownLimitations: x.knownLimitations, strategyRisks: x.strategyRisks,
        liquidityNotes: x.liquidityNotes, conflictsOfInterest: x.conflictsOfInterest, constraints: x.constraints, rebalance: x.rebalance, fees: x.fees,
        minimumInvestmentUsdc: x.minimumInvestmentUsdc, minimumIncrementUsdc: x.minimumIncrementUsdc, rationale: x.rationale,
        assets: x.assets.map((a) => ({ instrumentId: a.instrumentId, targetWeightBps: a.targetWeightBps, minWeightBps: a.minWeightBps, maxWeightBps: a.maxWeightBps, rationale: a.rationale?.trim() || null })),
        expectedUpdatedAt: (open as BasketVersionView).updatedAt,
      };
      return client.saveBasketDraft(bid, body);
    },
    onSuccess: (next) => { onDetail(next); setDirty(false); },
  });

  const preview = useQuery({ queryKey: ["basket", bid, "preview", open?.updatedAt], queryFn: () => client.previewBasket(bid), enabled: section === "review" && open !== null && !dirty, retry: false });
  const versions = useQuery({ queryKey: ["basket", bid, "versions"], queryFn: () => client.listBasketVersions(bid), enabled: section === "review", retry: false });
  const diff = useQuery({ queryKey: ["basket", bid, "diff", open?.id, open?.updatedAt], queryFn: () => client.getBasketVersionDiff(bid, (open as BasketVersionView).id), enabled: section === "review" && open !== null && open.versionNumber >= 2 && !dirty, retry: false });

  if (!d || !v) return <p role="status" className="text-sm text-muted-foreground">This basket has no version to show.</p>;

  // Live feedback mirrors the server's validation. It cannot run on amounts that are not numbers, so those are reported instead.
  const amounts = [d.minimumInvestmentUsdc, d.minimumIncrementUsdc, d.fees.subscription?.amountUsdc, ...[d.fees.entry, d.fees.management, d.fees.rebalance].map((f) => (f.type === "fixed" ? f.amountUsdc : null))];
  const amountsOk = amounts.every((a) => a == null || decimalStringSchema.safeParse(a).success);
  const validation: BasketValidation = amountsOk ? validateBasketVersion({
    version: d,
    assets: d.assets.map((a) => ({ ...a, instrument: { status: a.instrumentStatus, assetType: a.assetType, hasActiveDeployment: a.hasActiveDeployment } })),
    versionNumber: v.versionNumber,
    hasActiveLead: detail.assignments.some((a) => a.role === "lead" && a.status === "ACTIVE"),
    // Basket routes already require a verified organization; the server re-checks at submit.
    orgVerified: true,
  }) : { issues: [{ code: "FEE_CONFIGURATION_INVALID", section: "fees", message: "Enter amounts as numbers with up to 6 decimals." }], warnings: [] };

  const names = Object.fromEntries([...d.assets, ...(detail.publishedVersion?.assets ?? [])].map((a) => [a.instrumentId, `${a.name} (${a.symbol})`]));
  const status = detail.status;
  const live = status === "DRAFT" || status === "ACTIVE";
  const dis = !editable;
  const ctl = (id: string, label: string, field: keyof BasketVersionView, max: number, extra: { multiline?: boolean; required?: boolean } = {}) => (
    <TextField id={id} label={label} value={d[field] as string | null} max={max} disabled={dis} {...extra} onChange={(x) => set({ [field]: x })} />
  );
  const setConstraint = (k: "maxWeightPerAssetBps" | "maxStablecoinBps" | "maxRwaBps", value: number | null) =>
    set({ constraints: Object.fromEntries(Object.entries({ ...d.constraints, [k]: value }).filter(([, x]) => x !== null)) });
  const setRebalance = (patch: Partial<BasketVersionView["rebalance"]>) => set({ rebalance: Object.fromEntries(Object.entries({ ...d.rebalance, ...patch }).filter(([, x]) => x !== undefined)) as BasketVersionView["rebalance"] });
  const banner =
    status === "PAUSED" ? (detail.pauseKind === "platform" ? `Paused by Bytesac${detail.pauseReason ? `: ${detail.pauseReason}` : ""}. Only Bytesac can resume it.` : `Paused by your team${detail.pauseReason ? `: ${detail.pauseReason}` : ""}.`)
    : status === "REASSIGNMENT_REQUIRED" ? "This basket has no lead manager. Add a lead under Managers; the basket continues once Bytesac approves the new lead."
    : status === "RETIREMENT_PENDING" ? "You asked to retire this basket. It stays as it is until Bytesac decides."
    : status === "RETIRED" ? "This basket is retired and read-only."
    : status === "REJECTED" ? "This basket was not approved. Start a new basket to try again."
    : open?.status === "in_review" ? "This version is being reviewed. It is read-only until the reviewer responds."
    : open?.status === "approved" ? "This version is approved. Publish it to make it public."
    : !has("edit") ? "You have read-only access to this basket."
    : null;
  const conflict = save.error instanceof ApiError && save.error.code === "VERSION_CONFLICT";
  const failure = (e: unknown) => { const x = toDisplayError(e); return <p role="alert" className="text-sm text-danger"><span className="font-medium">{x.title}</span> {x.message}</p>; };

  const panel: Record<BasketSection, ReactNode> = {
    basics: (
      <div className="space-y-4">
        {ctl("b-name", "Name", "name", 80)}
        <div className="space-y-1">
          <Label htmlFor="b-cat" className="text-xs font-medium text-ivory">Category</Label>
          <Select id="b-cat" value={d.category} disabled={dis} onChange={(e) => set({ category: basketCategorySchema.parse(e.target.value) })}>
            {basketCategorySchema.options.map((c) => <option key={c} value={c}>{BASKET_CATEGORY_LABEL[c]}</option>)}
          </Select>
        </div>
        {ctl("b-short", "Short description", "shortDescription", 160)}
        {ctl("b-long", "Description", "longDescription", 5000, { multiline: true })}
        <TextField id="b-tags" label="Tags (up to 5, comma separated, lowercase)" value={tags} max={200} disabled={dis} onChange={(x) => { setTags(x); set({ tags: x.split(",").map((t) => t.trim()).filter(Boolean) }); }} />
      </div>
    ),
    thesis: (
      <div className="space-y-4">
        {ctl("t-obj", "Objective", "objective", 2000, { multiline: true })}
        {ctl("t-thesis", "Thesis", "thesis", 5000, { multiline: true })}
        {ctl("t-method", "Methodology", "methodology", 5000, { multiline: true })}
        {ctl("t-inv", "Intended investor", "intendedInvestor", 1000, { multiline: true })}
        {ctl("t-hor", "Horizon", "horizon", 200)}
        {ctl("t-assume", "Key assumptions", "keyAssumptions", 2000, { multiline: true })}
        {ctl("t-limit", "Known limitations", "knownLimitations", 2000, { multiline: true })}
      </div>
    ),
    assets: <AllocationEditor assets={d.assets} readOnly={dis} client={client} onChange={(assets) => set({ assets })} />,
    constraints: (
      <div className="flex flex-wrap gap-6">
        <PercentInput id="c-max" label="Largest weight per asset (optional)" optional value={d.constraints.maxWeightPerAssetBps ?? null} disabled={dis} onChange={(x) => setConstraint("maxWeightPerAssetBps", x)} />
        <PercentInput id="c-stable" label="Most in stablecoins (optional)" optional value={d.constraints.maxStablecoinBps ?? null} disabled={dis} onChange={(x) => setConstraint("maxStablecoinBps", x)} />
        <PercentInput id="c-rwa" label="Most in tokenized assets (optional)" optional value={d.constraints.maxRwaBps ?? null} disabled={dis} onChange={(x) => setConstraint("maxRwaBps", x)} />
      </div>
    ),
    rebalance: (
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="r-freq" className="text-xs font-medium text-ivory">Review frequency</Label>
          <Select id="r-freq" value={d.rebalance.reviewFrequency} disabled={dis} onChange={(e) => set({ rebalance: { ...d.rebalance, reviewFrequency: e.target.value as keyof typeof FREQUENCY } })}>
            {(Object.keys(FREQUENCY) as Array<keyof typeof FREQUENCY>).map((f) => <option key={f} value={f}>{FREQUENCY[f]}</option>)}
          </Select>
        </div>
        <PercentInput id="r-drift" label="Drift threshold (optional)" optional value={d.rebalance.driftThresholdBps ?? null} disabled={dis}
          onChange={(x) => setRebalance({ driftThresholdBps: x ?? undefined })} />
        <Threshold id="r-min-bps" label="Minimum trade (bps)" help="Assets whose weight is closer to target than this are left alone in a rebalance. Whole number, 10 to 1000. Default 50." error="Enter a whole number from 10 to 1000."
          value={d.rebalance.minTradeBps} disabled={dis} check={(t) => basketRebalanceSchema.shape.minTradeBps.safeParse(/^\d+$/.test(t) ? Number(t) : NaN)} onChange={(x) => setRebalance({ minTradeBps: x === undefined ? undefined : Number(x) })} />
        <Threshold id="r-min-usdc" label="Minimum trade (USDC)" help="Trades smaller than this are skipped in a rebalance. Between 1 and 100 USDC. Default 5." error="Enter an amount between 1 and 100 USDC, with up to 6 decimals."
          value={d.rebalance.minTradeUsdc} disabled={dis} check={(t) => basketRebalanceSchema.shape.minTradeUsdc.safeParse(t)} onChange={(x) => setRebalance({ minTradeUsdc: x })} />
        <p className="rounded-xl border border-border-dark p-4 text-sm text-stone">These are disclosures, not automatic rules. A rebalance is always a new version you propose and Bytesac reviews. Investors always give explicit consent before a rebalance touches their holdings.</p>
      </div>
    ),
    managers: <AssignmentsPanel detail={detail} onChange={onDetail} client={client} />,
    fees: <FeesEditor value={d} readOnly={dis} onChange={set} />,
    risks: (
      <div className="space-y-4">
        {ctl("k-risks", "Strategy risks", "strategyRisks", 5000, { multiline: true, required: true })}
        {ctl("k-liq", "Liquidity", "liquidityNotes", 2000, { multiline: true })}
        {ctl("k-conf", "Conflicts of interest", "conflictsOfInterest", 2000, { multiline: true })}
        <section aria-label="Platform notices" className="space-y-2">
          <h3 className="text-sm font-medium text-ivory">Platform notices</h3>
          <p className="text-xs text-stone">Bytesac adds these to every version when you submit it. You cannot change or remove them.</p>
          {(open ?? v).disclosures.length === 0
            ? <p className="text-sm text-stone">They will appear here once this version is submitted.</p>
            : <ul className="space-y-2">{(open ?? v).disclosures.map((x) => <li key={x.templateId} className="rounded-xl border border-border-dark p-3"><p className="text-sm font-medium text-ivory">{x.title}</p><p className="mt-1 whitespace-pre-wrap text-sm text-stone">{x.body}</p></li>)}</ul>}
        </section>
      </div>
    ),
    review: (
      <div className="space-y-6">
        {v.versionNumber >= 2 && open && ctl("v-rationale", "Why does this version change the basket?", "rationale", 2000, { multiline: true, required: true })}
        <section aria-label="Validation" className="space-y-3">
          <h3 className="text-sm font-medium text-ivory">Validation</h3>
          {validation.issues.length === 0 ? <p className="text-sm text-success">Nothing blocks submission.</p> : BASKET_SECTIONS.filter((s) => validation.issues.some((i) => i.section === s)).map((s) => (
            <div key={s} className="space-y-1">
              <p className="text-xs font-medium text-stone">{BASKET_SECTION_LABEL[s]}</p>
              <ul className="space-y-1">{validation.issues.filter((i) => i.section === s).map((i, n) => <li key={n} className="flex items-start gap-2 text-sm text-danger"><AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" /><span><span className="font-medium">{BASKET_ISSUE_LABEL[i.code]}.</span> {i.message}</span></li>)}</ul>
            </div>
          ))}
          {validation.warnings.length > 0 && (
            <ul aria-label="Warnings" className="space-y-1">{validation.warnings.map((i, n) => <li key={n} className="text-sm text-warning">Warning: {i.message}</li>)}</ul>
          )}
        </section>
        {open && open.versionNumber >= 2 && (
          <section aria-label="Changes" className="space-y-2">
            <h3 className="text-sm font-medium text-ivory">Changes from the published version</h3>
            {dirty ? <p className="text-xs text-stone">Save to refresh the changes.</p> : diff.data ? <DiffSummary diff={diff.data} names={names} /> : <p role="status" className="text-xs text-muted-foreground">Loading…</p>}
          </section>
        )}
        {open && (
          <section aria-label="Preview" className="space-y-3">
            <h3 className="text-sm font-medium text-ivory">Preview — not public</h3>
            {dirty ? <p className="text-sm text-stone">Save your changes to refresh the preview.</p> : preview.isError ? failure(preview.error) : preview.data ? (
              <div className="rounded-xl border border-dashed border-border-dark p-4"><BasketView content={preview.data.version} allocation={rows(preview.data.version)} disclosures={preview.data.version.disclosures} /></div>
            ) : <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
          </section>
        )}
        {detail.publishedVersion && (
          <section aria-label="Adoption" className="space-y-2">
            <h3 className="text-sm font-medium text-ivory">Adoption</h3>
            <Adoption bid={bid} client={client} />
          </section>
        )}
        <section aria-label="Versions" className="space-y-2">
          <h3 className="text-sm font-medium text-ivory">Versions</h3>
          {versions.data ? <VersionHistory bid={bid} versions={versions.data.versions} names={names} client={client} /> : <p role="status" className="text-xs text-muted-foreground">Loading…</p>}
        </section>
      </div>
    ),
  };

  const busy = act.isPending;
  return (
    <div className="max-w-4xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold text-ivory">{d.name}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge {...BASKET_STATUS_LABEL[status]} />
          <StatusBadge {...BASKET_VERSION_STATUS_LABEL[v.status]} label={`Version ${v.versionNumber}: ${BASKET_VERSION_STATUS_LABEL[v.status].label}`} />
          {detail.hasAssetWarning && <span className="text-xs text-warning">An asset in this basket was paused or deprecated in the registry.</span>}
          <Link href="/organization" className="text-sm text-mint underline">Back to your organization</Link>
        </div>
      </div>
      {banner && <p role="status" className="rounded-xl border border-border-dark bg-slate p-4 text-sm text-ivory">{banner}</p>}
      {open && <ReviewFeedback reviews={detail.reviews} versionId={open.id} />}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Actions">
        {has("submit") && open && EDITABLE.includes(open.status) && live && (
          <Button className="min-h-11" disabled={busy || dirty || validation.issues.length > 0} title={dirty ? "Save your changes first" : undefined} onClick={() => act.mutate(() => client.submitBasket(bid))}>Submit for review</Button>
        )}
        {has("submit") && open?.status === "in_review" && <Button variant="secondary" className="min-h-11" disabled={busy} onClick={() => act.mutate(() => client.withdrawBasket(bid))}>Withdraw</Button>}
        {has("publish") && open?.status === "approved" && live && (
          <ConfirmReason label="Publish" pending={busy} description="This version becomes the public version of the basket. Publishing does not invest or move any assets." onConfirm={() => act.mutate(() => client.publishBasket(bid))} />
        )}
        {has("edit") && !open && detail.publishedVersion && status !== "RETIRED" && status !== "REJECTED" && (
          <Button variant="secondary" className="min-h-11" disabled={busy} onClick={() => act.mutate(() => client.createBasketVersion(bid))}>New version</Button>
        )}
        {has("lifecycle") && status === "ACTIVE" && (
          <ConfirmReason label="Pause" reasonLabel="Reason" pending={busy} description="The basket stays public with a paused notice. You can resume it later." onConfirm={(reason) => act.mutate(() => client.pauseBasket(bid, { reason }))} />
        )}
        {has("lifecycle") && status === "PAUSED" && detail.pauseKind === "manager" && <Button variant="secondary" className="min-h-11" disabled={busy} onClick={() => act.mutate(() => client.resumeBasket(bid))}>Resume</Button>}
        {has("lifecycle") && (status === "ACTIVE" || status === "PAUSED") && (
          <ConfirmReason label="Request retirement" reasonLabel="Reason" destructive pending={busy} description="Bytesac decides whether to retire this basket. Retiring is permanent." onConfirm={(reason) => act.mutate(() => client.requestBasketRetirement(bid, { reason }))} />
        )}
        {editable && <Button variant="secondary" className="min-h-11" disabled={save.isPending || !dirty} onClick={() => save.mutate()}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save</Button>}
      </div>
      {editable && dirty && <p className="text-xs text-stone">You have unsaved changes.</p>}
      {save.isSuccess && !dirty && <p role="status" className="text-sm text-success">Saved.</p>}
      {conflict ? (
        <div role="alert" className="space-y-2 rounded-xl border border-danger/40 p-4 text-sm text-ivory">
          <p>This draft changed since you opened it. Reload to continue.</p>
          <Button variant="secondary" className="min-h-11" onClick={() => void onReload()}>Reload</Button>
        </div>
      ) : save.isError && failure(save.error)}
      {act.isError && failure(act.error)}

      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <nav aria-label="Sections">
          <ul className="flex flex-wrap gap-2 md:flex-col">
            {BASKET_SECTIONS.map((s) => {
              const done = !validation.issues.some((i) => i.section === s);
              return (
                <li key={s}>
                  <button type="button" aria-current={section === s ? "step" : undefined} onClick={() => setSection(s)}
                    className={cn("flex min-h-11 w-full items-center gap-2 rounded-lg border border-border-dark px-3 text-left text-sm text-stone hover:text-ivory", section === s && "bg-slate text-ivory")}>
                    {done ? <CheckCircle2 aria-hidden className="size-4 text-success" /> : <AlertTriangle aria-hidden className="size-4 text-warning" />}
                    {BASKET_SECTION_LABEL[s]}<span className="sr-only">{done ? " (complete)" : " (needs attention)"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <section aria-labelledby="section-h" className="min-w-0 space-y-4">
          <h2 id="section-h" className="font-display text-xl font-semibold text-ivory">{BASKET_SECTION_LABEL[section]}</h2>
          {open && <ReviewFeedback reviews={detail.reviews} versionId={open.id} section={section} />}
          {open === null && section !== "managers" && section !== "review" ? <BasketView content={v} allocation={rows(v)} disclosures={v.disclosures} /> : panel[section]}
        </section>
      </div>
    </div>
  );
}

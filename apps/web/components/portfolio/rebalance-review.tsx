"use client";

import { ApiError } from "@repo/api-client";
import { formatBps } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, type Leg, type OperationView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2, PauseCircle, PenLine, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DeclarationForm, isDeclarationRequired } from "@/components/eligibility/declaration-form";
import { DiffSummary } from "@/components/baskets/version-history";
import { FeeLines } from "@/components/invest/fee-lines";
import { LegProgress, LegRow } from "@/components/invest/leg-progress";
import { ErrorBox } from "@/components/portfolio/exit-dialogs";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/kit";
import { WeightDiff } from "@/components/visual/weight-diff";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { PageHeader } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/layout/states";

const Legs = ({ title, legs, buying, note }: { title: string; legs: Leg[]; buying: boolean; note?: string }) => legs.length === 0 ? null : (
  <div className="space-y-3">
    <h3 className="type-eyebrow text-ink-faint">{title}</h3>
    <ol className="space-y-3">{legs.map((l) => <LegRow key={l.id} leg={l} buying={buying} />)}</ol>
    {note && <p className="text-xs text-ink-muted">{note}</p>}
  </div>
);

/** Review a basket update (latest) or a rebalance to the version already applied (applied), then plan it and sign every step. Nothing is created until "Create plan". */
export function RebalanceReview({ positionId, target }: { positionId: string; target: "latest" | "applied" }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [key] = useState(() => crypto.randomUUID());
  const [plan, setPlan] = useState<OperationView | null>(null);
  const [signing, setSigning] = useState(false);
  const [aligned, setAligned] = useState(false);
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const create = useMutation({
    mutationFn: () => api.rebalance({ positionId, target, slippageBps: SLIPPAGE_DEFAULT_BPS, idempotencyKey: key }),
    onSuccess: (r) => { if ("aligned" in r) { setAligned(true); void qc.invalidateQueries({ queryKey: ["portfolio"] }); } else setPlan(r); },
  });
  const discard = useMutation({ mutationFn: (id: string) => api.cancelOperation(id), onSettled: () => setPlan(null) });
  const skip = useMutation({ mutationFn: (versionId: string) => api.skipVersion(positionId, { versionId }), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["portfolio"] }); router.push("/portfolio"); } });

  if (portfolio.isPending) return <LoadingState />;
  const p = portfolio.data?.positions.find((x) => x.id === positionId);
  if (!p) return <p role="alert" className="text-sm text-danger">{portfolio.isError ? toDisplayError(portfolio.error).title : "Position not found."}</p>;
  const latest = p.latestVersion;
  const names = Object.fromEntries(p.holdings.map((h) => [h.instrumentId, h.symbol]));
  const repairAsset = portfolio.data?.repairs.find((r) => r.positions.some((x) => x.positionId === positionId))?.asset ?? "cash";
  const failure = create.error ?? skip.error ?? discard.error;
  const repairNeeded = create.error instanceof ApiError && create.error.code === "REPAIR_REQUIRED";
  const feeLeg = plan?.legs.find((l) => l.kind === "network_fee");
  const fromCash = (feeLeg?.routeSummary as { fromCash?: boolean } | null)?.fromCash === true;
  const diffRows = latest ? [
    ...latest.diff.changed.map((c) => ({ key: c.instrumentId, label: names[c.instrumentId] ?? "Asset", fromBps: c.fromBps, toBps: c.toBps })),
    ...latest.diff.added.map((c) => ({ key: c.instrumentId, label: names[c.instrumentId] ?? "New asset", fromBps: null, toBps: c.weightBps })),
    ...latest.diff.removed.map((c) => ({ key: c.instrumentId, label: names[c.instrumentId] ?? "Removed asset", fromBps: c.weightBps, toBps: null })),
  ] : [];
  const deciding = !aligned && !plan && !signing;

  return (
    <section aria-labelledby="rebalance-title" className="space-y-10">
      <PageHeader id="rebalance-title" title={target === "latest" ? "Review update" : "Rebalance to target"} eyebrow={p.basketName}
        breadcrumb={[{ label: "Portfolio", href: "/portfolio" }, { label: p.basketName, href: `/portfolio/${p.id}` }]}
        description={target === "latest" ? "The manager published a new version of this strategy. Nothing has changed in your wallet." : "Your holdings drifted from the version you applied. A plan moves them back to its target — only if you sign it."} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          {target === "latest" && latest && (
            <section aria-label="What changed" className="space-y-6 rounded-shell border border-line bg-surface p-6 sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-light tracking-tight text-ink">Version {p.appliedVersionNumber} to version {latest.number}</h2>
                <span className="rounded-pill bg-accent-soft px-3 py-1 font-mono text-xs text-accent">v{p.appliedVersionNumber} → v{latest.number}</span>
              </div>
              {latest.rationale && <blockquote className="border-l-2 border-line-strong pl-4 text-ink"><span className="block type-eyebrow text-ink-faint">Manager&apos;s reason: </span><span className="mt-2 block text-lg leading-relaxed font-light">{latest.rationale}</span></blockquote>}
              {diffRows.length > 0 && <WeightDiff rows={diffRows} fromLabel={`Version ${p.appliedVersionNumber}`} toLabel={`Version ${latest.number}`} />}
              <div className="rounded-tile bg-surface-muted p-4"><DiffSummary diff={latest.diff} names={names} /></div>
            </section>
          )}

          <section aria-label="Weights" className="space-y-4">
            <div className="space-y-1">
              <h2 className="type-heading text-ink">Current and target weights</h2>
              <p className="text-sm text-ink-muted">What you hold now, read from your wallets, against the {target === "latest" ? "new" : "applied"} target.</p>
            </div>
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface text-sm">
              {p.holdings.map((h) => (
                <li key={h.deploymentId} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3.5">
                  <span className="font-medium text-ink">{h.symbol}</span>
                  <span className="relative h-2 rounded-pill bg-surface-sunken" aria-hidden>
                    <span className="absolute inset-y-0 left-0 rounded-pill bg-data2" style={{ width: `${Math.min((h.actualBps ?? 0) / 100, 100)}%` }} />
                    {h.targetBps !== null && <span className="absolute -inset-y-0.5 rounded-pill bg-data4/40" style={{ left: `${Math.max(0, h.targetBps - p.driftThresholdBps) / 100}%`, width: `${(Math.min(10_000, h.targetBps + p.driftThresholdBps) - Math.max(0, h.targetBps - p.driftThresholdBps)) / 100}%` }} />}
                    {h.targetBps !== null && <span className="absolute -inset-y-1 w-0.5 rounded-pill bg-ink" style={{ left: `calc(${Math.min(h.targetBps / 100, 100)}% - 1px)` }} />}
                  </span>
                  <span className="font-mono text-xs text-ink-muted tabular-nums">now {h.actualBps === null ? "n/a" : formatBps(h.actualBps)} · target {h.targetBps === null ? "n/a" : formatBps(h.targetBps)}</span>
                </li>
              ))}
            </ul>
          </section>

          {aligned ? <p role="status" className="flex gap-3 rounded-tile border border-success/25 bg-success-soft p-4 text-sm text-ink"><Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />Already aligned with this version — recorded.</p> : signing && plan ? (
            <section aria-label="Signing" className="space-y-4">
              <h2 className="type-heading text-ink">Authorize each step</h2>
              <div className="rounded-card border border-line bg-surface p-5 sm:p-6"><LegProgress operationId={plan.id} /></div>
            </section>
          ) : plan ? (
            <section aria-label="Plan" className="space-y-6 rounded-shell border border-line bg-surface p-6 sm:p-8">
              <div className="space-y-1">
                <h2 className="type-heading text-ink">Your plan</h2>
                <p className="text-sm text-ink-muted">Calculated from what you hold now. Sells settle to USDC on Solana first, then buys use the proceeds.</p>
              </div>
              <Legs title="Sells" legs={plan.legs.filter((l) => l.kind !== "network_fee" && !l.toDeploymentId)} buying={false} />
              {feeLeg && <div className="space-y-2 rounded-tile bg-surface-muted p-4"><FeeLines fees={plan.fees} /><p className="text-xs text-ink-muted">Fees are {fromCash ? "paid from this basket's sale proceeds" : "paid from your free USDC"}.</p></div>}
              <Legs title="Buys" legs={plan.legs.filter((l) => l.toDeploymentId)} buying note="Buy amounts are resized to what your sales actually return." />
              <p className="text-sm text-ink-muted">Outputs are estimates, protected by a minimum per step ({SLIPPAGE_DEFAULT_BPS / 100}% slippage). Prices are re-quoted when you sign each step.</p>
              <div className="flex flex-wrap gap-2">
                <Button size="lg" onClick={() => setSigning(true)}><PenLine aria-hidden />Continue to signing</Button>
                <Button variant="secondary" size="lg" disabled={discard.isPending} onClick={() => discard.mutate(plan.id)}>Back</Button>
              </div>
            </section>
          ) : null}

          {isDeclarationRequired(create.error) && <DeclarationForm onSaved={() => create.mutate()} />}
          {failure && !isDeclarationRequired(failure) && <ErrorBox error={failure} />}
          {repairNeeded && <p className="text-sm text-ink"><Link href={`/portfolio/repair/${repairAsset}`} className="inline-flex items-center gap-1 text-ink underline underline-offset-4">Go to repair</Link></p>}
        </div>

        <aside aria-label="Your choice" className="space-y-3 lg:sticky lg:top-28 lg:self-start">
          <div className="space-y-4 rounded-card border border-line bg-surface p-6 shadow-soft">
            <p className="type-eyebrow text-ink-faint">{target === "latest" ? "Participate" : "Rebalance"}</p>
            <p className="text-sm text-ink-muted">{target === "latest" ? "Bytesac plans the trades from your current holdings to the new target. You review the plan, then sign each step." : "Bytesac plans the trades back to the applied target. You review the plan, then sign each step."}</p>
            {deciding && <Button size="lg" className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <ArrowRight aria-hidden />}Create plan</Button>}
            {deciding && <p className="text-xs text-ink-muted">The plan shows every trade and its cost first. Nothing is signed until you approve each step.</p>}
          </div>
          {target === "latest" && latest && (
            <div className="space-y-4 rounded-card border border-line bg-surface p-6">
              <p className="flex items-center gap-2 type-eyebrow text-ink-faint"><PauseCircle aria-hidden className="size-3.5" />Skip</p>
              <p className="text-sm text-ink-muted">No trade occurs. You stay on version {p.appliedVersionNumber}, and you can review this update again later.</p>
              {deciding && <Button variant="secondary" size="lg" className="w-full" disabled={skip.isPending} onClick={() => skip.mutate(latest.id)}>Skip this version</Button>}
              <p className="text-xs text-ink-muted">Skipping changes nothing in your wallet.</p>
            </div>
          )}
          <Callout icon={<ShieldCheck />} title="Your decision">A manager&apos;s update never moves your assets. Only a plan you sign does.</Callout>
        </aside>
      </div>
    </section>
  );
}

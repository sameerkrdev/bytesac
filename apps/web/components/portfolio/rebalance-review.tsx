"use client";

import { ApiError } from "@repo/api-client";
import { formatBps, formatUnits } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, type Leg, type OperationView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DiffSummary } from "@/components/baskets/version-history";
import { LegProgress, LegRow } from "@/components/invest/leg-progress";
import { ErrorBox } from "@/components/portfolio/exit-dialogs";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

const Legs = ({ title, legs, buying, note }: { title: string; legs: Leg[]; buying: boolean; note?: string }) => legs.length === 0 ? null : (
  <div className="space-y-2">
    <h3 className="text-sm font-medium text-ivory">{title}</h3>
    <ol className="space-y-3">{legs.map((l) => <LegRow key={l.id} leg={l} buying={buying} />)}</ol>
    {note && <p className="text-xs text-stone">{note}</p>}
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

  if (portfolio.isPending) return <p role="status" className="text-sm text-stone">Loading…</p>;
  const p = portfolio.data?.positions.find((x) => x.id === positionId);
  if (!p) return <p role="alert" className="text-sm text-danger">{portfolio.isError ? toDisplayError(portfolio.error).title : "Position not found."}</p>;
  const latest = p.latestVersion;
  const names = Object.fromEntries(p.holdings.map((h) => [h.instrumentId, h.symbol]));
  const repairAsset = portfolio.data?.repairs.find((r) => r.positions.some((x) => x.positionId === positionId))?.asset ?? "cash";
  const failure = create.error ?? skip.error ?? discard.error;
  const repairNeeded = create.error instanceof ApiError && create.error.code === "REPAIR_REQUIRED";
  const feeLeg = plan?.legs.find((l) => l.kind === "network_fee");
  const fromCash = (feeLeg?.routeSummary as { fromCash?: boolean } | null)?.fromCash === true;

  return (
    <section aria-labelledby="rebalance-title" className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 id="rebalance-title" className="font-display text-3xl font-bold text-ivory">{target === "latest" ? "Review update" : "Rebalance to target"}</h1>
        <p className="text-sm text-stone">{p.basketSlug} · <Link href="/portfolio" className="text-mint underline">Back to portfolio</Link></p>
      </div>

      {target === "latest" && latest && (
        <section aria-label="What changed" className="space-y-2 rounded-2xl border border-border-dark bg-slate p-6">
          <h2 className="font-display text-lg font-semibold text-ivory">Version {p.appliedVersionNumber} to version {latest.number}</h2>
          {latest.rationale && <p className="text-sm text-ivory"><span className="text-stone">Manager&apos;s reason: </span>{latest.rationale}</p>}
          <DiffSummary diff={latest.diff} names={names} />
        </section>
      )}

      <section aria-label="Weights" className="space-y-2">
        <h2 className="font-display text-lg font-semibold text-ivory">Current and target weights</h2>
        <ul className="divide-y divide-border-dark text-sm">
          {p.holdings.map((h) => (
            <li key={h.deploymentId} className="flex justify-between gap-2 py-2"><span className="text-ivory">{h.symbol}</span><span className="text-stone">now {h.actualBps === null ? "n/a" : formatBps(h.actualBps)} · target {h.targetBps === null ? "n/a" : formatBps(h.targetBps)}</span></li>
          ))}
        </ul>
      </section>

      {aligned ? <p role="status" className="rounded-xl border border-border-dark p-4 text-sm text-ivory">Already aligned with this version — recorded.</p> : signing && plan ? <LegProgress operationId={plan.id} /> : plan ? (
        <section aria-label="Plan" className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-ivory">Your plan</h2>
          <Legs title="Sells" legs={plan.legs.filter((l) => l.kind !== "network_fee" && !l.toDeploymentId)} buying={false} />
          {feeLeg && <p className="text-sm text-ivory">Network fee: {formatUnits(plan.networkFeeUsdc, 6)} USDC, {fromCash ? "paid from this basket's sale proceeds" : "paid from your free USDC"}.</p>}
          <Legs title="Buys" legs={plan.legs.filter((l) => l.toDeploymentId)} buying note="Buy amounts are resized to what your sales actually return." />
          <p className="text-sm text-stone">No platform or manager fees are charged yet. Outputs are estimates, protected by a minimum per step ({SLIPPAGE_DEFAULT_BPS / 100}% slippage). Prices are re-quoted when you sign each step.</p>
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11" onClick={() => setSigning(true)}>Continue to signing</Button>
            <Button variant="secondary" className="min-h-11" disabled={discard.isPending} onClick={() => discard.mutate(plan.id)}>Back</Button>
          </div>
        </section>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11" disabled={create.isPending} onClick={() => create.mutate()}>{create.isPending && <Loader2 aria-hidden className="animate-spin" />}Create plan</Button>
            {target === "latest" && latest && <Button variant="secondary" className="min-h-11" disabled={skip.isPending} onClick={() => skip.mutate(latest.id)}>Skip this version</Button>}
          </div>
          {target === "latest" && <p className="text-xs text-stone">Skipping changes nothing in your wallet.</p>}
        </div>
      )}

      {failure && <ErrorBox error={failure} />}
      {repairNeeded && <p className="text-sm text-ivory"><Link href={`/portfolio/repair/${repairAsset}`} className="text-mint underline">Go to repair</Link></p>}
    </section>
  );
}

"use client";

import { ApiError } from "@repo/api-client";
import { formatUnits, validateSyncSplit } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, type OperationView, type Repair } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DeclarationForm, isDeclarationRequired } from "@/components/eligibility/declaration-form";
import { FeeLines } from "@/components/invest/fee-lines";
import { LegProgress, LegRow } from "@/components/invest/leg-progress";
import { ErrorBox } from "@/components/portfolio/exit-dialogs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-layout";
import { Callout } from "@/components/ui/kit";
import { Activity } from "lucide-react";
import { LoadingState } from "@/components/layout/states";

const exact = (raw: string, decimals: number) => formatUnits(raw, decimals, decimals);

function BuyBack({ repair, decimals }: { repair: Repair; decimals: number }) {
  const [key] = useState(() => crypto.randomUUID());
  const [plan, setPlan] = useState<OperationView | null>(null);
  const [signing, setSigning] = useState(false);
  const preview = useMutation({ mutationFn: () => api.repair({ deploymentId: repair.asset, slippageBps: SLIPPAGE_DEFAULT_BPS, idempotencyKey: key }), onSuccess: setPlan });
  const discard = useMutation({ mutationFn: (id: string) => api.cancelOperation(id), onSettled: () => setPlan(null) });
  const err = preview.error ?? discard.error;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Buy back {exact(repair.totalShortfall, decimals)} {repair.symbol} with USDC from your wallet so every basket is fully backed again. You review the cost and sign each step.</p>
      {signing && plan ? <LegProgress operationId={plan.id} /> : plan ? (
        <div className="space-y-3">
          <ol className="space-y-3">{plan.legs.map((l) => <LegRow key={l.id} leg={l} buying />)}</ol>
          <FeeLines fees={plan.fees} />
          <p className="text-sm text-ink-muted">Prices are re-quoted when you sign each step.</p>
          <div className="flex flex-wrap gap-3">
            <Button  onClick={() => setSigning(true)}>Continue to signing</Button>
            <Button variant="secondary"  disabled={discard.isPending} onClick={() => discard.mutate(plan.id)}>Back</Button>
          </div>
        </div>
      ) : <Button  disabled={preview.isPending} onClick={() => preview.mutate()}>{preview.isPending && <Loader2 aria-hidden className="animate-spin" />}Get cost preview</Button>}
      {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
      {err && !isDeclarationRequired(err) && <ErrorBox error={err} />}
    </div>
  );
}

/** Each short basket gives up part of its record so the total matches what the wallet holds. Prefilled with the server's pro-rata shares; Save needs the exact total. */
function Sync({ repair, decimals, onChanged }: { repair: Repair; decimals: number; onChanged(changed: boolean): void }) {
  const [key] = useState(() => crypto.randomUUID());
  const [text, setText] = useState(() => Object.fromEntries(repair.positions.map((x) => [x.positionId, exact(x.shortfall, decimals)])));
  const { raw, sum, total, valid } = validateSyncSplit(repair.positions.map((x) => text[x.positionId] ?? ""), repair.positions.map((x) => x.ledger), repair.totalShortfall, decimals);
  const save = useMutation({
    mutationFn: () => api.sync({ asset: repair.asset === "cash" ? "cash" : { deploymentId: repair.asset }, split: repair.positions.map((x, n) => ({ positionId: x.positionId, quantity: raw[n]!.toString() })), idempotencyKey: key }),
    onSuccess: () => onChanged(false),
    onError: (e) => { if (e instanceof ApiError && e.code === "SHORTFALL_CHANGED") onChanged(true); },
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="text-sm text-ink-muted">Use this if you moved {repair.symbol} out of your wallet on purpose. Your baskets will record less {repair.symbol}; nothing is bought or sold.</p>
      {repair.positions.map((x) => (
        <div key={x.positionId} className="space-y-1">
          <label htmlFor={`sync-${x.positionId}`} className="text-xs font-medium text-ink">{x.basketSlug}: reduce by ({repair.symbol})</label>
          <Input id={`sync-${x.positionId}`} inputMode="decimal" className="w-48" value={text[x.positionId] ?? ""} aria-invalid={raw[repair.positions.indexOf(x)] === null}
            onChange={(e) => setText({ ...text, [x.positionId]: e.target.value })} />
        </div>
      ))}
      <p role="status" className={cn("text-sm", sum === total ? "text-success" : "text-warning")}>Must add up to {exact(repair.totalShortfall, decimals)} {repair.symbol}</p>
      <Button type="submit"  disabled={!valid || save.isPending}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save</Button>
      {save.isSuccess && <p role="status" className="text-sm text-success">Saved. Your baskets now match your wallet.</p>}
      {save.isError && !(save.error instanceof ApiError && save.error.code === "SHORTFALL_CHANGED") && <ErrorBox error={save.error} />}
    </form>
  );
}

/** One short asset (or basket cash) across all the baskets it affects: buy it back, or sync the baskets to the wallet. */
export function RepairPanel({ asset }: { asset: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"buy" | "sync">("buy");
  const [changed, setChanged] = useState(false);
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  if (portfolio.isPending) return <LoadingState />;
  if (portfolio.isError) return <p role="alert" className="text-sm text-danger">{toDisplayError(portfolio.error).title}</p>;
  const repair = portfolio.data.repairs.find((r) => r.asset === asset);
  if (!repair) return <p role="status" className="text-sm text-ink">Nothing needs repair here. <Link href="/portfolio" className="text-ink underline underline-offset-4">Back to portfolio</Link></p>;
  const decimals = repair.asset === "cash" ? 6 : (portfolio.data.positions.flatMap((p) => p.holdings).find((h) => h.deploymentId === repair.asset)?.decimals ?? 0);
  const active = repair.asset === "cash" ? "sync" : tab;
  // Reset the forms when the server's figures change.
  const figures = repair.positions.map((x) => x.shortfall).join(",");

  return (
    <section aria-labelledby="repair-title" className="max-w-4xl space-y-8">
      <PageHeader id="repair-title" title={`Repair ${repair.symbol}`} eyebrow="Portfolio assistance" breadcrumb={[{ label: "Portfolio", href: "/portfolio" }, { label: `Repair ${repair.symbol}` }]} />
      <Callout tone="warning" icon={<Activity />} title="What happened">
        Your wallet holds {exact(repair.totalShortfall, decimals)} {repair.symbol} less than your baskets record — usually because {repair.symbol} was moved or sold outside Bytesac. Nothing has been bought or sold to fix it. Choose how you want your baskets to reflect your wallet. <Link href="/portfolio" className="text-ink underline underline-offset-4">Back to portfolio</Link>
      </Callout>
      {changed && <p role="alert" className="rounded-tile border border-warning/25 p-3 text-sm text-ink">Your holdings changed — review the new figures</p>}
      <ul aria-label="Affected baskets" className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface text-sm">
        {repair.positions.map((x) => (
          <li key={x.positionId} className="flex flex-wrap justify-between gap-2 px-5 py-4">
            <span className="text-ink">{x.basketSlug}</span>
            <span className="text-ink-muted">Recorded {exact(x.ledger, decimals)} · allocated {exact((BigInt(x.ledger) - BigInt(x.shortfall)).toString(), decimals)} · short {exact(x.shortfall, decimals)}</span>
          </li>
        ))}
      </ul>
      <div role="group" aria-label="Repair method" className="grid gap-3 sm:grid-cols-2">
        {repair.asset !== "cash" && <button type="button" aria-label="Buy back" aria-describedby="repair-buy-help" aria-pressed={active === "buy"} onClick={() => setTab("buy")} className={cn("rounded-card border p-5 text-left transition-colors", active === "buy" ? "border-primary bg-surface shadow-soft" : "border-line bg-surface/60 hover:border-line-strong")}><span className="block font-medium text-ink">Buy back</span><span id="repair-buy-help" className="mt-1 block text-sm text-ink-muted">Restore the holding with USDC from your wallet. You sign each step.</span></button>}
        <button type="button" aria-label="Sync" aria-describedby="repair-sync-help" aria-pressed={active === "sync"} onClick={() => setTab("sync")} className={cn("rounded-card border p-5 text-left transition-colors", active === "sync" ? "border-primary bg-surface shadow-soft" : "border-line bg-surface/60 hover:border-line-strong")}><span className="block font-medium text-ink">Sync</span><span id="repair-sync-help" className="mt-1 block text-sm text-ink-muted">Keep your wallet as it is; your baskets record less. Nothing is traded.</span></button>
      </div>
      {active === "buy" ? <BuyBack key={figures} repair={repair} decimals={decimals} /> : <Sync key={figures} repair={repair} decimals={decimals} onChanged={(c) => { setChanged(c); void qc.invalidateQueries({ queryKey: ["portfolio"] }); }} />}
    </section>
  );
}

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
      <p className="text-sm text-stone">Buy back {exact(repair.totalShortfall, decimals)} {repair.symbol} with USDC from your wallet so every basket is fully backed again. You review the cost and sign each step.</p>
      {signing && plan ? <LegProgress operationId={plan.id} /> : plan ? (
        <div className="space-y-3">
          <ol className="space-y-3">{plan.legs.map((l) => <LegRow key={l.id} leg={l} buying />)}</ol>
          <FeeLines fees={plan.fees} />
          <p className="text-sm text-stone">Prices are re-quoted when you sign each step.</p>
          <div className="flex flex-wrap gap-3">
            <Button className="min-h-11" onClick={() => setSigning(true)}>Continue to signing</Button>
            <Button variant="secondary" className="min-h-11" disabled={discard.isPending} onClick={() => discard.mutate(plan.id)}>Back</Button>
          </div>
        </div>
      ) : <Button className="min-h-11" disabled={preview.isPending} onClick={() => preview.mutate()}>{preview.isPending && <Loader2 aria-hidden className="animate-spin" />}Get cost preview</Button>}
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
      <p className="text-sm text-stone">Use this if you moved {repair.symbol} out of your wallet on purpose. Your baskets will record less {repair.symbol}; nothing is bought or sold.</p>
      {repair.positions.map((x) => (
        <div key={x.positionId} className="space-y-1">
          <label htmlFor={`sync-${x.positionId}`} className="text-xs font-medium text-ivory">{x.basketSlug}: reduce by ({repair.symbol})</label>
          <Input id={`sync-${x.positionId}`} inputMode="decimal" className="min-h-11 w-48 bg-space text-ivory" value={text[x.positionId] ?? ""} aria-invalid={raw[repair.positions.indexOf(x)] === null}
            onChange={(e) => setText({ ...text, [x.positionId]: e.target.value })} />
        </div>
      ))}
      <p role="status" className={cn("text-sm", sum === total ? "text-success" : "text-warning")}>Must add up to {exact(repair.totalShortfall, decimals)} {repair.symbol}</p>
      <Button type="submit" className="min-h-11" disabled={!valid || save.isPending}>{save.isPending && <Loader2 aria-hidden className="animate-spin" />}Save</Button>
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
  if (portfolio.isPending) return <p role="status" className="text-sm text-stone">Loading…</p>;
  if (portfolio.isError) return <p role="alert" className="text-sm text-danger">{toDisplayError(portfolio.error).title}</p>;
  const repair = portfolio.data.repairs.find((r) => r.asset === asset);
  if (!repair) return <p role="status" className="text-sm text-ivory">Nothing needs repair here. <Link href="/portfolio" className="text-mint underline">Back to portfolio</Link></p>;
  const decimals = repair.asset === "cash" ? 6 : (portfolio.data.positions.flatMap((p) => p.holdings).find((h) => h.deploymentId === repair.asset)?.decimals ?? 0);
  const active = repair.asset === "cash" ? "sync" : tab;
  // Reset the forms when the server's figures change.
  const figures = repair.positions.map((x) => x.shortfall).join(",");

  return (
    <section aria-labelledby="repair-title" className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 id="repair-title" className="font-display text-3xl font-bold text-ivory">Repair {repair.symbol}</h1>
        <p className="text-sm text-stone">Your wallet holds {exact(repair.totalShortfall, decimals)} {repair.symbol} less than your baskets record. <Link href="/portfolio" className="text-mint underline">Back to portfolio</Link></p>
      </div>
      {changed && <p role="alert" className="rounded-xl border border-warning/40 p-3 text-sm text-ivory">Your holdings changed — review the new figures</p>}
      <ul className="divide-y divide-border-dark text-sm">
        {repair.positions.map((x) => (
          <li key={x.positionId} className="flex flex-wrap justify-between gap-2 py-2">
            <span className="text-ivory">{x.basketSlug}</span>
            <span className="text-stone">Recorded {exact(x.ledger, decimals)} · allocated {exact((BigInt(x.ledger) - BigInt(x.shortfall)).toString(), decimals)} · short {exact(x.shortfall, decimals)}</span>
          </li>
        ))}
      </ul>
      <div role="group" aria-label="Repair method" className="flex gap-2">
        {repair.asset !== "cash" && <button type="button" aria-pressed={active === "buy"} onClick={() => setTab("buy")} className={cn("min-h-11 rounded-lg border border-border-dark px-3 text-sm text-stone hover:text-ivory", active === "buy" && "bg-slate text-ivory")}>Buy back</button>}
        <button type="button" aria-pressed={active === "sync"} onClick={() => setTab("sync")} className={cn("min-h-11 rounded-lg border border-border-dark px-3 text-sm text-stone hover:text-ivory", active === "sync" && "bg-slate text-ivory")}>Sync</button>
      </div>
      {active === "buy" ? <BuyBack key={figures} repair={repair} decimals={decimals} /> : <Sync key={figures} repair={repair} decimals={decimals} onChanged={(c) => { setChanged(c); void qc.invalidateQueries({ queryKey: ["portfolio"] }); }} />}
    </section>
  );
}

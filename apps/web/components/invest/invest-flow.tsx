"use client";

import { feeLines } from "@repo/app-core/fees";
import { investAmountProblem } from "@repo/app-core";
import { ASSET_CHAINS, SLIPPAGE_DEFAULT_BPS, SLIPPAGE_MAX_BPS, type OperationView, type PublicBasketDetail } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, Check, Loader2, PenLine, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { DeclarationForm, isDeclarationRequired } from "@/components/eligibility/declaration-form";
import { FeeLines } from "@/components/invest/fee-lines";
import { LegProgress, LegRow } from "@/components/invest/leg-progress";
import { Button, buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/kit";
import { AllocationBar, colorAt } from "@/components/visual/allocation-ring";
import { ChainBadge } from "@/components/visual/chain-badge";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { cn } from "@/lib/utils";

const STEPS = ["Amount", "Review the plan", "Authorize in your wallet", "Done"] as const;
const SLIPPAGES = ["0.5", "1", "2", "3"];

function Stepper({ at }: { at: number }) {
  return (
    <ol aria-label="Investment steps" className="flex gap-2 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:gap-0">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === at ? "step" : undefined} className="relative flex min-w-max items-center gap-3 lg:min-w-0 lg:pb-8 lg:last:pb-0">
          {i < STEPS.length - 1 && <span aria-hidden className={cn("absolute top-8 left-[0.9375rem] hidden h-[calc(100%-2rem)] w-px lg:block", i < at ? "bg-primary" : "bg-line")} />}
          <span aria-hidden className={cn("relative grid size-8 shrink-0 place-items-center rounded-full border text-xs", i < at ? "border-primary bg-primary text-primary-ink" : i === at ? "border-primary text-ink" : "border-line-strong text-ink-faint")}>
            {i < at ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className={cn("text-sm", i === at ? "font-medium text-ink" : i < at ? "text-ink-muted" : "text-ink-faint")}>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Groups a plan's legs by the network the user signs on, so "what you will sign" reads per wallet. */
function SignSummary({ plan }: { plan: OperationView }) {
  const by = new Map<string, number>();
  for (const l of plan.legs) by.set(l.fromChain, (by.get(l.fromChain) ?? 0) + 1);
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {[...by].map(([chain, n]) => (
        <li key={chain} className="flex items-center justify-between gap-3 rounded-tile border border-line bg-surface p-4">
          <span className="flex items-center gap-2.5"><Wallet aria-hidden className="size-4 text-ink-faint" /><span className="text-sm text-ink">{chain === "solana" ? "Solana wallet" : chain === "bitcoin" ? "Bitcoin wallet" : "EVM wallet"}</span></span>
          <span className="flex items-center gap-2"><ChainBadge chain={chain} compact /><span className="text-xs text-ink-muted">{n} {n === 1 ? "signature" : "signatures"}</span></span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The full-page investment flow: amount → reviewed plan → per-step wallet authorization → result.
 * Same calls and rules as the dialog wizard; the server re-checks everything, and nothing moves without a signature.
 */
export function InvestFlow({ slug, basketId, basket }: { slug: string; basketId: string; basket: PublicBasketDetail }) {
  const ids = [useId(), useId()];
  const v = basket.version;
  const [amount, setAmount] = useState(v.minimumInvestmentUsdc ?? "");
  const [slippage, setSlippage] = useState(String(SLIPPAGE_DEFAULT_BPS / 100));
  // A new key per input change: the same key with different inputs is refused, and a repeated click with the same inputs returns the same plan.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [plan, setPlan] = useState<OperationView | null>(null);
  const [signing, setSigning] = useState(false);
  const [understood, setUnderstood] = useState(false);

  const bps = Math.round(Number(slippage) * 100);
  const problem = investAmountProblem(amount, v.minimumInvestmentUsdc, v.minimumIncrementUsdc);
  const slippageProblem = Number.isFinite(bps) && bps >= 1 && bps <= SLIPPAGE_MAX_BPS ? null : `Slippage must be between 0.01% and ${SLIPPAGE_MAX_BPS / 100}%.`;
  const preview = useMutation({ mutationFn: () => api.investPlan({ basketId, amountUsdc: amount, slippageBps: bps, idempotencyKey: key }), onSuccess: (p) => { setPlan(p); setUnderstood(false); } });
  const discard = useMutation({ mutationFn: (id: string) => api.cancelOperation(id), onSettled: () => setPlan(null) });
  const err = preview.error ?? discard.error;
  const at = signing ? 2 : plan ? 1 : 0;
  const amountNum = Number(amount) || 0;
  const fees = plan ? feeLines(plan.fees) : null;
  const feeMicro = plan ? plan.fees.filter((f) => f.waivedReason === null).reduce((t, f) => t + Number(f.amountMicro), 0) : 0;
  const min = Number(v.minimumInvestmentUsdc ?? 0);
  const quick = min > 0 ? [min, min * 2, min * 5, min * 10] : [];
  const change = (fn: () => void) => { fn(); setKey(crypto.randomUUID()); };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[13rem_minmax(0,1fr)_20rem] lg:gap-12">
      <div className="order-1 min-w-0 lg:order-none lg:pt-2"><div className="lg:sticky lg:top-28"><Stepper at={at} /></div></div>

      <div className="order-3 min-w-0 space-y-8 lg:order-none">
        {signing && plan ? (
          <section aria-labelledby="sign-title" className="space-y-6">
            <div className="space-y-2">
              <h2 id="sign-title" className="type-title text-ink">Authorize each step</h2>
              <p className="text-ink-muted">For every step you get a fresh quote first, then approve exactly that transaction in your wallet. You can stop between steps.</p>
            </div>
            <div className="rounded-card border border-line bg-surface p-5 sm:p-6"><LegProgress operationId={plan.id} /></div>
            <Link href="/portfolio" className={buttonVariants({ variant: "secondary" })}>Go to portfolio</Link>
          </section>
        ) : plan ? (
          <section aria-labelledby="review-title" className="space-y-8">
            <div className="space-y-2">
              <h2 id="review-title" className="type-title text-ink">Review the plan</h2>
              <p className="text-ink-muted">This is everything that will happen. Nothing is sent until you approve each step in your wallet.</p>
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
              <div className="bg-surface p-4"><dt className="text-xs text-ink-muted">You pay</dt><dd className="mt-1 type-figure text-2xl text-ink">{amount} <span className="text-sm text-ink-muted">USDC</span></dd></div>
              <div className="bg-surface p-4"><dt className="text-xs text-ink-muted">Fees</dt><dd className="mt-1 type-figure text-2xl text-ink">{(feeMicro / 1e6).toFixed(2)} <span className="text-sm text-ink-muted">USDC</span></dd></div>
              <div className="bg-surface p-4"><dt className="text-xs text-ink-muted">Invested in assets</dt><dd className="mt-1 type-figure text-2xl text-ink">≈{Math.max(0, amountNum - feeMicro / 1e6).toFixed(2)} <span className="text-sm text-ink-muted">USDC</span></dd></div>
              <div className="bg-surface p-4"><dt className="text-xs text-ink-muted">Signatures</dt><dd className="mt-1 type-figure text-2xl text-ink">{plan.legs.length}</dd></div>
            </dl>
            <p className="text-xs text-ink-muted">Route costs (DEX, bridge) are inside each step&apos;s estimate; every step has a guaranteed minimum and is re-quoted when you sign it.</p>
            <div className="space-y-3">
              <h3 className="type-eyebrow text-ink-faint">What you will sign</h3>
              <SignSummary plan={plan} />
            </div>
            <div className="space-y-3">
              <h3 className="type-eyebrow text-ink-faint">Steps, in order</h3>
              <ol className="space-y-3">{plan.legs.map((l) => <LegRow key={l.id} leg={l} buying showStatus={false} />)}</ol>
              <p className="text-sm text-ink-muted">Outputs are estimates; each step is protected by a minimum you will receive ({slippage}% slippage). Prices are re-quoted when you sign each step.</p>
            </div>
            <div className="rounded-card border border-line bg-surface p-5"><FeeLines fees={plan.fees} /></div>
            <label className="flex cursor-pointer gap-3 rounded-tile border border-line bg-surface-muted p-4 text-sm text-ink">
              <input type="checkbox" className="mt-0.5 size-4 accent-[var(--c-primary)]" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>I&apos;ll sign each step in my own wallet. If the operation doesn&apos;t complete, fees already paid are not refunded and what settled stays in my wallet.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" disabled={!understood} onClick={() => setSigning(true)}><PenLine aria-hidden />Continue to signing</Button>
              <Button variant="secondary" size="lg" disabled={discard.isPending} onClick={() => discard.mutate(plan.id)}>Back</Button>
            </div>
          </section>
        ) : (
          <form aria-labelledby="amount-title" className="space-y-8" onSubmit={(e) => { e.preventDefault(); preview.mutate(); }}>
            <div className="space-y-2">
              <h2 id="amount-title" className="type-title text-ink">How much do you want to invest?</h2>
              <p className="text-ink-muted">Funded in USDC from your Solana wallet. The fees are taken from this amount.</p>
            </div>
            <div className="space-y-3">
              <label htmlFor={ids[0]} className="sr-only">Amount (USDC on Solana)</label>
              <div className={cn("flex items-baseline gap-3 rounded-card border bg-surface px-6 py-5 transition-colors focus-within:border-focus", amount !== "" && problem ? "border-danger" : "border-line-strong")}>
                <input id={ids[0]} inputMode="decimal" autoComplete="off" value={amount} aria-invalid={amount !== "" && problem !== null} aria-describedby={`${ids[0]}-help`}
                  onChange={(e) => change(() => setAmount(e.target.value.trim()))}
                  className="w-full min-w-0 bg-transparent type-figure text-5xl text-ink outline-none placeholder:text-ink-faint sm:text-6xl" placeholder="0" />
                <span className="text-lg text-ink-muted">USDC</span>
              </div>
              <p id={`${ids[0]}-help`} className={cn("text-sm", amount !== "" && problem ? "text-danger" : "text-ink-muted")}>{amount !== "" && problem ? problem : `Minimum ${v.minimumInvestmentUsdc ?? "not set"} USDC${v.minimumIncrementUsdc ? `, in steps of ${v.minimumIncrementUsdc} USDC` : ""}.`}</p>
              {quick.length > 0 && (
                <div className="flex flex-wrap gap-2">{quick.map((q) => <button key={q} type="button" onClick={() => change(() => setAmount(String(q)))} className={cn("min-h-9 rounded-pill border px-3.5 text-sm transition-colors", Number(amount) === q ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-muted hover:text-ink")}>{q.toLocaleString()} USDC</button>)}</div>
              )}
            </div>

            <fieldset className="space-y-3">
              <legend className="mb-3 text-sm font-medium text-ink">Slippage tolerance</legend>
              <div className="flex flex-wrap items-center gap-2">
                {SLIPPAGES.map((s) => <button key={s} type="button" aria-pressed={slippage === s} onClick={() => change(() => setSlippage(s))} className={cn("min-h-10 rounded-pill border px-4 text-sm transition-colors", slippage === s ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-muted hover:text-ink")}>{s}%</button>)}
                <label htmlFor={ids[1]} className="ml-1 text-xs text-ink-muted">Custom<span className="sr-only"> slippage tolerance (%)</span></label>
                <input id={ids[1]} inputMode="decimal" value={slippage} aria-invalid={slippageProblem !== null} onChange={(e) => change(() => setSlippage(e.target.value.trim()))}
                  className="h-10 w-20 rounded-pill border border-line bg-surface px-3 text-center text-sm text-ink outline-none focus:border-focus" />
              </div>
              <p className={cn("text-xs", slippageProblem ? "text-danger" : "text-ink-muted")}>{slippageProblem ?? "The most a price may move against you per step. Default 1%, at most 3%."}</p>
            </fieldset>

            <div className="space-y-4 rounded-card border border-line bg-surface p-6">
              <div className="flex items-baseline justify-between gap-3"><h3 className="type-eyebrow text-ink-faint">Target split</h3><span className="text-xs text-ink-faint">before fees · estimate</span></div>
              <AllocationBar slices={basket.allocation.map((a) => ({ key: a.instrumentId, label: a.symbol, bps: a.targetWeightBps }))} label="Target split of your investment" className="h-2" />
              <ul className="divide-y divide-line">
                {basket.allocation.map((a, i) => (
                  <li key={a.instrumentId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2.5"><span aria-hidden className="size-2 rounded-full" style={{ background: colorAt(i) }} /><span className="truncate text-ink">{a.name}</span><span className="hidden gap-1 sm:flex">{a.chains.slice(0, 2).map((c) => <ChainBadge key={c} chain={c} compact />)}</span></span>
                    <span className="shrink-0 font-mono text-xs text-ink-muted tabular-nums">{(a.targetWeightBps / 100).toFixed(a.targetWeightBps % 100 ? 1 : 0)}% · ≈{((amountNum * a.targetWeightBps) / 10_000).toFixed(2)} USDC</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-faint">Assets on {[...new Set(basket.allocation.flatMap((a) => a.chains))].map((c) => ASSET_CHAINS[c as keyof typeof ASSET_CHAINS]?.label ?? c).join(", ")} are bought from USDC on Solana and settle in your linked wallets.</p>
            </div>

            <Button type="submit" size="lg" disabled={problem !== null || slippageProblem !== null || preview.isPending}>
              {preview.isPending && <Loader2 aria-hidden className="animate-spin" />}Get preview
            </Button>
          </form>
        )}
        {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
        {err && !isDeclarationRequired(err) && <div role="alert" className="rounded-tile border border-danger/25 bg-danger-soft p-4 text-sm text-ink"><p className="font-medium">{toDisplayError(err).title}</p><p className="text-ink-muted">{toDisplayError(err).message}</p></div>}
      </div>

      <aside aria-label="Summary" className="order-2 space-y-4 lg:order-none">
        <div className="space-y-5 rounded-card border border-line bg-surface p-6 lg:sticky lg:top-28">
          <div>
            <p className="type-eyebrow text-ink-faint">Investing in</p>
            <p className="mt-2 text-lg text-ink">{v.name}</p>
            <p className="text-sm text-ink-muted">{basket.organization.displayName} · version {v.versionNumber}</p>
          </div>
          <dl className="space-y-2 border-t border-line pt-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-ink-muted">Amount</dt><dd className="text-ink tabular-nums">{amount || "—"} USDC</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-muted">Slippage</dt><dd className="text-ink">{slippage}%</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-ink-muted">Fees</dt><dd className="text-ink">{fees ? fees.total : "Shown in the preview"}</dd></div>
            {plan && <div className="flex justify-between gap-3"><dt className="text-ink-muted">Steps to sign</dt><dd className="text-ink">{plan.legs.length}</dd></div>}
          </dl>
          <Callout tone="neutral" icon={<ShieldCheck />} title="Your wallet, your signature">The assets settle in your own wallets. Bytesac never holds your keys or funds.</Callout>
          <Link href={`/baskets/${slug}`} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"><ArrowLeft aria-hidden className="size-3.5" />Back to research</Link>
        </div>
      </aside>
    </div>
  );
}

"use client";

import { ASSET_TYPE_LABEL } from "@repo/app-core";
import { BASKET_CATEGORY_LABEL, REVIEW_FREQUENCY_LABEL } from "@repo/app-core/basket-status";
import { formatBps } from "@repo/app-core/format";
import type { AssetType, BasketVersionView } from "@repo/validator";
import { ShieldAlert } from "lucide-react";
import type { ReactNode } from "react";
import { AllocationLegend, AllocationRing, colorAt } from "@/components/visual/allocation-ring";
import { ChainBadge } from "@/components/visual/chain-badge";
import { feeText, PLATFORM_OPERATION_LABEL, rateText } from "@/lib/fees";

/** The content fields a manager preview, an ops snapshot and the public page all share. */
export type BasketContent = Pick<BasketVersionView,
  "name" | "shortDescription" | "longDescription" | "category" | "tags" | "objective" | "thesis" | "methodology" | "intendedInvestor" | "horizon" | "keyAssumptions" | "knownLimitations" |
  "strategyRisks" | "liquidityNotes" | "conflictsOfInterest" | "constraints" | "rebalance" | "fees" | "minimumInvestmentUsdc" | "minimumIncrementUsdc">;

export interface AllocationRow {
  key: string; name: string; symbol: string; assetType: AssetType; targetWeightBps: number; minWeightBps: number | null; maxWeightBps: number | null; rationale?: string | null; price?: ReactNode; chains?: string[];
}



const Section = ({ id, title, eyebrow, children }: { id: string; title: string; eyebrow?: string; children: ReactNode }) => (
  <section id={id} aria-label={title} className="scroll-mt-28 space-y-6 border-t border-line pt-10">
    <div className="space-y-2">
      {eyebrow && <p className="type-eyebrow text-ink-faint">{eyebrow}</p>}
      <h2 className="type-heading text-ink">{title}</h2>
    </div>
    {children}
  </section>
);
const Text = ({ label, value, wide = false }: { label: string; value: string | null; wide?: boolean }) => value ? (
  <div className={wide ? "sm:col-span-2" : undefined}>
    <dt className="type-eyebrow text-ink-faint">{label}</dt>
    <dd className="mt-2 text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-ink">{value}</dd>
  </div>
) : null;

const isRwa = (t: AssetType) => t.startsWith("TOKENIZED_");

/** Plain-text rendering of a basket's content. Every string is rendered as text, never as HTML. */
export function BasketView({ content: c, allocation, disclosures, platformFee = [] }: {
  content: BasketContent; allocation: AllocationRow[]; disclosures: { title: string; body: string }[]; platformFee?: { operationKind: string; bps: number; minUsdc: string | null; maxUsdc: string | null }[];
}) {
  const constraints = [
    c.constraints.maxWeightPerAssetBps !== undefined && `No asset above ${formatBps(c.constraints.maxWeightPerAssetBps)}`,
    c.constraints.maxStablecoinBps !== undefined && `Stablecoins up to ${formatBps(c.constraints.maxStablecoinBps)}`,
    c.constraints.maxRwaBps !== undefined && `Tokenized assets up to ${formatBps(c.constraints.maxRwaBps)}`,
  ].filter(Boolean);
  const f = c.fees;
  const slices = allocation.map((a) => ({ key: a.key, label: `${a.name} (${a.symbol})`, bps: a.targetWeightBps }));
  return (
    <div className="space-y-14">
      <Section id="overview" title="Overview" eyebrow={`${BASKET_CATEGORY_LABEL[c.category]}${c.tags.length > 0 ? ` · ${c.tags.join(", ")}` : ""}`}>
        {c.thesis && (
          <figure className="space-y-3">
            <figcaption className="type-eyebrow text-ink-faint">Thesis</figcaption>
            <blockquote className="max-w-3xl text-[clamp(1.25rem,1.05rem+0.7vw,1.625rem)] leading-snug font-light tracking-tight whitespace-pre-wrap text-ink">{c.thesis}</blockquote>
          </figure>
        )}
        <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          <Text label="Summary" value={c.shortDescription} wide />
          <Text label="Description" value={c.longDescription} wide />
          <Text label="Objective" value={c.objective} />
          <Text label="Methodology" value={c.methodology} />
          <Text label="Intended investor" value={c.intendedInvestor} />
          <Text label="Horizon" value={c.horizon} />
          <Text label="Key assumptions" value={c.keyAssumptions} />
          <Text label="Known limitations" value={c.knownLimitations} />
        </dl>
      </Section>

      <Section id="allocation" title="Allocation" eyebrow="Target weights">
        {allocation.length === 0 ? <p className="text-sm text-ink-muted">No assets yet.</p> : (
          <>
            <div className="grid items-center gap-8 rounded-card border border-line bg-surface p-6 md:grid-cols-[auto_1fr] md:p-8">
              <AllocationRing slices={slices} size={208} thickness={18} className="mx-auto" label={`Target allocation: ${allocation.map((a) => `${a.symbol} ${formatBps(a.targetWeightBps)}`).join(", ")}`}>
                <div><p className="type-figure text-3xl text-ink">{allocation.length}</p><p className="text-xs text-ink-muted">{allocation.length === 1 ? "asset" : "assets"}</p></div>
              </AllocationRing>
              <AllocationLegend slices={slices} />
            </div>
            <p className="text-sm text-ink-muted">These are the strategy&apos;s target weights. What you hold after investing is read from your wallets and shown in your portfolio — it can differ.</p>
            <div className="overflow-x-auto rounded-card border border-line bg-surface">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-xs text-ink-faint"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>Asset</th><th>Type</th><th>Networks</th><th className="text-right">Target</th><th className="text-right">Band</th><th className="text-right">Price</th></tr></thead>
                <tbody>
                  {allocation.map((a, i) => (
                    <tr key={a.key} className="border-t border-line align-top [&>td]:px-4 [&>td]:py-3.5">
                      <td>
                        <span className="flex items-start gap-2.5">
                          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: colorAt(i) }} />
                          <span><span className="font-medium text-ink">{a.name}</span> <span className="text-ink-muted">{a.symbol}</span>{a.rationale && <span className="mt-1 block text-xs whitespace-pre-wrap text-ink-muted">{a.rationale}</span>}</span>
                        </span>
                      </td>
                      <td className="text-ink-muted"><span className="inline-flex items-center gap-1.5">{isRwa(a.assetType) && <ShieldAlert aria-hidden className="size-3.5" />}{ASSET_TYPE_LABEL[a.assetType]}</span></td>
                      <td>{a.chains && a.chains.length > 0 ? <span className="flex flex-wrap gap-1">{a.chains.map((ch) => <ChainBadge key={ch} chain={ch} compact />)}</span> : <span className="text-ink-faint">—</span>}</td>
                      <td className="text-right font-mono text-ink tabular-nums">{formatBps(a.targetWeightBps)}</td>
                      <td className="text-right font-mono text-xs text-ink-muted tabular-nums">{a.minWeightBps === null && a.maxWeightBps === null ? "—" : `${formatBps(a.minWeightBps ?? 0)} to ${formatBps(a.maxWeightBps ?? 10_000)}`}</td>
                      <td className="text-right text-xs text-ink-muted tabular-nums">{a.price ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div>
          <h3 className="type-eyebrow text-ink-faint">Constraints</h3>
          {constraints.length === 0 ? <p className="mt-2 text-sm text-ink-muted">No extra constraints.</p> : <ul className="mt-3 flex flex-wrap gap-2">{constraints.map((t) => <li key={String(t)} className="rounded-pill border border-line bg-surface px-3 py-1 text-sm text-ink">{t}</li>)}</ul>}
        </div>
      </Section>

      <Section id="rebalancing" title="Rebalancing">
        <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
          <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Review</dt><dd className="mt-1 text-ink">{REVIEW_FREQUENCY_LABEL[c.rebalance.reviewFrequency]}</dd></div>
          <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Drift threshold</dt><dd className="mt-1 text-ink">{c.rebalance.driftThresholdBps !== undefined ? formatBps(c.rebalance.driftThresholdBps) : "Platform default"}</dd></div>
          <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Minimum trade</dt><dd className="mt-1 text-ink">{[c.rebalance.minTradeBps !== undefined && `${c.rebalance.minTradeBps} bps`, c.rebalance.minTradeUsdc !== undefined && `${c.rebalance.minTradeUsdc} USDC`].filter(Boolean).join(" · ") || "Platform default"}</dd></div>
        </dl>
        <p className="max-w-2xl text-sm text-ink-muted">These are the manager&apos;s review intentions, not a promise. A rebalance is only a new proposal. Nothing changes in your holdings unless you give your explicit consent.</p>
      </Section>

      <Section id="fees" title="Fees and minimums">
        <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2">
          <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Entry fee</dt><dd className="mt-1 text-ink">{feeText(f.entry)}</dd></div>
          <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Rebalance fee</dt><dd className="mt-1 text-ink">{feeText(f.rebalance)}</dd></div>
          <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Management fee (per year)</dt><dd className="mt-1 text-ink">{feeText(f.management)} <span className="block text-xs text-ink-faint">Disclosed — not collected in this release</span></dd></div>
          <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Subscription</dt><dd className="mt-1 text-ink">{f.subscription ? <>{`${f.subscription.amountUsdc} USDC per ${f.subscription.period === "monthly" ? "month" : "year"}`} <span className="block text-xs text-ink-faint">Disclosed — not collected in this release</span></> : "None"}</dd></div>
          <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Minimum investment</dt><dd className="mt-1 text-ink">{c.minimumInvestmentUsdc ? `${c.minimumInvestmentUsdc} USDC` : "Not set"}</dd></div>
          {c.minimumIncrementUsdc && <div className="bg-surface p-5"><dt className="text-xs text-ink-muted">Minimum increment</dt><dd className="mt-1 text-ink">{c.minimumIncrementUsdc} USDC</dd></div>}
        </dl>
        {platformFee.length > 0 && (
          <div className="space-y-2">
            <h3 className="type-eyebrow text-ink-faint">Bytesac platform fee</h3>
            <ul className="flex flex-wrap gap-2 text-sm text-ink">{platformFee.map((p) => <li key={p.operationKind} className="rounded-pill border border-line bg-surface px-3 py-1">{PLATFORM_OPERATION_LABEL[p.operationKind] ?? p.operationKind}: {rateText(p.bps, p.minUsdc, p.maxUsdc)}</li>)}</ul>
          </div>
        )}
        <p className="text-xs text-ink-muted">Entry and rebalance fees are paid up front in USDC when you invest or rebalance; nothing is charged or invested on this page.</p>
      </Section>

      <Section id="risks" title="Risks and disclosures">
        <dl className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          <Text label="Strategy risks" value={c.strategyRisks} wide />
          <Text label="Liquidity" value={c.liquidityNotes} />
          <Text label="Conflicts of interest" value={c.conflictsOfInterest} />
        </dl>
        <ul className="space-y-3">
          {disclosures.map((d) => <li key={d.title} className="rounded-tile bg-surface-muted p-5"><p className="text-sm font-medium text-ink">{d.title}</p><p className="mt-1.5 text-sm whitespace-pre-wrap text-ink-muted">{d.body}</p></li>)}
        </ul>
      </Section>
    </div>
  );
}

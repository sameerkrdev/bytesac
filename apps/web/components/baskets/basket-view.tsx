"use client";

import { ASSET_TYPE_LABEL, BASKET_CATEGORY_LABEL, REVIEW_FREQUENCY_LABEL, formatBps } from "@repo/app-core";
import type { AssetType, BasketVersionView, Fee } from "@repo/validator";
import type { ReactNode } from "react";

/** The content fields a manager preview, an ops snapshot and the public page all share. */
export type BasketContent = Pick<BasketVersionView,
  "name" | "shortDescription" | "longDescription" | "category" | "tags" | "objective" | "thesis" | "methodology" | "intendedInvestor" | "horizon" | "keyAssumptions" | "knownLimitations" |
  "strategyRisks" | "liquidityNotes" | "conflictsOfInterest" | "constraints" | "rebalance" | "fees" | "minimumInvestmentUsdc" | "minimumIncrementUsdc">;

export interface AllocationRow {
  key: string; name: string; symbol: string; assetType: AssetType; targetWeightBps: number; minWeightBps: number | null; maxWeightBps: number | null; rationale?: string | null; price?: ReactNode;
}

const fee = (f: Fee) => (f.type === "percent" ? formatBps(f.bps) : `${f.amountUsdc} USDC`);

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label={title} className="space-y-3">
    <h2 className="font-display text-xl font-semibold text-ivory">{title}</h2>
    {children}
  </section>
);
const Text = ({ label, value }: { label: string; value: string | null }) => value ? (
  <div><dt className="text-xs text-stone">{label}</dt><dd className="whitespace-pre-wrap text-sm text-ivory">{value}</dd></div>
) : null;

/** Plain-text rendering of a basket's content. Every string is rendered as text, never as HTML. */
export function BasketView({ content: c, allocation, disclosures }: { content: BasketContent; allocation: AllocationRow[]; disclosures: { title: string; body: string }[] }) {
  const constraints = [
    c.constraints.maxWeightPerAssetBps !== undefined && `No asset above ${formatBps(c.constraints.maxWeightPerAssetBps)}`,
    c.constraints.maxStablecoinBps !== undefined && `Stablecoins up to ${formatBps(c.constraints.maxStablecoinBps)}`,
    c.constraints.maxRwaBps !== undefined && `Tokenized assets up to ${formatBps(c.constraints.maxRwaBps)}`,
  ].filter(Boolean);
  const f = c.fees;
  return (
    <div className="space-y-8">
      <Section title="Overview">
        <p className="text-sm text-stone">{BASKET_CATEGORY_LABEL[c.category]}{c.tags.length > 0 && ` · ${c.tags.join(", ")}`}</p>
        <dl className="space-y-3">
          <Text label="Summary" value={c.shortDescription} />
          <Text label="Description" value={c.longDescription} />
          <Text label="Objective" value={c.objective} />
          <Text label="Thesis" value={c.thesis} />
          <Text label="Methodology" value={c.methodology} />
          <Text label="Intended investor" value={c.intendedInvestor} />
          <Text label="Horizon" value={c.horizon} />
          <Text label="Key assumptions" value={c.keyAssumptions} />
          <Text label="Known limitations" value={c.knownLimitations} />
        </dl>
      </Section>

      <Section title="Allocation">
        {allocation.length === 0 ? <p className="text-sm text-stone">No assets yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-stone"><tr><th className="py-2 pr-4 font-medium">Asset</th><th className="pr-4 font-medium">Type</th><th className="pr-4 font-medium">Weight</th><th className="pr-4 font-medium">Band</th><th className="font-medium">Price</th></tr></thead>
              <tbody>
                {allocation.map((a) => (
                  <tr key={a.key} className="border-t border-border-dark align-top">
                    <td className="py-3 pr-4"><span className="font-medium text-ivory">{a.name}</span> <span className="text-stone">{a.symbol}</span>{a.rationale && <span className="block whitespace-pre-wrap text-xs text-stone">{a.rationale}</span>}</td>
                    <td className="pr-4 text-stone">{ASSET_TYPE_LABEL[a.assetType]}</td>
                    <td className="pr-4 text-ivory">{formatBps(a.targetWeightBps)}</td>
                    <td className="pr-4 text-stone">{a.minWeightBps === null && a.maxWeightBps === null ? "—" : `${formatBps(a.minWeightBps ?? 0)} to ${formatBps(a.maxWeightBps ?? 10_000)}`}</td>
                    <td className="text-stone">{a.price ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Constraints">
        {constraints.length === 0 ? <p className="text-sm text-stone">No extra constraints.</p> : <ul className="list-disc pl-5 text-sm text-ivory">{constraints.map((t) => <li key={String(t)}>{t}</li>)}</ul>}
      </Section>

      <Section title="Rebalancing">
        <p className="text-sm text-ivory">{REVIEW_FREQUENCY_LABEL[c.rebalance.reviewFrequency]}{c.rebalance.driftThresholdBps !== undefined && ` · drift threshold ${formatBps(c.rebalance.driftThresholdBps)}`}{c.rebalance.minTradeBps !== undefined && ` · minimum trade ${c.rebalance.minTradeBps} bps`}{c.rebalance.minTradeUsdc !== undefined && ` · minimum trade ${c.rebalance.minTradeUsdc} USDC`}</p>
        <p className="text-sm text-stone">These are the manager&apos;s review intentions, not a promise. A rebalance is only a new proposal. Nothing changes in your holdings unless you give your explicit consent.</p>
      </Section>

      <Section title="Fees and minimums">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="text-xs text-stone">Entry fee</dt><dd className="text-sm text-ivory">{fee(f.entry)}</dd></div>
          <div><dt className="text-xs text-stone">Management fee (per year)</dt><dd className="text-sm text-ivory">{fee(f.management)}</dd></div>
          <div><dt className="text-xs text-stone">Rebalance fee</dt><dd className="text-sm text-ivory">{fee(f.rebalance)}</dd></div>
          <div><dt className="text-xs text-stone">Subscription</dt><dd className="text-sm text-ivory">{f.subscription ? `${f.subscription.amountUsdc} USDC per ${f.subscription.period === "monthly" ? "month" : "year"}` : "None"}</dd></div>
          <div><dt className="text-xs text-stone">Minimum investment</dt><dd className="text-sm text-ivory">{c.minimumInvestmentUsdc ? `${c.minimumInvestmentUsdc} USDC` : "Not set"}</dd></div>
          {c.minimumIncrementUsdc && <div><dt className="text-xs text-stone">Minimum increment</dt><dd className="text-sm text-ivory">{c.minimumIncrementUsdc} USDC</dd></div>}
        </dl>
        <p className="text-xs text-stone">Fees and minimums are disclosed terms. Nothing is charged or invested here.</p>
      </Section>

      <Section title="Risks and disclosures">
        <dl className="space-y-3">
          <Text label="Strategy risks" value={c.strategyRisks} />
          <Text label="Liquidity" value={c.liquidityNotes} />
          <Text label="Conflicts of interest" value={c.conflictsOfInterest} />
        </dl>
        <ul className="space-y-3">
          {disclosures.map((d) => <li key={d.title} className="rounded-xl border border-border-dark p-3"><p className="text-sm font-medium text-ivory">{d.title}</p><p className="mt-1 whitespace-pre-wrap text-sm text-stone">{d.body}</p></li>)}
        </ul>
      </Section>
    </div>
  );
}

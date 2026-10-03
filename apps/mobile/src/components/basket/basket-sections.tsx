import { ASSET_TYPE_LABEL, BASKET_CATEGORY_LABEL, blockedAssetNotices, feeText, formatBps, PLATFORM_OPERATION_LABEL, rateText, REVIEW_FREQUENCY_LABEL, SECTOR_LABEL } from "@repo/app-core";
import type { BasketDiff, PublicBasketDetail } from "@repo/validator";
import type { ReactNode } from "react";
import { View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";

type Basket = PublicBasketDetail;

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <View accessibilityLabel={title} className="gap-3">
    <AppText variant="h3" accessibilityRole="header">{title}</AppText>
    {children}
  </View>
);
const Field = ({ label, value }: { label: string; value: string | null }) => value ? (
  <View><AppText variant="label" tone="stone">{label}</AppText><AppText>{value}</AppText></View>
) : null;

/** Plain-text lines for a version diff. */
export function diffLines(diff: BasketDiff, names: Record<string, string>): string[] {
  const n = (id: string) => names[id] ?? `Asset ${id.slice(0, 8)}`;
  return [
    ...diff.added.map((a) => `Added ${n(a.instrumentId)} at ${formatBps(a.weightBps)}`),
    ...diff.removed.map((a) => `Removed ${n(a.instrumentId)} (was ${formatBps(a.weightBps)})`),
    ...diff.changed.map((a) => `${n(a.instrumentId)}: ${formatBps(a.fromBps)} to ${formatBps(a.toBps)}`),
    ...diff.bandChanged.map((id) => `${n(id)}: weight band changed`),
    ...(diff.constraints ? ["Constraints changed"] : []),
    ...(diff.rebalance ? ["Rebalance disclosures changed"] : []),
    ...(diff.fees ? ["Fees changed"] : []),
    ...(diff.minimums ? ["Minimums changed"] : []),
  ];
}

/** Eligibility notices: per asset for a signed-in user, one line for a signed-out visitor. */
export function EligibilityNotices({ eligibility, names }: { eligibility: Basket["eligibility"]; names: Record<string, string> }) {
  if (!eligibility.requirements) return null;
  if (!eligibility.assets) return <AppText className="rounded-xl border border-warning/40 p-3">Some assets have eligibility requirements</AppText>;
  const blocked = blockedAssetNotices(eligibility.assets);
  if (blocked.length === 0) return null;
  return (
    <View accessibilityLabel="Eligibility" className="gap-1 rounded-xl border border-warning/40 p-3">
      {blocked.map((a) => <AppText key={a.instrumentId}>{names[a.instrumentId] ?? "An asset"}: {a.text}</AppText>)}
    </View>
  );
}

/** Allocation, fees, text sections, sectors, history and managers of a published basket. Every string is rendered as text. */
export function BasketSections({ b }: { b: Basket }) {
  const c = b.version;
  const f = c.fees;
  const names = Object.fromEntries(b.allocation.map((a) => [a.instrumentId, `${a.name} (${a.symbol})`]));
  const constraints = [
    c.constraints.maxWeightPerAssetBps !== undefined && `No asset above ${formatBps(c.constraints.maxWeightPerAssetBps)}`,
    c.constraints.maxStablecoinBps !== undefined && `Stablecoins up to ${formatBps(c.constraints.maxStablecoinBps)}`,
    c.constraints.maxRwaBps !== undefined && `Tokenized assets up to ${formatBps(c.constraints.maxRwaBps)}`,
  ].filter(Boolean) as string[];
  return (
    <View className="gap-6">
      <Section title="Overview">
        <AppText tone="stone">{BASKET_CATEGORY_LABEL[c.category]}{c.tags.length > 0 ? ` · ${c.tags.join(", ")}` : ""}</AppText>
        <Field label="Summary" value={c.shortDescription} />
        <Field label="Description" value={c.longDescription} />
        <Field label="Objective" value={c.objective} />
        <Field label="Thesis" value={c.thesis} />
        <Field label="Methodology" value={c.methodology} />
        <Field label="Intended investor" value={c.intendedInvestor} />
        <Field label="Horizon" value={c.horizon} />
        <Field label="Key assumptions" value={c.keyAssumptions} />
        <Field label="Known limitations" value={c.knownLimitations} />
      </Section>

      <Section title="Allocation">
        {b.allocation.length === 0 ? <AppText tone="stone">No assets yet.</AppText> : b.allocation.map((a) => {
          const p = a.prices.find((x) => x.status === "ok" && x.value !== null);
          return (
            <Card key={a.instrumentId} className="gap-1 p-4">
              <View className="flex-row justify-between gap-3">
                <AppText className="flex-1 font-sans-semibold">{a.name} <AppText tone="stone">{a.symbol}</AppText></AppText>
                <AppText className="font-sans-semibold">{formatBps(a.targetWeightBps)}</AppText>
              </View>
              <AppText variant="label" tone="stone">
                {ASSET_TYPE_LABEL[a.assetType]}
                {a.minWeightBps === null && a.maxWeightBps === null ? "" : ` · band ${formatBps(a.minWeightBps ?? 0)} to ${formatBps(a.maxWeightBps ?? 10_000)}`}
                {` · ${p ? `${p.value} ${p.currency}${p.stale ? " (stale)" : ""}` : "Price unavailable"}`}
              </AppText>
            </Card>
          );
        })}
      </Section>

      {(b.sectors.length > 0 || b.tags.length > 0) && (
        <Section title="Sectors">
          {b.sectors.map((s) => <View key={s.sector} className="flex-row justify-between"><AppText>{SECTOR_LABEL[s.sector]}</AppText><AppText>{formatBps(s.bps)}</AppText></View>)}
          {b.tags.length > 0 ? <AppText tone="stone">Tags: {b.tags.map((t) => t.label).join(", ")}</AppText> : null}
        </Section>
      )}

      <Section title="Constraints">
        {constraints.length === 0 ? <AppText tone="stone">No extra constraints.</AppText> : constraints.map((t) => <AppText key={t}>{`• ${t}`}</AppText>)}
      </Section>

      <Section title="Rebalancing">
        <AppText>{REVIEW_FREQUENCY_LABEL[c.rebalance.reviewFrequency]}{c.rebalance.driftThresholdBps !== undefined ? ` · drift threshold ${formatBps(c.rebalance.driftThresholdBps)}` : ""}{c.rebalance.minTradeBps !== undefined ? ` · minimum trade ${c.rebalance.minTradeBps} bps` : ""}{c.rebalance.minTradeUsdc !== undefined ? ` · minimum trade ${c.rebalance.minTradeUsdc} USDC` : ""}</AppText>
        <AppText tone="stone">{"These are the manager's review intentions, not a promise. A rebalance is only a new proposal. Nothing changes in your holdings unless you give your explicit consent."}</AppText>
      </Section>

      <Section title="Fees and minimums">
        <Field label="Entry fee" value={feeText(f.entry)} />
        <Field label="Management fee (per year)" value={`${feeText(f.management)} · Disclosed — not collected in this release`} />
        <Field label="Rebalance fee" value={feeText(f.rebalance)} />
        <Field label="Subscription" value={f.subscription ? `${f.subscription.amountUsdc} USDC per ${f.subscription.period === "monthly" ? "month" : "year"} · Disclosed — not collected in this release` : "None"} />
        <Field label="Minimum investment" value={c.minimumInvestmentUsdc ? `${c.minimumInvestmentUsdc} USDC` : "Not set"} />
        <Field label="Minimum increment" value={c.minimumIncrementUsdc ? `${c.minimumIncrementUsdc} USDC` : null} />
        {b.platformFee.length > 0 && (
          <View className="gap-1">
            <AppText variant="label" tone="stone">Bytesac platform fee</AppText>
            {b.platformFee.map((p) => <AppText key={p.operationKind}>{PLATFORM_OPERATION_LABEL[p.operationKind] ?? p.operationKind}: {rateText(p.bps, p.minUsdc, p.maxUsdc)}</AppText>)}
          </View>
        )}
        <AppText variant="label" tone="stone">Entry and rebalance fees are paid up front in USDC when you invest or rebalance; nothing is charged or invested on this screen.</AppText>
      </Section>

      <Section title="Risks and disclosures">
        <Field label="Strategy risks" value={c.strategyRisks} />
        <Field label="Liquidity" value={c.liquidityNotes} />
        <Field label="Conflicts of interest" value={c.conflictsOfInterest} />
        {b.disclosures.map((d) => <Card key={d.title} className="gap-1 p-4"><AppText className="font-sans-semibold">{d.title}</AppText><AppText tone="stone">{d.body}</AppText></Card>)}
      </Section>

      <Section title="Version history">
        {b.versionHistory.map((h) => {
          const lines = diffLines(h.diff, names);
          return (
            <View key={h.versionNumber} className="gap-1">
              <AppText className="font-sans-semibold">Version {h.versionNumber} <AppText tone="stone">· {new Date(h.publishedAt).toLocaleDateString()}</AppText></AppText>
              {h.rationale ? <AppText tone="stone">{h.rationale}</AppText> : null}
              {lines.length === 0 ? <AppText variant="label" tone="stone">No changes.</AppText> : lines.map((l) => <AppText key={l} variant="label">{`• ${l}`}</AppText>)}
            </View>
          );
        })}
      </Section>

      {([["Current managers", b.managers.filter((m) => m.to === null)], ["Former managers", b.managers.filter((m) => m.to !== null)]] as const).map(([title, list]) => list.length > 0 && (
        <Section key={title} title={title}>
          {list.map((m, i) => (
            <AppText key={i}>{m.displayName}<AppText tone="stone"> · {m.role === "lead" ? "Lead" : "Co-manager"} · from {new Date(m.from).toLocaleDateString()}{m.to ? ` to ${new Date(m.to).toLocaleDateString()}` : ""}</AppText></AppText>
          ))}
        </Section>
      ))}
    </View>
  );
}

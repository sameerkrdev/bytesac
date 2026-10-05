import { ASSET_TYPE_LABEL, blockedAssetNotices, usd, feeText, formatBps, PLATFORM_OPERATION_LABEL, rateText, REVIEW_FREQUENCY_LABEL, SECTOR_LABEL } from "@repo/app-core";
import { ASSET_CHAINS, type AssetChain, type BasketDiff, type BasketFileKind, type PublicBasketDetail } from "@repo/validator";
import { router } from "expo-router";
import { ChevronRight, Download, FileText, ShieldAlert } from "lucide-react-native";
import { Fragment, useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";
import { AllocationRing, useSliceColor } from "@/components/ui/allocation-ring";
import { AppText } from "@/components/ui/app-text";
import { AssetMark } from "@/components/ui/asset-mark";
import { Card } from "@/components/ui/card";
import { Monogram } from "@/components/ui/monogram";
import { useTheme } from "@/lib/theme";

type Basket = PublicBasketDetail;

const FILE_KIND_LABEL: Record<BasketFileKind, string> = { thesis: "Thesis", factsheet: "Factsheet", methodology: "Methodology", research: "Research", other: "Other" };
const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const chainName = (c: string) => ASSET_CHAINS[c as AssetChain]?.label ?? c;
const price = (value: string, currency: string) => (currency === "USD" ? usd(Number(value)) : `${value} ${currency}`);
const date = (iso: string) => new Date(iso).toLocaleDateString();

const Section = ({ eyebrow, title, children }: { eyebrow?: string; title: string; children: ReactNode }) => (
  <View accessibilityLabel={title} className="gap-3">
    <View className="gap-1">
      {eyebrow ? <AppText variant="eyebrow" tone="faint">{eyebrow}</AppText> : null}
      <AppText variant="title" accessibilityRole="header">{title}</AppText>
    </View>
    {children}
  </View>
);

/** Label / value rows in one card with hairlines; empty values are skipped. */
const Rows = ({ rows, stacked = false }: { rows: [string, string | null][]; stacked?: boolean }) => {
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  if (shown.length === 0) return null;
  return (
    <Card className="py-1">
      {shown.map(([label, value], i) => (
        <Fragment key={label}>
          {i > 0 ? <View className="h-px bg-line" /> : null}
          {stacked ? (
            <View className="gap-1 py-3.5"><AppText variant="micro" tone="faint">{label}</AppText><AppText>{value}</AppText></View>
          ) : (
            <View className="flex-row items-start justify-between gap-4 py-3.5"><AppText tone="muted" className="flex-1">{label}</AppText><AppText className="max-w-[60%] text-right font-medium">{value}</AppText></View>
          )}
        </Fragment>
      ))}
    </Card>
  );
};

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

/** A warning callout (status, registry and eligibility notices). */
export function Notice({ children, label }: { children: ReactNode; label?: string }) {
  const { colors } = useTheme();
  return (
    <View accessibilityLabel={label} className="flex-row gap-3 rounded-card border border-warning/30 bg-warning-soft p-4">
      <ShieldAlert size={16} color={colors.warning} style={{ marginTop: 3 }} />
      <View className="flex-1 gap-1">{children}</View>
    </View>
  );
}

/** Eligibility notices: per asset for a signed-in user, one line for a signed-out visitor. */
export function EligibilityNotices({ eligibility, names }: { eligibility: Basket["eligibility"]; names: Record<string, string> }) {
  if (!eligibility.requirements) return null;
  if (!eligibility.assets) return <Notice><AppText>Some assets have eligibility requirements</AppText></Notice>;
  const blocked = blockedAssetNotices(eligibility.assets);
  if (blocked.length === 0) return null;
  return (
    <Notice label="Eligibility">
      {blocked.map((a) => <AppText key={a.instrumentId}>{names[a.instrumentId] ?? "An asset"}: {a.text}</AppText>)}
    </Notice>
  );
}

/** The target allocation: ring, then one row per asset with its weight, band, chains and price. */
function Allocation({ b }: { b: Basket }) {
  const color = useSliceColor();
  const { colors } = useTheme();
  const [pick, setPick] = useState<string | null>(null);
  if (b.allocation.length === 0) return <AppText tone="muted">No assets yet.</AppText>;
  const slices = b.allocation.map((a) => ({ key: a.instrumentId, label: a.symbol, bps: a.targetWeightBps }));
  return (
    <Card className="gap-5">
      <View className="items-center">
        <AllocationRing slices={slices} size={180} thickness={16} selected={pick} onSelect={setPick} label={`Target allocation: ${b.allocation.map((a) => `${a.symbol} ${formatBps(a.targetWeightBps)}`).join(", ")}`}>
          <AppText variant="figure">{b.allocation.length}</AppText>
          <AppText variant="micro" tone="faint">{b.allocation.length === 1 ? "asset" : "assets"}</AppText>
        </AllocationRing>
      </View>
      <View>
        {b.allocation.map((a, i) => {
          const p = a.prices.find((x) => x.status === "ok" && x.value !== null);
          const band = a.minWeightBps === null && a.maxWeightBps === null ? null : `Band ${formatBps(a.minWeightBps ?? 0)} to ${formatBps(a.maxWeightBps ?? 10_000)}`;
          return (
            <Pressable key={a.instrumentId} accessibilityRole="link" accessibilityLabel={`${a.name}, ${formatBps(a.targetWeightBps)}, asset details`} onPress={() => router.push(`/asset/${a.instrumentId}`)}
              className={`gap-2.5 py-3.5 active:opacity-70 ${i > 0 ? "border-t border-line" : ""} ${pick && pick !== a.instrumentId ? "opacity-40" : ""}`}>
              <View className="flex-row items-center gap-3">
                <AssetMark symbol={a.symbol} logoUrl={a.logoUrl} size={34} index={i} />
                <View className="flex-1 gap-0.5">
                  <AppText className="font-medium" numberOfLines={1}>{a.name} <AppText tone="faint">{a.symbol}</AppText></AppText>
                  <AppText variant="micro" tone="faint" numberOfLines={1}>{[ASSET_TYPE_LABEL[a.assetType], ...a.chains.map(chainName)].join(" · ")}</AppText>
                </View>
                <AppText variant="heading">{formatBps(a.targetWeightBps)}</AppText>
                <ChevronRight size={14} color={colors.inkFaint} />
              </View>
              <View className="h-1.5 overflow-hidden rounded-pill bg-surface-muted">
                <View className="h-full rounded-pill" style={{ width: `${a.targetWeightBps / 100}%`, backgroundColor: color(i) }} />
              </View>
              <AppText variant="micro" tone="faint">{[band, p ? `${price(p.value!, p.currency)}${p.stale ? " (stale)" : ""}` : "Price unavailable"].filter(Boolean).join(" · ")}</AppText>
            </Pressable>
          );
        })}
      </View>
    </Card>
  );
}

/** Strategy, allocation, rules, fees, risks, documents, history and managers of a published basket. Every string is rendered as text. */
export function BasketSections({ b }: { b: Basket }) {
  const { colors } = useTheme();
  const c = b.version;
  const f = c.fees;
  const names = Object.fromEntries(b.allocation.map((a) => [a.instrumentId, `${a.name} (${a.symbol})`]));
  const constraints = [
    c.constraints.maxWeightPerAssetBps !== undefined && `No asset above ${formatBps(c.constraints.maxWeightPerAssetBps)}`,
    c.constraints.maxStablecoinBps !== undefined && `Stablecoins up to ${formatBps(c.constraints.maxStablecoinBps)}`,
    c.constraints.maxRwaBps !== undefined && `Tokenized assets up to ${formatBps(c.constraints.maxRwaBps)}`,
  ].filter(Boolean) as string[];
  const managers = [["Current managers", b.managers.filter((m) => m.to === null)], ["Former managers", b.managers.filter((m) => m.to !== null)]] as const;
  return (
    <View className="gap-10">
      <Section eyebrow="Strategy" title="Allocation">
        <Allocation b={b} />
        {b.sectors.length > 0 ? (
          <Card className="gap-3">
            <AppText variant="label" tone="muted">Sectors</AppText>
            {b.sectors.map((s) => (
              <View key={s.sector} className="gap-1.5">
                <View className="flex-row justify-between"><AppText>{SECTOR_LABEL[s.sector]}</AppText><AppText className="font-medium">{formatBps(s.bps)}</AppText></View>
                <View className="h-1 overflow-hidden rounded-pill bg-surface-muted"><View className="h-full rounded-pill bg-ink-muted" style={{ width: `${s.bps / 100}%` }} /></View>
              </View>
            ))}
          </Card>
        ) : null}
        {b.tags.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5">
            {b.tags.map((t) => <View key={t.label} className="rounded-pill bg-surface-muted px-3 py-1.5"><AppText variant="micro" tone="muted">{t.label}</AppText></View>)}
          </View>
        ) : null}
      </Section>

      <Section eyebrow="Research" title="The thesis">
        <Rows stacked rows={[
          ["Description", c.longDescription], ["Objective", c.objective], ["Thesis", c.thesis], ["Methodology", c.methodology],
          ["Intended investor", c.intendedInvestor], ["Horizon", c.horizon], ["Key assumptions", c.keyAssumptions], ["Known limitations", c.knownLimitations],
        ]} />
        {c.tags.length > 0 ? <AppText variant="label" tone="faint">{c.tags.join(" · ")}</AppText> : null}
      </Section>

      <Section eyebrow="Rules" title="How it is managed">
        <Card className="gap-3">
          <AppText variant="label" tone="muted">Rebalancing</AppText>
          <AppText>{REVIEW_FREQUENCY_LABEL[c.rebalance.reviewFrequency]}{c.rebalance.driftThresholdBps !== undefined ? ` · drift threshold ${formatBps(c.rebalance.driftThresholdBps)}` : ""}{c.rebalance.minTradeBps !== undefined ? ` · minimum trade ${c.rebalance.minTradeBps} bps` : ""}{c.rebalance.minTradeUsdc !== undefined ? ` · minimum trade ${c.rebalance.minTradeUsdc} USDC` : ""}</AppText>
          <AppText variant="label" tone="muted">{"These are the manager's review intentions, not a promise. A rebalance is only a new proposal. Nothing changes in your holdings unless you give your explicit consent."}</AppText>
          <View className="h-px bg-line" />
          <AppText variant="label" tone="muted">Constraints</AppText>
          {constraints.length === 0 ? <AppText tone="muted">No extra constraints.</AppText> : constraints.map((t) => <AppText key={t}>{`• ${t}`}</AppText>)}
        </Card>
      </Section>

      <Section eyebrow="Costs" title="Fees and minimums">
        <Rows rows={[
          ["Entry fee", feeText(f.entry)],
          ["Management fee (per year)", `${feeText(f.management)} · Disclosed — not collected in this release`],
          ["Rebalance fee", feeText(f.rebalance)],
          ["Subscription", f.subscription ? `${f.subscription.amountUsdc} USDC per ${f.subscription.period === "monthly" ? "month" : "year"} · Disclosed — not collected in this release` : "None"],
          ["Minimum investment", c.minimumInvestmentUsdc ? `${c.minimumInvestmentUsdc} USDC` : "Not set"],
          ["Minimum increment", c.minimumIncrementUsdc ? `${c.minimumIncrementUsdc} USDC` : null],
          ...b.platformFee.map((p) => [`Bytesac platform fee · ${PLATFORM_OPERATION_LABEL[p.operationKind] ?? p.operationKind}`, rateText(p.bps, p.minUsdc, p.maxUsdc)] as [string, string]),
        ]} />
        <AppText variant="label" tone="faint">Entry and rebalance fees are paid up front in USDC when you invest or rebalance; nothing is charged or invested on this screen.</AppText>
      </Section>

      <Section eyebrow="Read before investing" title="Risks and disclosures">
        <Rows stacked rows={[["Strategy risks", c.strategyRisks], ["Liquidity", c.liquidityNotes], ["Conflicts of interest", c.conflictsOfInterest]]} />
        {b.disclosures.map((d) => <Card key={d.title} className="gap-1 p-4"><AppText className="font-medium">{d.title}</AppText><AppText variant="label" tone="muted">{d.body}</AppText></Card>)}
      </Section>

      {b.files.length > 0 ? (
        <Section eyebrow="From the manager" title="Documents">
          <Card className="py-1">
            {b.files.map((file, i) => (
              <Pressable key={file.id} accessibilityRole="link" accessibilityLabel={`Open ${file.title}, ${FILE_KIND_LABEL[file.kind]} PDF`} onPress={() => void Linking.openURL(file.url)}
                className={`flex-row items-center gap-3 py-3.5 active:opacity-70 ${i > 0 ? "border-t border-line" : ""}`}>
                <View className="size-10 items-center justify-center rounded-tile bg-danger-soft"><FileText size={18} color={colors.danger} /></View>
                <View className="flex-1 gap-0.5">
                  <AppText className="font-medium" numberOfLines={1}>{file.title}</AppText>
                  <AppText variant="micro" tone="faint" numberOfLines={1}>{`${FILE_KIND_LABEL[file.kind]} · PDF · ${fileSize(file.sizeBytes)}`}</AppText>
                </View>
                <Download size={18} color={colors.inkMuted} />
              </Pressable>
            ))}
          </Card>
        </Section>
      ) : null}

      <Section eyebrow="Changes" title="Version history">
        <View>
          {b.versionHistory.map((h, i) => {
            const lines = diffLines(h.diff, names);
            const lastItem = i === b.versionHistory.length - 1;
            return (
              <View key={h.versionNumber} className="flex-row gap-4">
                <View className="items-center">
                  <View className={`mt-1.5 size-2.5 rounded-pill ${i === 0 ? "bg-accent" : "bg-line-strong"}`} />
                  {!lastItem ? <View className="w-px flex-1 bg-line" /> : null}
                </View>
                <View className={`flex-1 gap-1 ${lastItem ? "" : "pb-6"}`}>
                  <AppText className="font-medium">Version {h.versionNumber} <AppText tone="faint">· {date(h.publishedAt)}</AppText></AppText>
                  {h.rationale ? <AppText tone="muted">{h.rationale}</AppText> : null}
                  {lines.length === 0 ? <AppText variant="label" tone="faint">No changes.</AppText> : lines.map((l) => <AppText key={l} variant="label" tone="muted">{`• ${l}`}</AppText>)}
                </View>
              </View>
            );
          })}
        </View>
      </Section>

      {managers.map(([title, list]) => list.length > 0 && (
        <Section key={title} eyebrow={title === "Current managers" ? `${b.organization.displayName ?? "Organization"}` : undefined} title={title}>
          <Card className="py-1">
            {list.map((m, i) => {
              const body = (
                <>
                  <Monogram name={m.displayName} />
                  <View className="flex-1 gap-0.5">
                    <AppText className="font-medium">{m.displayName}</AppText>
                    <AppText variant="micro" tone="faint">{`${m.role === "lead" ? "Lead" : "Co-manager"} · from ${date(m.from)}${m.to ? ` to ${date(m.to)}` : ""}`}</AppText>
                  </View>
                </>
              );
              const row = `flex-row items-center gap-3 py-3.5 ${i > 0 ? "border-t border-line" : ""}`;
              return m.handle ? (
                <Pressable key={i} accessibilityRole="link" accessibilityLabel={`${m.displayName}, manager profile`} onPress={() => router.push(`/manager/${m.handle}`)} className={`${row} active:opacity-70`}>
                  {body}<ChevronRight size={14} color={colors.inkFaint} />
                </Pressable>
              ) : <View key={i} className={row}>{body}</View>;
            })}
          </Card>
        </Section>
      ))}
    </View>
  );
}

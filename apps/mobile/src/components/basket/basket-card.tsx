import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL, formatBps, formatFraction } from "@repo/app-core";
import type { DiscoverySearchItem } from "@repo/validator";
import { router } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { FlatList, Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { AssetStack } from "@/components/ui/asset-mark";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTheme } from "@/lib/theme";

/** Simulated 1-year net return, coloured by sign; "New" until a year of model data exists. */
export function ReturnFigure({ value }: { value: string | null }) {
  if (value === null) return <AppText tone="muted">New</AppText>;
  return <AppText tone={Number(value) >= 0 ? "success" : "danger"} className="font-medium">{formatFraction(value, true)}</AppText>;
}

/** Annualised volatility of the simulated model with a 5-step meter on a fixed 0–100% scale (no verdict implied). */
export function VolatilityFigure({ value }: { value: string | null }) {
  if (value === null) return <AppText tone="muted">—</AppText>;
  const pct = Number(value) * 100;
  const steps = Math.min(5, Math.max(1, Math.ceil(pct / 20)));
  return (
    <View className="flex-row items-center gap-1.5">
      <View className="flex-row items-end gap-0.5" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {[1, 2, 3, 4, 5].map((s) => <View key={s} className={`w-1 rounded-full ${s <= steps ? "bg-ink-muted" : "bg-line-strong"}`} style={{ height: 4 + s * 2 }} />)}
      </View>
      <AppText className="font-medium">{`${pct.toFixed(0)}%`}</AppText>
    </View>
  );
}

const open = (slug: string) => router.push(`/basket/${slug}`);
const a11y = (b: DiscoverySearchItem) => `${b.name}, by ${b.organizationName}. Minimum ${b.minimumInvestmentUsdc} USDC. ${b.netReturn1y === null ? "New basket" : `1 year simulated ${formatFraction(b.netReturn1y, true)}`}. Largest holdings ${b.topAssets.map((a) => `${a.symbol} ${formatBps(a.bps)}`).join(", ")}.`;

/** A rail card: holdings, name, manager, description, then minimum / simulated 1y / volatility. */
export function BasketCard({ b, width = 280 }: { b: DiscoverySearchItem; width?: number }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y(b)} onPress={() => open(b.slug)} style={{ width }}
      className="gap-3 rounded-card border border-line bg-surface p-5 active:opacity-90">
      <AssetStack symbols={b.topAssets.map((a) => a.symbol)} size={32} />
      <View className="gap-1">
        <AppText variant="heading" numberOfLines={1}>{b.name}</AppText>
        <AppText variant="label" tone="muted" numberOfLines={1}>by {b.organizationName}</AppText>
      </View>
      {b.shortDescription ? <AppText tone="muted" numberOfLines={2}>{b.shortDescription}</AppText> : null}
      <View className="flex-row flex-wrap gap-1.5">
        <View className="rounded-pill bg-surface-muted px-2.5 py-1"><AppText variant="micro" tone="muted">{BASKET_CATEGORY_LABEL[b.category]}</AppText></View>
        {b.status !== "ACTIVE" ? <StatusBadge {...BASKET_STATUS_LABEL[b.status]} /> : null}
        {b.hasEligibilityRequirements ? <View className="flex-row items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-1"><ShieldAlertIcon /><AppText variant="micro" tone="muted">Eligibility</AppText></View> : null}
      </View>
      <View className="flex-row justify-between border-t border-line pt-3">
        <View className="gap-1"><AppText variant="micro" tone="faint">Min. amount</AppText><AppText className="font-medium">{`${b.minimumInvestmentUsdc} USDC`}</AppText></View>
        <View className="gap-1"><AppText variant="micro" tone="faint">1y · simulated</AppText><ReturnFigure value={b.netReturn1y} /></View>
        <View className="gap-1"><AppText variant="micro" tone="faint">Volatility</AppText><VolatilityFigure value={b.volatility} /></View>
      </View>
    </Pressable>
  );
}

function ShieldAlertIcon() {
  const { colors } = useTheme();
  return <ShieldAlert size={12} color={colors.inkMuted} />;
}

/** A list row for Discover: holdings, name, manager and the three figures on one line. */
export function BasketRow({ b }: { b: DiscoverySearchItem }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={a11y(b)} onPress={() => open(b.slug)} className="gap-3 py-4 active:opacity-80">
      <View className="flex-row items-start gap-3">
        <AssetStack symbols={b.topAssets.map((a) => a.symbol)} size={34} max={2} />
        <View className="flex-1 gap-0.5">
          <AppText className="font-medium" numberOfLines={1}>{b.name}</AppText>
          <AppText variant="label" tone="muted" numberOfLines={1}>{`${b.organizationName} · ${BASKET_CATEGORY_LABEL[b.category]}`}</AppText>
          {b.shortDescription ? <AppText variant="label" tone="faint" numberOfLines={1}>{b.shortDescription}</AppText> : null}
        </View>
      </View>
      <View className="flex-row justify-between pl-[46px]">
        <View className="gap-0.5"><AppText variant="micro" tone="faint">Min. amount</AppText><AppText>{`${b.minimumInvestmentUsdc} USDC`}</AppText></View>
        <View className="gap-0.5"><AppText variant="micro" tone="faint">1y · sim.</AppText><ReturnFigure value={b.netReturn1y} /></View>
        <View className="gap-0.5"><AppText variant="micro" tone="faint">Volatility</AppText><VolatilityFigure value={b.volatility} /></View>
      </View>
      {(b.status !== "ACTIVE" || b.hasEligibilityRequirements) ? (
        <View className="flex-row flex-wrap gap-1.5 pl-[46px]">
          {b.status !== "ACTIVE" ? <StatusBadge {...BASKET_STATUS_LABEL[b.status]} /> : null}
          {b.hasEligibilityRequirements ? <StatusBadge tone="neutral" label="Eligibility requirements" /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/** A titled horizontal rail of basket cards; renders nothing when empty. */
export function BasketRail({ title, description, items, icon }: { title: string; description?: string; items: DiscoverySearchItem[]; icon?: React.ReactNode }) {
  if (items.length === 0) return null;
  return (
    <View className="gap-3">
      <View className="gap-1">
        <View className="flex-row items-center gap-2">{icon}<AppText variant="heading" accessibilityRole="header">{title}</AppText></View>
        {description ? <AppText variant="label" tone="muted">{description}</AppText> : null}
      </View>
      <FlatList horizontal data={items} keyExtractor={(b) => b.slug} showsHorizontalScrollIndicator={false}
        snapToInterval={292} decelerationRate="fast" style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        renderItem={({ item }) => <BasketCard b={item} />} />
    </View>
  );
}

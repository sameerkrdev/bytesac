import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL, formatBps, formatFraction } from "@repo/app-core";
import type { DiscoverySearchItem } from "@repo/validator";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

/** One search result. Every string renders as text. */
export function ResultCard({ item: b }: { item: DiscoverySearchItem }) {
  const s = BASKET_STATUS_LABEL[b.status];
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${b.name}, ${b.organizationName}`} onPress={() => router.push(`/basket/${b.slug}`)}>
      <Card className="gap-2">
        <AppText variant="heading">{b.name}</AppText>
        <AppText variant="label" tone="faint">{b.organizationName} · {BASKET_CATEGORY_LABEL[b.category]}</AppText>
        {b.shortDescription ? <AppText>{b.shortDescription}</AppText> : null}
        <AppText>{b.topAssets.slice(0, 3).map((a) => `${a.symbol} ${formatBps(a.bps)}`).join(" · ")}</AppText>
        <View className="flex-row flex-wrap gap-x-5 gap-y-1">
          <AppText variant="label" tone="faint">1 y net {b.netReturn1y === null ? "New" : formatFraction(b.netReturn1y, true)}</AppText>
          <AppText variant="label" tone="faint">Minimum {b.minimumInvestmentUsdc} USDC</AppText>
          <AppText variant="label" tone="faint">Management fee {formatBps(b.managementFeeBps)}</AppText>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <StatusBadge tone={s.tone} label={s.label} />
          {b.hasEligibilityRequirements && <StatusBadge tone="neutral" label="Eligibility requirements" />}
        </View>
      </Card>
    </Pressable>
  );
}

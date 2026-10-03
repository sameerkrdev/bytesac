import { BASKET_STATUS_LABEL } from "@repo/app-core";
import type { BasketStatus } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";
import { RefreshControl, View } from "react-native";
import { palette } from "@repo/design-tokens";
import { BasketSections, EligibilityNotices } from "@/components/basket/basket-sections";
import { InvestSection } from "@/components/basket/invest-section";
import { Performance } from "@/components/basket/performance";
import { ErrorState, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";

const NOTICE: Partial<Record<BasketStatus, string>> = {
  PAUSED: "This basket is paused by its manager or by Bytesac.",
  REASSIGNMENT_REQUIRED: "The basket's lead manager left. A new lead needs approval from Bytesac.",
  RETIREMENT_PENDING: "The manager asked to retire this basket. Bytesac has not decided yet.",
  RETIRED: "This basket is retired.",
};

export default function BasketScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  // The bearer lets the API say which assets this user may buy.
  const q = useQuery({ queryKey: ["basket", slug], queryFn: () => api.getPublicBasket(slug) });
  const refresh = <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={palette.mint} />;
  if (q.isPending) return <Screen><LoadingState /></Screen>;
  if (!q.data) return <Screen refreshControl={refresh}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Screen>;
  const b = q.data;
  if ("redirectTo" in b) return <Redirect href={`/basket/${b.redirectTo}`} />;
  const names = Object.fromEntries(b.allocation.map((a) => [a.instrumentId, `${a.name} (${a.symbol})`]));
  const notice = NOTICE[b.status];
  const s = BASKET_STATUS_LABEL[b.status];
  return (
    <Screen refreshControl={refresh}>
      <View className="gap-2">
        <AppText variant="h2" accessibilityRole="header">{b.version.name}</AppText>
        <StatusBadge tone={s.tone} label={s.label} />
        <AppText tone="stone">Version {b.version.versionNumber} · published {new Date(b.version.publishedAt).toLocaleDateString()} · {b.organization.displayName ?? "Organization"}</AppText>
      </View>
      {notice ? <AppText className="rounded-xl border border-warning/40 p-3">{notice}</AppText> : null}
      {b.hasAssetWarning ? <AppText className="rounded-xl border border-warning/40 p-3">One or more assets in this basket were paused or deprecated in the registry after publication.</AppText> : null}
      <EligibilityNotices eligibility={b.eligibility} names={names} />
      <InvestSection slug={b.slug} />
      <Performance performance={b.performance} metrics={b.metrics} label={b.label} />
      <BasketSections b={b} />
    </Screen>
  );
}

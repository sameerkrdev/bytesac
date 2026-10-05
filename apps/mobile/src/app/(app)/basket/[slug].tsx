import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL } from "@repo/app-core";
import type { BasketStatus } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { Pressable, RefreshControl, View } from "react-native";
import { ReturnFigure, VolatilityFigure } from "@/components/basket/basket-card";
import { BasketSections, EligibilityNotices, Notice } from "@/components/basket/basket-sections";
import { InvestBar, InvestBlockers } from "@/components/basket/invest-section";
import { Performance } from "@/components/basket/performance";
import { ErrorState, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { AssetStack } from "@/components/ui/asset-mark";
import { Glass } from "@/components/ui/glass";
import { Screen, StickyFooter } from "@/components/ui/screen";
import { Sky } from "@/components/ui/sky";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const NOTICE: Partial<Record<BasketStatus, string>> = {
  PAUSED: "This basket is paused by its manager or by Bytesac.",
  REASSIGNMENT_REQUIRED: "The basket's lead manager left. A new lead needs approval from Bytesac.",
  RETIREMENT_PENDING: "The manager asked to retire this basket. Bytesac has not decided yet.",
  RETIRED: "This basket is retired.",
};

/** Basket research: sky hero with the key figures, notices, why you can't invest yet, simulated performance, the full research, and a sticky Invest bar. */
export default function BasketScreen() {
  const { colors } = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  // The bearer lets the API say which assets this user may buy.
  const q = useQuery({ queryKey: ["basket", slug], queryFn: () => api.getPublicBasket(slug) });
  const refresh = <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.ink} />;
  if (q.isPending) return <Screen><View className="pt-16"><LoadingState /></View></Screen>;
  if (!q.data) return <Screen refreshControl={refresh}><View className="pt-16"><ErrorState error={q.error} onRetry={() => void q.refetch()} /></View></Screen>;
  const b = q.data;
  if ("redirectTo" in b) return <Redirect href={`/basket/${b.redirectTo}`} />;
  const names = Object.fromEntries(b.allocation.map((a) => [a.instrumentId, `${a.name} (${a.symbol})`]));
  const notice = NOTICE[b.status];
  const s = BASKET_STATUS_LABEL[b.status];
  const v = b.version;
  return (
    <Screen refreshControl={refresh} edges={["left", "right"]} backdrop={<Sky height={380} />}
      footer={<StickyFooter><InvestBar slug={b.slug} minimum={v.minimumInvestmentUsdc} /></StickyFooter>}>
      <View className="gap-4 pt-24">
        <AssetStack symbols={b.allocation.map((a) => a.symbol)} size={44} max={4} />
        <View className="gap-2">
          <AppText variant="eyebrow" tone="muted">{`${BASKET_CATEGORY_LABEL[v.category]} · Version ${v.versionNumber}`}</AppText>
          <AppText variant="display" accessibilityRole="header">{v.name}</AppText>
          <View className="flex-row flex-wrap items-center gap-2">
            <Pressable accessibilityRole="link" accessibilityLabel={`by ${b.organization.displayName ?? "Organization"}, organization profile`} onPress={() => router.push(`/organization/${b.organization.id}`)} className="min-h-8 justify-center active:opacity-70">
              <AppText tone="muted" className="underline">{`by ${b.organization.displayName ?? "Organization"}`}</AppText>
            </Pressable>
            <StatusBadge tone={s.tone} label={s.label} />
          </View>
        </View>
        {v.shortDescription ? <AppText variant="lede">{v.shortDescription}</AppText> : null}
        <Glass className="flex-row justify-between rounded-card p-4">
          <View className="gap-1"><AppText variant="micro" tone="faint">Minimum</AppText><AppText className="font-medium">{v.minimumInvestmentUsdc ? `${v.minimumInvestmentUsdc} USDC` : "Not set"}</AppText></View>
          <View className="gap-1"><AppText variant="micro" tone="faint">1y · simulated</AppText><ReturnFigure value={b.metrics.available ? b.metrics.net.y1 : null} /></View>
          <View className="gap-1"><AppText variant="micro" tone="faint">Volatility</AppText><VolatilityFigure value={b.metrics.available ? b.metrics.volatility : null} /></View>
        </Glass>
        <AppText variant="micro" tone="faint">{`Published ${new Date(v.publishedAt).toLocaleDateString()}. Figures are from a simulated model, not investor results.`}</AppText>
      </View>

      {notice ? <Notice><AppText>{notice}</AppText></Notice> : null}
      {b.hasAssetWarning ? <Notice><AppText>One or more assets in this basket were paused or deprecated in the registry after publication.</AppText></Notice> : null}
      <EligibilityNotices eligibility={b.eligibility} names={names} />
      <InvestBlockers slug={b.slug} />
      <Performance performance={b.performance} metrics={b.metrics} label={b.label} />
      <BasketSections b={b} />
    </Screen>
  );
}

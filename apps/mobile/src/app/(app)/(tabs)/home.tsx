import { HEADLINE_HELP, HEADLINE_LABEL } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { ArrowRight, ChevronRight, Compass, Flame, Mail, Sparkles } from "lucide-react-native";
import { Pressable, RefreshControl, View } from "react-native";
import { BasketRail } from "@/components/basket/basket-card";
import { ErrorState, LoadingState } from "@/components/states/states";
import { PortfolioSummary, PositionRows } from "@/components/portfolio/summary";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen, Section } from "@/components/ui/screen";
import { Sky } from "@/components/ui/sky";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

/* eslint-disable-next-line @typescript-eslint/no-require-imports -- bundled art */
const PRISM = require("../../../../assets/visuals/glass-portfolio-prism-560.webp");

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** The signed-in start: value, what needs you (cause before action), your baskets, then where to look next. */
export default function HomeScreen() {
  const { colors } = useTheme();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const collections = useQuery({ queryKey: ["discover", "collections"], queryFn: () => api.getDiscoveryCollections(), retry: false });
  const suggested = useQuery({ queryKey: ["discover", "suggested"], queryFn: () => api.getSuggestedBaskets(), retry: false });
  const p = portfolio.data;
  const missingContacts = me.data && !["email", "phone"].every((t) => me.data!.contacts.some((c) => c.type === t && c.status === "verified"));
  const needs = p?.positions.filter((x) => x.headline !== "ALIGNED") ?? [];
  const refresh = () => { void portfolio.refetch(); void collections.refetch(); void suggested.refetch(); };

  return (
    <Screen tabBarInset backdrop={<Sky height={360} />} edges={["left", "right"]}
      refreshControl={<RefreshControl refreshing={portfolio.isRefetching} onRefresh={refresh} tintColor={colors.ink} />}>
      <View className="gap-1 pt-16">
        <AppText variant="eyebrow" tone="muted">{greeting()}</AppText>
        <AppText variant="display" accessibilityRole="header">Home</AppText>
      </View>

      {missingContacts && (
        <Pressable accessibilityRole="link" onPress={() => router.push("/(auth)/contact")} className="flex-row items-center gap-3 rounded-card border border-info/30 bg-info-soft p-4">
          <Mail size={18} color={colors.info} />
          <View className="flex-1 gap-0.5">
            <AppText className="font-medium">Verify your email and phone to invest</AppText>
            <AppText variant="label" tone="muted">Used for notices about your baskets and the transactions you sign.</AppText>
          </View>
          <ChevronRight size={18} color={colors.inkFaint} />
        </Pressable>
      )}

      {portfolio.isPending ? <LoadingState /> : portfolio.isError ? <ErrorState error={portfolio.error} onRetry={() => void portfolio.refetch()} /> : p && p.positions.length > 0 ? (
        <>
          <PortfolioSummary p={p} />
          {needs.length > 0 && (
            <Section title="Needs you" eyebrow={`${needs.length} of ${p.positions.length} baskets`}>
              {needs.map((x) => {
                const h = HEADLINE_LABEL[x.headline];
                return (
                  <Pressable key={x.id} accessibilityRole="link" accessibilityLabel={`${x.basketName}: ${h.label}`} onPress={() => router.push(`/position/${x.id}`)}
                    className="gap-2 rounded-card border border-line bg-surface p-5 active:opacity-90">
                    <View className="flex-row items-center justify-between gap-3">
                      <AppText className="flex-1 font-medium" numberOfLines={1}>{x.basketName}</AppText>
                      <StatusBadge tone={h.tone} label={h.label} />
                    </View>
                    <AppText variant="label" tone="muted">{HEADLINE_HELP[x.headline]}</AppText>
                    <View className="flex-row items-center gap-1 pt-1"><AppText variant="label" tone="accent">Review</AppText><ArrowRight size={14} color={colors.accent} /></View>
                  </Pressable>
                );
              })}
            </Section>
          )}
          <Section title="Your baskets" action={<Pressable accessibilityRole="link" onPress={() => router.push("/(app)/(tabs)/portfolio")} className="min-h-11 justify-center"><AppText variant="label" tone="muted">Portfolio</AppText></Pressable>}>
            <PositionRows positions={p.positions} />
          </Section>
        </>
      ) : (
        <Card className="flex-row items-center gap-4 p-6">
          <View className="flex-1 gap-3">
            <Compass size={22} color={colors.inkMuted} />
            <AppText variant="title">Find your first strategy</AppText>
            <AppText tone="muted">Research baskets from verified organizations. When you invest, you see every step and sign each one in your own wallet.</AppText>
            <Button onPress={() => router.push("/(app)/(tabs)/discover")} className="self-start">Discover baskets</Button>
          </View>
          <Image source={PRISM} style={{ width: 92, height: 92 }} contentFit="contain" accessibilityElementsHidden />
        </Card>
      )}

      <BasketRail title="Suggested for you" items={suggested.data?.items ?? []} icon={<Compass size={16} color={colors.inkMuted} />}
        description={suggested.data?.basis === "your_categories" ? "In the categories you already hold, excluding baskets you own." : "Recently published baskets you don’t hold yet."} />
      <BasketRail title="Featured" items={collections.data?.featured ?? []} icon={<Sparkles size={16} color={colors.accent} />} description="Chosen by the Bytesac team. Being featured is not advice or a view on future returns." />
      <BasketRail title="Trending" items={collections.data?.trending ?? []} icon={<Flame size={16} color={colors.warning} />} description="Most new investors over the last 30 days." />
      {(collections.data?.featured.length ?? 0) + (collections.data?.trending.length ?? 0) + (suggested.data?.items.length ?? 0) > 0 && (
        <AppText variant="micro" tone="faint">Returns and volatility on cards are simulated model performance, not actual investor results.</AppText>
      )}
    </Screen>
  );
}

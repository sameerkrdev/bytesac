import { BASKET_CATEGORY_LABEL } from "@repo/app-core";
import { basketCategorySchema, type BasketCategory, type DiscoveryFilters } from "@repo/validator";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Flame, SlidersHorizontal, Sparkles, X } from "lucide-react-native";
import { Fragment, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { BasketRail, BasketRow } from "@/components/basket/basket-card";
import { AiSearch } from "@/components/discover/ai-search";
import { Filters } from "@/components/discover/filters";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Screen, Section } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const isEmpty = (f: DiscoveryFilters) => !f.q && !f.categories?.length && !f.maxMinimumInvestmentUsdc && (!f.sort || f.sort === "relevance");

/**
 * Discover: describe what you want (AI fills structured filters only), quick category chips, the full filter form,
 * curated rails while nothing is filtered, and the server's results as one list.
 */
export default function DiscoverScreen() {
  const { colors } = useTheme();
  const [filters, setFilters] = useState<DiscoveryFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  // Remounting the filter form when filters change elsewhere (AI hand-off, category chips) keeps its fields in step.
  const [formKey, setFormKey] = useState(0);
  const q = useInfiniteQuery({
    queryKey: ["discover", filters],
    queryFn: ({ pageParam }) => api.discoverBaskets({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const collections = useQuery({ queryKey: ["discover", "collections"], queryFn: () => api.getDiscoveryCollections(), retry: false });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const apply = (f: DiscoveryFilters) => { setFilters(f); setFormKey((k) => k + 1); setShowFilters(false); };
  const toggleCategory = (c: BasketCategory) => {
    const now = filters.categories ?? [];
    const next = now.includes(c) ? now.filter((x) => x !== c) : [...now, c];
    setFilters({ ...filters, categories: next.length ? next : undefined });
    setFormKey((k) => k + 1);
  };
  const filtered = !isEmpty(filters);

  return (
    <Screen tabBarInset eyebrow="Research" title="Discover" description="Baskets published by organizations. Read the strategy, fees and risks before you invest."
      refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => { void q.refetch(); void collections.refetch(); }} tintColor={colors.ink} />}>
      <AiSearch onUseFilters={apply} />

      <View className="gap-3">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
          <Button variant={showFilters ? "primary" : "secondary"} size="sm" onPress={() => setShowFilters(!showFilters)} accessibilityLabel={showFilters ? "Hide filters" : "Filters"}
            icon={<SlidersHorizontal size={16} color={showFilters ? colors.primaryInk : colors.ink} />}>{showFilters ? "Hide filters" : "Filters"}</Button>
          {basketCategorySchema.options.map((c) => <Chip key={c} label={BASKET_CATEGORY_LABEL[c]} selected={filters.categories?.includes(c) ?? false} onPress={() => toggleCategory(c)} />)}
        </ScrollView>
        {filtered && !showFilters ? (
          <View className="flex-row items-center justify-between gap-3">
            <AppText variant="label" tone="muted" className="flex-1" numberOfLines={1}>{summary(filters)}</AppText>
            <Button variant="ghost" size="sm" onPress={() => apply({})} icon={<X size={14} color={colors.ink} />}>Clear all</Button>
          </View>
        ) : null}
        {showFilters ? <Card><Filters key={formKey} filters={filters} onApply={apply} /></Card> : null}
      </View>

      {!filtered ? (
        <>
          <BasketRail title="Featured" items={collections.data?.featured ?? []} icon={<Sparkles size={16} color={colors.accent} />} description="Chosen by the Bytesac team. Being featured is not advice or a view on future returns." />
          <BasketRail title="Trending" items={collections.data?.trending ?? []} icon={<Flame size={16} color={colors.warning} />} description="Most new investors over the last 30 days." />
        </>
      ) : null}

      <Section title={filtered ? "Results" : "All baskets"}>
        {q.isPending && <LoadingState />}
        {q.isError && !q.data && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
        {q.isError && q.data && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
        {q.data && items.length === 0 && <EmptyState title="No baskets match. Try removing a filter." />}
        {items.length > 0 ? (
          <Card className="py-1">
            {items.map((b, i) => <Fragment key={b.slug}>{i > 0 ? <View className="h-px bg-line" /> : null}<BasketRow b={b} /></Fragment>)}
          </Card>
        ) : null}
        {q.hasNextPage && <Button variant="secondary" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()}>Load more</Button>}
      </Section>
    </Screen>
  );
}

/** One line naming what is filtered, e.g. "“stable” · Stablecoin · Max 100 USDC". */
function summary(f: DiscoveryFilters) {
  return [
    f.q ? `“${f.q}”` : null,
    ...(f.categories ?? []).map((c) => BASKET_CATEGORY_LABEL[c]),
    f.maxMinimumInvestmentUsdc ? `Max ${f.maxMinimumInvestmentUsdc} USDC` : null,
    f.sort && f.sort !== "relevance" ? "Sorted" : null,
  ].filter(Boolean).join(" · ");
}

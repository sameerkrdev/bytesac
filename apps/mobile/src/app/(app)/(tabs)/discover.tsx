import type { DiscoveryFilters } from "@repo/validator";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshControl } from "react-native";
import { palette } from "@repo/design-tokens";
import { AiSearch } from "@/components/discover/ai-search";
import { Filters } from "@/components/discover/filters";
import { ResultCard } from "@/components/discover/result-card";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";

export default function DiscoverScreen() {
  const [filters, setFilters] = useState<DiscoveryFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  // Remounting the filter form when the AI hands over filters keeps its fields in step.
  const [formKey, setFormKey] = useState(0);
  const q = useInfiniteQuery({
    queryKey: ["discover", filters],
    queryFn: ({ pageParam }) => api.discoverBaskets({ ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const apply = (f: DiscoveryFilters) => { setFilters(f); setFormKey((k) => k + 1); setShowFilters(false); };

  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void q.refetch()} tintColor={palette.mint} />}>
      <AppText variant="display" accessibilityRole="header">Discover</AppText>
      <AiSearch onUseFilters={apply} />
      <Button variant="secondary" onPress={() => setShowFilters(!showFilters)}>{showFilters ? "Hide filters" : "Filters"}</Button>
      {showFilters && <Filters key={formKey} filters={filters} onApply={apply} />}
      {q.isPending && <LoadingState />}
      {q.isError && !q.data && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && q.data && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      {q.data && items.length === 0 && <EmptyState title="No baskets match. Try removing a filter." />}
      {items.map((b) => <ResultCard key={b.slug} item={b} />)}
      {q.hasNextPage && <Button variant="secondary" loading={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()}>Load more</Button>}
    </Screen>
  );
}

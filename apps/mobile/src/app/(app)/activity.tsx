import type { OperationView } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { OPERATION_KIND, OperationCard } from "@/components/portfolio/operation-card";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/states";
import { Chip } from "@/components/ui/chip";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type Kind = OperationView["kind"] | "all";

/** Every operation you started, newest first, filterable by kind; each opens its steps and explorer links. */
export default function ActivityScreen() {
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const [kind, setKind] = useState<Kind>("all");
  const all = q.data ? [...q.data.openOperations, ...q.data.history] : [];
  const kinds = [...new Set(all.map((o) => o.kind))];
  const shown = all.filter((o) => kind === "all" || o.kind === kind);
  return (
    <Screen edges={["left", "right"]} title="Activity" description="Investments, rebalances, repairs and sales, with each step you signed."
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.ink} />}>
      {q.isPending ? <LoadingState /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {kinds.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
              <Chip label="All" selected={kind === "all"} onPress={() => setKind("all")} />
              {kinds.map((k) => <Chip key={k} label={OPERATION_KIND[k]} selected={kind === k} onPress={() => setKind(k)} />)}
            </ScrollView>
          )}
          {shown.length === 0 ? <EmptyState title="Nothing here yet." /> : shown.map((o) => <OperationCard key={o.id} operation={o} open={o.status === "PLANNED" || o.status === "IN_PROGRESS"} />)}
        </>
      )}
    </Screen>
  );
}

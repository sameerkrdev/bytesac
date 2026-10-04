import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { RefreshControl } from "react-native";
import { palette } from "@repo/design-tokens";
import { OperationCard } from "@/components/portfolio/operation-card";
import { PositionCard } from "@/components/portfolio/position-card";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";

export default function PortfolioScreen() {
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const p = q.data;
  return (
    <Screen refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={palette.mint} />}>
      <AppText variant="display" accessibilityRole="header">Portfolio</AppText>
      {q.isPending && <LoadingState />}
      {q.isError && !p && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && p && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      {p && (
        <>
          {p.openOperations.length > 0 && (
            <>
              <AppText variant="title" accessibilityRole="header">Open operations</AppText>
              {p.openOperations.map((o) => <OperationCard key={o.id} operation={o} open />)}
            </>
          )}
          <AppText variant="title" accessibilityRole="header">Positions</AppText>
          {p.positions.length === 0
            ? <EmptyState title="You have no open positions. Find a basket to invest in."><Button variant="secondary" onPress={() => router.push("/(app)/(tabs)/discover")}>Discover baskets</Button></EmptyState>
            : p.positions.map((x) => (
              <PositionCard key={x.id} position={x}
                repairAsset={p.repairs.find((r) => r.positions.some((y) => y.positionId === x.id))?.asset}
                openOperationId={(p.openOperations.find((o) => o.positionId === x.id) ?? p.openOperations[0])?.id} />
            ))}
          {p.formerPositions.length > 0 && (
            <>
              <AppText variant="title" accessibilityRole="header">Former positions</AppText>
              {p.formerPositions.map((x) => <PositionCard key={x.id} position={x} former />)}
            </>
          )}
          {p.history.length > 0 && (
            <>
              <AppText variant="title" accessibilityRole="header">History</AppText>
              {p.history.map((o) => <OperationCard key={o.id} operation={o} />)}
            </>
          )}
        </>
      )}
    </Screen>
  );
}

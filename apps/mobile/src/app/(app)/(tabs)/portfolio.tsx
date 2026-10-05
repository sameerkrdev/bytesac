import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, RefreshControl } from "react-native";
import { OperationCard } from "@/components/portfolio/operation-card";
import { PortfolioSummary, PositionRows } from "@/components/portfolio/summary";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Screen, Section } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

/** Portfolio → baskets → assets: value and allocation, anything running, each basket, then recent activity. */
export default function PortfolioScreen() {
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const p = q.data;
  return (
    <Screen tabBarInset title="Portfolio" eyebrow="Your wallets, tracked against each strategy"
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.ink} />}>
      {q.isPending && <LoadingState />}
      {q.isError && !p && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && p && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      {p && (
        <>
          {p.positions.length > 0 && <PortfolioSummary p={p} />}
          {p.openOperations.length > 0 && (
            <Section title="Running now" eyebrow="Open operations">
              {p.openOperations.map((o) => <OperationCard key={o.id} operation={o} open />)}
            </Section>
          )}
          <Section title="Baskets">
            {p.positions.length === 0
              ? <EmptyState title="You have no open positions. Find a basket to invest in."><Button variant="secondary" onPress={() => router.push("/(app)/(tabs)/discover")}>Discover baskets</Button></EmptyState>
              : <PositionRows positions={p.positions} />}
          </Section>
          {p.formerPositions.length > 0 && (
            <Section title="Former baskets" eyebrow="Assets stay in your wallets">
              <PositionRows positions={p.formerPositions} former />
            </Section>
          )}
          {p.history.length > 0 && (
            <Section title="Recent activity" action={<Pressable accessibilityRole="link" onPress={() => router.push("/activity")} className="min-h-11 justify-center"><AppText variant="label" tone="muted">All activity</AppText></Pressable>}>
              {p.history.slice(0, 3).map((o) => <OperationCard key={o.id} operation={o} />)}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

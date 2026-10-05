import { positionValue, usd } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, RefreshControl, View } from "react-native";
import { PositionDetail } from "@/components/portfolio/position-detail";
import { Figure } from "@/components/portfolio/summary";
import { EmptyState, ErrorState, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

/** One basket you hold (or held): value, its state with actions, weights against target, holdings and exits. */
export default function PositionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const p = q.data;
  const position = p?.positions.find((x) => x.id === id);
  const former = p?.formerPositions.find((x) => x.id === id);
  const x = position ?? former;
  const v = x ? positionValue(x) : null;
  return (
    <Screen edges={["left", "right"]} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.ink} />}>
      {q.isPending ? <LoadingState /> : q.isError && !p ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : !x ? (
        <EmptyState title="This position isn't in your portfolio any more." />
      ) : (
        <>
          <View className="gap-2">
            <AppText variant="eyebrow" tone="faint">{former ? "Former position" : `Applied version ${x.appliedVersionNumber}`}</AppText>
            <AppText variant="display" accessibilityRole="header">{x.basketName}</AppText>
            {v === null ? <AppText tone="muted">Value unavailable</AppText> : <Figure value={usd(v)} />}
            <Pressable accessibilityRole="link" onPress={() => router.push(`/basket/${x.basketSlug}`)} className="min-h-11 justify-center self-start">
              <AppText variant="label" tone="accent">Basket research</AppText>
            </Pressable>
          </View>
          <PositionDetail position={x} former={Boolean(former)}
            repairAsset={p!.repairs.find((r) => r.positions.some((y) => y.positionId === x.id))?.asset}
            openOperationId={(p!.openOperations.find((o) => o.positionId === x.id) ?? p!.openOperations[0])?.id} />
        </>
      )}
    </Screen>
  );
}

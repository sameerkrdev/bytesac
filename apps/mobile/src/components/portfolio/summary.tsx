import { HEADLINE_LABEL, portfolioAllocation, positionValue, usd } from "@repo/app-core";
import type { Portfolio } from "@repo/validator";
import { router } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AllocationLegend, AllocationRing } from "@/components/ui/allocation-ring";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTheme } from "@/lib/theme";

/** A money value with muted cents, like the web's figures. */
export function Figure({ value }: { value: string }) {
  const [whole, cents] = value.split(".");
  return <AppText variant="figure">{whole}<AppText variant="figure" tone="faint">{cents ? `.${cents}` : ""}</AppText></AppText>;
}

/** Value, counts and allocation by asset across open positions. No performance chart: none exists yet. */
export function PortfolioSummary({ p }: { p: Portfolio }) {
  const { total, legend, slices, attention } = portfolioAllocation(p, 4);
  return (
    <Card className="gap-5 p-6" style={{ shadowColor: "#0F1E3A", shadowOpacity: 0.08, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 4 }}>
      <View className="gap-1">
        <AppText variant="eyebrow" tone="faint">Portfolio value</AppText>
        {total === null ? <AppText variant="title" tone="muted">Value unavailable</AppText> : <Figure value={usd(total)} />}
      </View>
      <View className="flex-row gap-6">
        <View><AppText variant="micro" tone="faint">Baskets</AppText><AppText className="font-medium">{p.positions.length}</AppText></View>
        <View><AppText variant="micro" tone="faint">Need you</AppText><AppText className="font-medium" tone={attention ? "warning" : "ink"}>{attention}</AppText></View>
        <View><AppText variant="micro" tone="faint">Open operations</AppText><AppText className="font-medium">{p.openOperations.length}</AppText></View>
      </View>
      {slices.length > 0 && (
        <View className="flex-row items-center gap-5 border-t border-line pt-5">
          <AllocationRing slices={legend} size={112} thickness={11} label={`Portfolio by asset: ${legend.map((s) => `${s.label} ${(s.bps / 100).toFixed(0)}%`).join(", ")}`}>
            <AppText className="font-light text-2xl">{slices.length}</AppText>
            <AppText variant="micro" tone="muted">assets</AppText>
          </AllocationRing>
          <View className="flex-1"><AllocationLegend slices={legend} /></View>
        </View>
      )}
      <AppText variant="micro" tone="faint">Values use current market prices for holdings reconciled in your wallets. Performance history isn’t available yet.</AppText>
    </Card>
  );
}

/** Positions as compact rows (name, state, value) that open the position screen. */
export function PositionRows({ positions, former = false }: { positions: Portfolio["positions"]; former?: boolean }) {
  const { colors } = useTheme();
  return (
    <View className="overflow-hidden rounded-card border border-line bg-surface">
      {positions.map((x, i) => {
        const v = positionValue(x);
        return (
          <Pressable key={x.id} accessibilityRole="link" accessibilityLabel={`${x.basketName}${former ? ", former" : `, ${HEADLINE_LABEL[x.headline].label}`}`}
            onPress={() => router.push(`/position/${x.id}`)} className={`flex-row items-center gap-3 px-5 py-4 active:bg-surface-muted ${i > 0 ? "border-t border-line" : ""}`}>
            <View className="flex-1 gap-1">
              <AppText className="font-medium" numberOfLines={1}>{x.basketName}</AppText>
              {former
                ? <AppText variant="micro" tone="faint">Left {new Date(x.closedAt ?? x.openedAt).toLocaleDateString()}</AppText>
                : <StatusBadge tone={HEADLINE_LABEL[x.headline].tone} label={HEADLINE_LABEL[x.headline].label} />}
            </View>
            <AppText className="font-mono">{v === null ? "—" : usd(v)}</AppText>
            <ChevronRight size={16} color={colors.inkFaint} />
          </Pressable>
        );
      })}
    </View>
  );
}

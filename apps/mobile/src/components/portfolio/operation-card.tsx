import { formatUnits, OPERATION_STATUS_LABEL } from "@repo/app-core";
import type { OperationView } from "@repo/validator";
import { router } from "expo-router";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";

export const OPERATION_KIND = { invest: "Investment", sell_to_usdc: "Sale to USDC", sell_former: "Sale of former assets", rebalance: "Rebalance", repair: "Buy back" } as const;

/** One operation in the open list or the history; opens the operation detail (legs, explorer links, Continue, Stop here). */
export function OperationCard({ operation: o, open = false }: { operation: OperationView; open?: boolean }) {
  const s = OPERATION_STATUS_LABEL[o.status];
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${OPERATION_KIND[o.kind]}, ${s.label}`} onPress={() => router.push(`/operation/${o.id}`)}>
      <Card className="gap-2 p-4">
        <View className="flex-row items-center justify-between gap-2">
          <AppText className="flex-1 font-semibold">{OPERATION_KIND[o.kind]}</AppText>
          <StatusBadge tone={s.tone} label={s.label} />
        </View>
        <AppText variant="label" tone="faint">{new Date(o.createdAt).toLocaleString()}{o.amountUsdc ? ` · ${formatUnits(o.amountUsdc, 6)} USDC` : ""}{o.sellPercent ? ` · ${o.sellPercent}%` : ""} · {o.legs.length} steps</AppText>
        {open ? <AppText variant="label" tone="accent">Continue</AppText> : null}
      </Card>
    </Pressable>
  );
}

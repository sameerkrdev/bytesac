import { feeLines } from "@repo/app-core";
import type { OperationFeeView } from "@repo/validator";
import { View } from "react-native";
import { AppText } from "@/components/ui/app-text";

/** Every fee of an operation (the fee leg moves their total), a waived one with its reason. Server values only. */
export function FeeLines({ fees }: { fees: OperationFeeView[] }) {
  const { lines, total } = feeLines(fees);
  return (
    <View accessibilityLabel="Fees" className="gap-3 rounded-card border border-line bg-surface p-5">
      <AppText variant="eyebrow" tone="faint">Fees</AppText>
      {lines.map((l, n) => (
        <View key={n} className="flex-row justify-between gap-3">
          <AppText tone="muted" className="flex-1">{l.label}</AppText>
          <AppText tone={l.waived ? "faint" : "ink"} className="max-w-[60%] text-right">{l.amount}</AppText>
        </View>
      ))}
      <View className="flex-row justify-between gap-3 border-t border-line pt-3">
        <AppText className="font-medium">Total fees</AppText>
        <AppText className="font-medium">{total}</AppText>
      </View>
      <AppText variant="micro" tone="faint">Fees are not refunded if the operation does not complete.</AppText>
    </View>
  );
}

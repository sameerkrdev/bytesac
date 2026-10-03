import { feeLines } from "@repo/app-core";
import type { OperationFeeView } from "@repo/validator";
import { View } from "react-native";
import { AppText } from "@/components/ui/app-text";

/** Every fee of an operation (the fee leg moves their total), a waived one with its reason. Server values only. */
export function FeeLines({ fees }: { fees: OperationFeeView[] }) {
  const { lines, total } = feeLines(fees);
  return (
    <View accessibilityLabel="Fees" className="gap-1">
      {lines.map((l, n) => (
        <View key={n} className="flex-row justify-between gap-3">
          <AppText className="flex-1">{l.label}</AppText>
          <AppText tone={l.waived ? "stone" : "ivory"} className="shrink">{l.amount}</AppText>
        </View>
      ))}
      <View className="flex-row justify-between gap-3 border-t border-border-dark pt-1">
        <AppText className="font-sans-semibold">Total fees</AppText>
        <AppText className="font-sans-semibold">{total}</AppText>
      </View>
      <AppText variant="label" tone="stone">Fees are not refunded if the operation does not complete.</AppText>
    </View>
  );
}

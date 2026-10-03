import { Pressable } from "react-native";
import { AppText } from "./app-text";

/** A toggle chip (filters, sort, ranges): 44 pt target, selected state exposed to screen readers and shown with a border. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress}
      className={`min-h-11 justify-center rounded-xl border px-3 ${selected ? "border-mint bg-slate" : "border-border-dark"}`}>
      <AppText variant="label" tone={selected ? "mint" : "ivory"}>{label}</AppText>
    </Pressable>
  );
}

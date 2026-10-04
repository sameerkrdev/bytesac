import * as Haptics from "expo-haptics";
import { Pressable } from "react-native";
import { AppText } from "./app-text";

/** A toggle chip (filters, sort, ranges, categories): 44 pt target; the selected state is announced and filled. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
      onPress={() => { void Haptics.selectionAsync().catch(() => undefined); onPress(); }}
      className={`min-h-11 justify-center rounded-pill border px-4 ${selected ? "border-primary bg-primary" : "border-line bg-surface"}`}>
      <AppText variant="label" tone={selected ? "primaryInk" : "muted"}>{label}</AppText>
    </Pressable>
  );
}

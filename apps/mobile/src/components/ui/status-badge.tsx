import { View } from "react-native";
import { AppText } from "./app-text";

const TONES = {
  success: { box: "bg-success-soft", dot: "bg-success", text: "success" as const },
  warning: { box: "bg-warning-soft", dot: "bg-warning", text: "warning" as const },
  danger: { box: "bg-danger-soft", dot: "bg-danger", text: "danger" as const },
  info: { box: "bg-info-soft", dot: "bg-info", text: "accent" as const },
  neutral: { box: "bg-surface-muted", dot: "bg-ink-faint", text: "muted" as const },
};

/** A soft status pill with a dot, like the web's. The label carries the meaning; colour only reinforces it. */
export function StatusBadge({ tone, label }: { tone: keyof typeof TONES; label: string }) {
  const t = TONES[tone];
  return (
    <View accessible accessibilityLabel={label} className={`flex-row items-center gap-1.5 self-start rounded-pill px-2.5 py-1 ${t.box}`}>
      <View className={`size-1.5 rounded-full ${t.dot}`} />
      <AppText variant="label" tone={t.text}>{label}</AppText>
    </View>
  );
}

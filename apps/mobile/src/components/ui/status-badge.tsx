import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react-native";
import { View } from "react-native";
import { palette, semantic } from "@repo/design-tokens";
import { AppText } from "./app-text";
const TONES = {
  success: { Icon: CheckCircle2, color: semantic.success },
  warning: { Icon: AlertTriangle, color: semantic.warning },
  danger: { Icon: XCircle, color: semantic.danger },
  neutral: { Icon: CircleDashed, color: palette.stone },
} as const;
export function StatusBadge({ tone, label }: { tone: keyof typeof TONES; label: string }) {
  const { Icon, color } = TONES[tone];
  return (
    <View className="flex-row items-center gap-1 self-start rounded-lg border border-border-dark px-2 py-0.5">
      <Icon size={14} color={color} accessibilityElementsHidden importantForAccessibility="no" />
      <AppText variant="label" style={{ color }}>{label}</AppText>
    </View>
  );
}

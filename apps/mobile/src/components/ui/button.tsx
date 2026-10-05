import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useTheme } from "@/lib/theme";
import { AppText, type TextTone } from "./app-text";

const STYLES: Record<string, { box: string; text: TextTone }> = {
  primary: { box: "bg-primary", text: "primaryInk" },
  secondary: { box: "bg-surface border border-line-strong", text: "ink" },
  glass: { box: "bg-glass border border-glass-line", text: "ink" },
  ghost: { box: "bg-transparent", text: "ink" },
  destructive: { box: "bg-danger", text: "primaryInk" },
};

/**
 * A pill button (44 pt minimum). Primary actions give a light haptic tap. `children` is the accessible name unless
 * `accessibilityLabel` is given.
 */
export function Button({ children, onPress, variant = "primary", size = "md", loading = false, disabled = false, icon, iconAfter, accessibilityLabel, className = "" }: {
  children: string; onPress(): void; variant?: keyof typeof STYLES; size?: "sm" | "md" | "lg"; loading?: boolean; disabled?: boolean; icon?: ReactNode; iconAfter?: ReactNode; accessibilityLabel?: string; className?: string;
}) {
  const { colors } = useTheme();
  const s = STYLES[variant]!;
  const off = disabled || loading;
  const h = size === "lg" ? "min-h-14 px-6" : size === "sm" ? "min-h-11 px-4" : "min-h-12 px-5";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? children} accessibilityState={{ disabled: off, busy: loading }}
      disabled={off}
      onPress={() => { if (variant === "primary" || variant === "destructive") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); onPress(); }}
      className={`flex-row items-center justify-center gap-2 rounded-pill ${h} ${s.box} ${off ? "opacity-50" : "active:opacity-80"} ${className}`}>
      {loading ? <ActivityIndicator color={s.text === "primaryInk" ? colors.primaryInk : colors.ink} /> : icon ? <View>{icon}</View> : null}
      <AppText variant="buttonLabel" tone={s.text}>{children}</AppText>
      {iconAfter && !loading ? <View>{iconAfter}</View> : null}
    </Pressable>
  );
}

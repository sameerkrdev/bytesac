import { ActivityIndicator, Pressable, View } from "react-native";
import type { ReactNode } from "react";
import { palette } from "@repo/design-tokens";
import { AppText } from "./app-text";

const STYLES = {
  primary: { box: "bg-sage", text: "space" as const },
  secondary: { box: "bg-slate border border-border-dark", text: "ivory" as const },
  ghost: { box: "bg-transparent", text: "ivory" as const },
  destructive: { box: "bg-danger", text: "space" as const },
};

export function Button({ children, onPress, variant = "primary", loading = false, disabled = false, icon, accessibilityLabel, className = "" }: {
  children: string; onPress(): void; variant?: keyof typeof STYLES; loading?: boolean; disabled?: boolean; icon?: ReactNode; accessibilityLabel?: string; className?: string;
}) {
  const s = STYLES[variant];
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? children} accessibilityState={{ disabled: off, busy: loading }}
      disabled={off} onPress={onPress}
      className={`min-h-11 flex-row items-center justify-center gap-2 rounded-xl px-4 ${s.box} ${off ? "opacity-60" : ""} ${className}`}>
      {loading ? <ActivityIndicator color={s.text === "space" ? palette.space : palette.ivory} /> : icon ? <View>{icon}</View> : null}
      <AppText variant="body" tone={s.text} className="font-sans-semibold">{children}</AppText>
    </Pressable>
  );
}

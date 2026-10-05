import { useId, useState } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { useTheme } from "@/lib/theme";
import { AppText } from "./app-text";

/** A labelled input with its error or hint below; the border follows focus and errors. `size="lg"` is the big figure field (amounts). */
export function TextField({ label, error, helper, size = "md", ...rest }: TextInputProps & { label: string; error?: string | null; helper?: string; size?: "md" | "lg" }) {
  const id = useId();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View className="gap-2">
      <AppText variant="label" nativeID={id}>{label}</AppText>
      <TextInput {...rest} accessibilityLabel={label} aria-labelledby={id} aria-invalid={Boolean(error)}
        accessibilityHint={error ?? helper}
        placeholderTextColor={colors.inkFaint}
        selectionColor={colors.accent}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        className={`${size === "lg" ? "min-h-20 rounded-tile px-5 font-light text-4xl" : "min-h-12 rounded-control px-4 font-sans text-base"} border bg-surface text-ink ${error ? "border-danger" : focused ? "border-accent" : "border-line-strong"}`} />
      {error ? <AppText variant="label" tone="danger" accessibilityRole="alert">{error}</AppText>
        : helper ? <AppText variant="micro" tone="faint">{helper}</AppText> : null}
    </View>
  );
}

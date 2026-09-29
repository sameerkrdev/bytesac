import { useId } from "react";
import { TextInput, View, type TextInputProps } from "react-native";
import { palette } from "@repo/design-tokens";
import { AppText } from "./app-text";
export function TextField({ label, error, helper, ...rest }: TextInputProps & { label: string; error?: string | null; helper?: string }) {
  const id = useId();
  return (
    <View className="gap-2">
      <AppText variant="label" nativeID={id}>{label}</AppText>
      <TextInput {...rest} accessibilityLabel={label} aria-labelledby={id} aria-invalid={Boolean(error)}
        accessibilityHint={error ?? helper}
        placeholderTextColor={palette.stone}
        className={`min-h-11 rounded-xl border bg-space px-3 font-sans text-base text-ivory ${error ? "border-danger" : "border-border-dark"}`} />
      {error ? <AppText variant="label" tone="danger" accessibilityRole="alert">{error}</AppText>
        : helper ? <AppText variant="label" tone="stone">{helper}</AppText> : null}
    </View>
  );
}

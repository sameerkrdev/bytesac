import { ActivityIndicator, View } from "react-native";
import { Logo } from "@/components/brand/logo";
import { AppText } from "@/components/ui/app-text";
import { Sky } from "@/components/ui/sky";
import { useTheme } from "@/lib/theme";

/** Shown while the stored session is read: the native splash colours continue into the sky, with the mark and a quiet spinner. */
export function BrandedSplash() {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading Bytesac" className="flex-1 items-center justify-center gap-5 bg-canvas">
      <Sky height={900} />
      <Logo size={72} />
      <AppText variant="eyebrow" tone="muted">Bytesac</AppText>
      <ActivityIndicator color={colors.inkMuted} />
    </View>
  );
}

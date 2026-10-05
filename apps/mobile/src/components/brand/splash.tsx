import { ActivityIndicator, View } from "react-native";
import { FullLogo } from "@/components/brand/logo";
import { Sky } from "@/components/ui/sky";
import { useTheme } from "@/lib/theme";

/** Shown while the stored session is read: the native splash colours continue into the sky, with the mark and a quiet spinner. */
export function BrandedSplash() {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading Bytesac" className="flex-1 items-center justify-center gap-5 bg-canvas">
      <Sky height={900} />
      <FullLogo size={44} />
      <ActivityIndicator color={colors.inkMuted} />
    </View>
  );
}

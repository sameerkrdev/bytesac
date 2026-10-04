import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme";

/**
 * Frosted glass for bars and floating chips. iOS and web blur what is behind; Android blur needs every blurred screen
 * wrapped in a target view, so it gets a near-opaque glass surface instead (same look at rest, no blur).
 */
export function Glass({ children, className = "", style, intensity = 60 }: { children?: ReactNode; className?: string; style?: StyleProp<ViewStyle>; intensity?: number }) {
  const { scheme, colors } = useTheme();
  if (Platform.OS === "android") {
    return <View className={`border border-glass-line ${className}`} style={[{ backgroundColor: scheme === "dark" ? "rgba(14, 23, 38, 0.94)" : "rgba(255, 255, 255, 0.94)" }, style]}>{children}</View>;
  }
  return (
    <BlurView intensity={intensity} tint={scheme === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      className={`overflow-hidden border border-glass-line ${className}`} style={[{ backgroundColor: colors.glass }, style]}>
      {children}
    </BlurView>
  );
}

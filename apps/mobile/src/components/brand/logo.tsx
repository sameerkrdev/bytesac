import { brandAspect, brandMark, brandWordmark } from "@repo/design-tokens";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useTheme } from "@/lib/theme";

/** The Bytesac mark (two stacked slabs): top slab in the accent, bottom in ink (`color` makes it one colour); `size` is its height. Same artwork as the web (@repo/design-tokens brand). */
export function Logo({ size = 40, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <Svg height={size} width={size * brandAspect.mark} viewBox={brandMark.viewBox} fill={color ?? colors.ink} accessible accessibilityRole="image" accessibilityLabel="Bytesac">
      <Path d={brandMark.paths[0]} fill={color ?? colors.accent} />
      <Path d={brandMark.paths[1]} />
    </Svg>
  );
}

/** Mark + the outlined "Bytesac" wordmark (Geist Medium), as in the brand files. */
export function FullLogo({ size = 28, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  const h = size * 0.78;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Bytesac" className="flex-row items-center" style={{ gap: size * 0.3 }}>
      <Svg height={size} width={size * brandAspect.mark} viewBox={brandMark.viewBox} fill={color ?? colors.ink}>
        <Path d={brandMark.paths[0]} fill={color ?? colors.accent} />
        <Path d={brandMark.paths[1]} />
      </Svg>
      {/* The box includes the y descender: drop it so the capitals centre on the mark. */}
      <Svg height={h} width={h * brandAspect.wordmark} viewBox={brandWordmark.viewBox} fill={color ?? colors.ink} style={{ transform: [{ translateY: h * 0.086 }] }}>
        <Path d={brandWordmark.path} />
      </Svg>
    </View>
  );
}

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTheme } from "@/lib/theme";

/* eslint-disable @typescript-eslint/no-require-imports -- bundled art */
const BANK = require("../../../assets/visuals/clouds-bank-1600.webp");
const WISPS = require("../../../assets/visuals/clouds-wisps-1600.webp");
/* eslint-enable @typescript-eslint/no-require-imports */

/** One cloud strip drifting sideways forever: the image twice (second mirrored) slid by one width, so there is no seam. */
function Strip({ source, width, height, seconds, opacity, top, bottom, reverse = false }: {
  source: number; width: number; height: number; seconds: number; opacity: number; top?: number; bottom?: number; reverse?: boolean;
}) {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    x.value = withRepeat(withTiming(1, { duration: seconds * 1000, easing: Easing.linear }), -1, false);
  }, [reduce, seconds, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: (reverse ? x.value - 1 : -x.value) * width * 2 }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top, bottom, height, width: width * 4, flexDirection: "row", opacity }, style]}>
      {[0, 1, 2, 3].map((i) => (
        <Image key={i} source={source} contentFit="cover" style={{ width, height, transform: i % 2 ? [{ scaleX: -1 }] : undefined }} />
      ))}
    </Animated.View>
  );
}

/**
 * The sky behind bookends (splash, welcome, home header, sign-in): a vertical gradient with transparent cumulus
 * banks drifting very slowly at two speeds, like the web hero. Night in the dark theme. Decorative; still under
 * reduced motion.
 */
export function Sky({ height = 420, fade = true }: { height?: number; fade?: boolean }) {
  const { colors, scheme } = useTheme();
  const cloud = scheme === "dark" ? 0.45 : 1;
  const w = height * 3;
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { height, overflow: "hidden" }]}>
      <LinearGradient colors={[colors.skyTop, colors.skyMid, colors.skyLow, colors.canvas]} locations={[0, 0.45, 0.78, 1]} style={StyleSheet.absoluteFill} />
      <Strip source={WISPS} width={w * 0.9} height={height * 0.3} top={height * 0.08} seconds={300} opacity={0.7 * cloud} />
      <Strip source={BANK} width={w} height={height * 0.42} bottom={height * 0.06} seconds={220} opacity={0.8 * cloud} reverse />
      <Strip source={BANK} width={w * 1.1} height={height * 0.36} bottom={-height * 0.04} seconds={150} opacity={cloud} />
      {fade && <LinearGradient colors={["transparent", colors.canvas]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.3 }} />}
    </View>
  );
}

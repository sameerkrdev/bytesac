import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useTheme } from "@/lib/theme";

 
const BANK = require("../../../assets/visuals/clouds-bank-1600.webp");
const WISPS = require("../../../assets/visuals/clouds-wisps-1600.webp");
 

/** Cloud art is 1600×533; tiles keep that ratio so "cover" never crops a cloud into a hard edge. */
const ART_RATIO = 1600 / 533;

/** One cloud strip drifting sideways forever: mirrored tiles slid by two widths, so there is no seam. */
function Strip({ source, height, seconds, opacity, top, bottom, reverse = false }: {
  source: number; height: number; seconds: number; opacity: number; top?: number; bottom?: number; reverse?: boolean;
}) {
  const reduce = useReducedMotion();
  const width = height * ART_RATIO;
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    x.value = withRepeat(withTiming(1, { duration: seconds * 1000, easing: Easing.linear }), -1, false);
  }, [reduce, seconds, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: (reverse ? x.value - 1 : -x.value) * width * 2 }] }));
  return (
    <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top, bottom, height, width: width * 6, flexDirection: "row", opacity }, style]}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
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
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, { height, overflow: "hidden" }]}>
      <LinearGradient colors={[colors.skyTop, colors.skyMid, colors.skyLow, colors.canvas]} locations={[0, 0.45, 0.78, 1]} style={StyleSheet.absoluteFill} />
      <Strip source={WISPS} height={height * 0.3} top={height * 0.08} seconds={300} opacity={0.7 * cloud} />
      <Strip source={BANK} height={height * 0.42} bottom={height * 0.06} seconds={220} opacity={0.8 * cloud} reverse />
      <Strip source={BANK} height={height * 0.36} bottom={height * 0.02} seconds={150} opacity={cloud} />
      {/* Fade to the canvas colour at zero alpha ("transparent" is black at zero alpha and greys the band on web). */}
      {fade && <LinearGradient colors={[`${colors.canvas}00`, colors.canvas]} style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * 0.45 }} />}
    </View>
  );
}

import { useId } from "react";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/*
 * The Bytesac mark: two stacked glass slabs over a half-round bowl. Same paths as the web mark
 * (apps/web/components/brand/logo.tsx), filled with the brand sheet's glass gradients; the app icons in
 * assets/images are rendered from it. Replace both with the official vector when it is available.
 */
const BOWL = "M11.5 10.2a6.4 6.4 0 0 0 0 12.8z";
const TOP = "M13.4 2.5h7.9a3 3 0 0 1 3 3v6.1a1.9 1.9 0 0 1-2.7 1.7l-8.6-4A2.4 2.4 0 0 1 11.6 7V4.3a1.8 1.8 0 0 1 1.8-1.8z";
const BOTTOM = "M11.6 13.6a1.4 1.4 0 0 1 2-1.3l9.2 4.3a2.6 2.6 0 0 1 1.5 2.4v8.5a2 2 0 0 1-2 2h-8.3a2.4 2.4 0 0 1-2.4-2.4z";

export function Logo({ size = 40 }: { size?: number }) {
  // Gradient ids must be unique per instance (several marks can be on screen).
  const id = useId().replace(/:/g, "");
  return (
    <Svg width={size} height={size} viewBox="3 1 23 30" accessible accessibilityRole="image" accessibilityLabel="Bytesac">
      <Defs>
        <LinearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#F3DDBA" /><Stop offset="1" stopColor="#8FB3A6" /></LinearGradient>
        <LinearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#21403F" /><Stop offset="0.55" stopColor="#6F958C" /><Stop offset="1" stopColor="#E9DCC0" /></LinearGradient>
        <LinearGradient id={`${id}m`} x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor="#BFD6CB" /><Stop offset="0.6" stopColor="#E7E3CF" /><Stop offset="1" stopColor="#F4E1BE" /></LinearGradient>
      </Defs>
      <Path d={BOWL} fill={`url(#${id}b)`} />
      <Path d={TOP} fill={`url(#${id}t)`} />
      <Path d={BOTTOM} fill={`url(#${id}m)`} fillOpacity={0.92} />
    </Svg>
  );
}

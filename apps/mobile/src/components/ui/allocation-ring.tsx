import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "@/lib/theme";
import { AppText } from "./app-text";

export type Slice = { key: string; label: string; bps: number };
const DATA = ["data1", "data2", "data3", "data4", "data5", "data6"] as const;

/** Colour of slice `i` from the categorical data palette (theme-aware). */
export function useSliceColor() {
  const { colors } = useTheme();
  return (i: number) => colors[DATA[i % DATA.length]!];
}

/** A target/holdings allocation ring with a centre slot; the label names it for screen readers. */
export function AllocationRing({ slices, size = 160, thickness = 14, gapDeg = 2.4, label, children }: { slices: Slice[]; size?: number; thickness?: number; gapDeg?: number; label: string; children?: ReactNode }) {
  const { colors } = useTheme();
  const color = useSliceColor();
  const total = slices.reduce((s, x) => s + x.bps, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const p = (a: number) => [c + r * Math.cos((a * Math.PI) / 180), c + r * Math.sin((a * Math.PI) / 180)] as const;
  // Each slice starts where the previous ones end (from 12 o'clock); computed without mutating during render.
  const starts = slices.map((_, i) => -90 + (slices.slice(0, i).reduce((s, x) => s + x.bps, 0) / total) * 360);
  const arcs = slices.map((s, i) => {
    const sweep = (s.bps / total) * 360;
    const start = starts[i]!;
    const a0 = start + gapDeg / 2;
    const a1 = start + Math.max(sweep - gapDeg / 2, gapDeg / 2 + 0.01);
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    return { key: s.key, d: `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`, stroke: color(i) };
  });
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={c} cy={c} r={r} stroke={colors.line} strokeWidth={thickness} fill="none" opacity={0.6} />
        {arcs.map((a) => <Path key={a.key} d={a.d} stroke={a.stroke} strokeWidth={thickness} fill="none" />)}
      </Svg>
      {children}
    </View>
  );
}

/** The legend for a ring: dot, label, weight. */
export function AllocationLegend({ slices }: { slices: Slice[] }) {
  const color = useSliceColor();
  return (
    <View className="gap-2.5">
      {slices.map((s, i) => (
        <View key={s.key} className="flex-row items-center gap-2.5">
          <View className="size-2 rounded-full" style={{ backgroundColor: color(i) }} />
          <AppText className="flex-1" tone="muted">{s.label}</AppText>
          <AppText className="font-mono">{`${(s.bps / 100).toFixed(1)}%`}</AppText>
        </View>
      ))}
    </View>
  );
}

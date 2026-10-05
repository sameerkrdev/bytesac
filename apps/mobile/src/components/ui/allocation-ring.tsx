import type { ReactNode } from "react";
import { Platform, Pressable, View } from "react-native";
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

const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

/**
 * (On web, react-native-svg forwards onPress to the DOM as an unknown prop, so slices there are selected from the legend.)
 * A target/holdings allocation ring with a centre slot; the label names it for screen readers. With `onSelect`, a
 * tapped slice is highlighted (the others dim) and the centre shows its label and share; tapping it again clears it.
 */
export function AllocationRing({ slices, size = 160, thickness = 14, gapDeg = 2.4, label, children, selected = null, onSelect }: {
  slices: Slice[]; size?: number; thickness?: number; gapDeg?: number; label: string; children?: ReactNode; selected?: string | null; onSelect?(key: string | null): void;
}) {
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
  const pick = selected ? slices.find((x) => x.key === selected) : undefined;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Circle cx={c} cy={c} r={r} stroke={colors.line} strokeWidth={thickness} fill="none" opacity={0.6} />
        {arcs.map((a) => (
          <Path key={a.key} d={a.d} stroke={a.stroke} fill="none" strokeWidth={selected === a.key ? thickness + 4 : thickness}
            opacity={selected && selected !== a.key ? 0.28 : 1} {...(onSelect && Platform.OS !== "web" ? { onPress: () => onSelect(selected === a.key ? null : a.key) } : {})} />
        ))}
      </Svg>
      {pick ? (
        <View pointerEvents="none" className="items-center">
          <AppText variant="label" className="font-medium" numberOfLines={1}>{pick.label}</AppText>
          <AppText variant="micro" tone="muted">{pct(pick.bps)}</AppText>
        </View>
      ) : children}
    </View>
  );
}

/** The legend for a ring: dot, label, weight. With `onSelect` each row is a button that selects its slice. */
export function AllocationLegend({ slices, selected = null, onSelect }: { slices: Slice[]; selected?: string | null; onSelect?(key: string | null): void }) {
  const color = useSliceColor();
  return (
    <View className="gap-1">
      {slices.map((s, i) => {
        const row = (
          <>
            <View className="size-2 rounded-full" style={{ backgroundColor: color(i) }} />
            <AppText className="flex-1" tone={selected === s.key ? "ink" : "muted"}>{s.label}</AppText>
            <AppText className="font-mono">{pct(s.bps)}</AppText>
          </>
        );
        return onSelect ? (
          <Pressable key={s.key} accessibilityRole="button" accessibilityLabel={`${s.label} ${pct(s.bps)}`} accessibilityState={{ selected: selected === s.key }}
            onPress={() => onSelect(selected === s.key ? null : s.key)}
            className={`min-h-8 flex-row items-center gap-2.5 rounded-control px-1.5 ${selected === s.key ? "bg-surface-muted" : ""} ${selected && selected !== s.key ? "opacity-50" : ""}`}>
            {row}
          </Pressable>
        ) : <View key={s.key} className="min-h-8 flex-row items-center gap-2.5">{row}</View>;
      })}
    </View>
  );
}

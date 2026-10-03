import { formatFraction } from "@repo/app-core";
import type { PublicBasketDetail } from "@repo/validator";
import { useState } from "react";
import { View } from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { palette } from "@repo/design-tokens";
import { AppText } from "@/components/ui/app-text";
import { Chip } from "@/components/ui/chip";

const RANGES = [{ id: "30d", label: "30 d", days: 30 }, { id: "90d", label: "90 d", days: 90 }, { id: "1y", label: "1 y", days: 365 }, { id: "all", label: "All", days: Infinity }] as const;
const TILES = [["sinceLaunch", "Since launch", 1], ["d30", "30 days", 30], ["d90", "90 days", 90], ["y1", "1 year", 365]] as const;
const DAY = 86_400_000;
const W = 600, H = 220, PAD = 12;

type Props = { performance: PublicBasketDetail["performance"]; metrics: PublicBasketDetail["metrics"]; label: string };

/** Simulated model performance: metric tiles and a net / gross line chart. Server figures only; the chart is a text summary for screen readers. */
export function Performance({ performance, metrics, label }: Props) {
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  const unavailable = !metrics.available;
  const tile = (value: string | null, days: number, signed = true) => (unavailable ? "Performance unavailable" : value === null ? `Available after ${days} days of data` : formatFraction(value, signed));
  const all = performance.series;
  const last = all.at(-1);
  const span = RANGES.find((r) => r.id === range)!.days;
  const cut = last ? Date.parse(last.day) - span * DAY : 0;
  const pts = all.filter((p) => Date.parse(p.day) >= cut);
  const first = pts[0];
  const end = pts.at(-1);
  const values = pts.flatMap((p) => [Number(p.net), Number(p.gross)]);
  const lo = Math.min(...values), hi = Math.max(...values);
  const x = (day: string) => PAD + ((Date.parse(day) - Date.parse(first!.day)) / ((Date.parse(end!.day) - Date.parse(first!.day)) || 1)) * (W - 2 * PAD);
  const y = (v: string) => PAD + (1 - (Number(v) - lo) / (hi - lo || 1)) * (H - 2 * PAD);
  const line = (key: "net" | "gross") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");

  return (
    <View className="gap-3">
      <AppText variant="h3" accessibilityRole="header">Simulated model performance</AppText>
      <AppText tone="stone">{label}</AppText>
      <View className="flex-row flex-wrap gap-3">
        {TILES.map(([key, title, days]) => (
          <View key={key} className="min-w-[45%] flex-1 rounded-xl border border-border-dark bg-slate p-3">
            <AppText variant="label" tone="stone">{title} (net)</AppText>
            <AppText className="font-sans-semibold">{tile(metrics.net[key], days)}</AppText>
            {!unavailable && metrics.gross[key] !== null ? <AppText variant="label" tone="stone">Gross {formatFraction(metrics.gross[key], true)}</AppText> : null}
          </View>
        ))}
        <View className="min-w-[45%] flex-1 rounded-xl border border-border-dark bg-slate p-3">
          <AppText variant="label" tone="stone">Volatility (annualized)</AppText>
          <AppText className="font-sans-semibold">{tile(metrics.volatility, 30, false)}</AppText>
        </View>
        <View className="min-w-[45%] flex-1 rounded-xl border border-border-dark bg-slate p-3">
          <AppText variant="label" tone="stone">Max drawdown</AppText>
          <AppText className="font-sans-semibold">{tile(metrics.maxDrawdown, 30, false)}</AppText>
        </View>
      </View>
      {unavailable ? <AppText>Performance unavailable</AppText> : !first || !end || pts.length < 2 ? <AppText tone="stone">The chart appears once there are two days of data.</AppText> : (
        <View className="gap-3">
          <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
            {RANGES.map((r) => <Chip key={r.id} label={r.label} selected={range === r.id} onPress={() => setRange(r.id)} />)}
          </View>
          <View accessible accessibilityRole="image"
            accessibilityLabel={`Simulated index, base 100, from ${first.day} to ${end.day}. Net moved from ${Number(first.net).toFixed(2)} to ${Number(end.net).toFixed(2)}; gross from ${Number(first.gross).toFixed(2)} to ${Number(end.gross).toFixed(2)}.`}>
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              <Line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke={palette.stone} strokeOpacity={0.4} />
              <Path d={line("gross")} fill="none" stroke={palette.stone} strokeWidth={2} strokeDasharray="6 4" />
              <Path d={line("net")} fill="none" stroke={palette.mint} strokeWidth={2.5} />
            </Svg>
          </View>
          <AppText variant="label" tone="stone">{first.day} to {end.day} · Net (solid, green) · Gross (dashed)</AppText>
        </View>
      )}
    </View>
  );
}

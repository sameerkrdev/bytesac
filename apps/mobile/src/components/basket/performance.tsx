import { formatFraction } from "@repo/app-core";
import type { PublicBasketDetail } from "@repo/validator";
import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { useTheme } from "@/lib/theme";

const RANGES = [{ id: "30d", label: "30 d", days: 30 }, { id: "90d", label: "90 d", days: 90 }, { id: "1y", label: "1 y", days: 365 }, { id: "all", label: "All", days: Infinity }] as const;
const TILES = [["sinceLaunch", "Since launch", 1], ["d30", "30 days", 30], ["d90", "90 days", 90], ["y1", "1 year", 365]] as const;
const DAY = 86_400_000;
const W = 600, H = 200, PAD = 8;

type Props = { performance: PublicBasketDetail["performance"]; metrics: PublicBasketDetail["metrics"]; label: string };

/** Simulated model performance: a net / gross line chart and metric tiles. Server figures only; the chart is a text summary for screen readers. */
export function Performance({ performance, metrics, label }: Props) {
  const { colors } = useTheme();
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  // Scrubbing: the finger's x picks the nearest day; released, the chart shows the whole range again.
  const [width, setWidth] = useState(1);
  const [at, setAt] = useState<number | null>(null);
  const unavailable = !metrics.available;
  const tile = (value: string | null, days: number, signed = true) => (unavailable ? "Performance unavailable" : value === null ? `Available after ${days} days of data` : formatFraction(value, signed));
  const tone = (value: string | null) => (unavailable || value === null ? "muted" : Number(value) >= 0 ? "success" : "danger") as "muted" | "success" | "danger";
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
  const nearest = (px: number) => {
    if (pts.length < 2) return null;
    const vx = (px / width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(x(p.day) - vx) < Math.abs(x(pts[best]!.day) - vx)) best = i; });
    return best;
  };
  const scrub = { onStartShouldSetResponder: () => true, onMoveShouldSetResponder: () => true, onResponderTerminationRequest: () => false,
    onResponderGrant: (e: { nativeEvent: { locationX: number } }) => setAt(nearest(e.nativeEvent.locationX)),
    onResponderMove: (e: { nativeEvent: { locationX: number } }) => setAt(nearest(e.nativeEvent.locationX)),
    onResponderRelease: () => setAt(null), onResponderTerminate: () => setAt(null) };
  const sel = at !== null ? pts[at] : undefined;
  const change = (v: string, base: string) => formatFraction(String(Number(v) / Number(base) - 1), true);
  const line = (key: "net" | "gross") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(" ");

  return (
    <View className="gap-3">
      <View className="gap-1">
        <AppText variant="eyebrow" tone="faint">Model, not results</AppText>
        <AppText variant="title" accessibilityRole="header">Simulated model performance</AppText>
      </View>
      <AppText variant="label" tone="muted">{label}</AppText>
      <Card className="gap-4">
        {unavailable ? <AppText tone="muted">Performance unavailable</AppText> : !first || !end || pts.length < 2 ? <AppText tone="muted">The chart appears once there are two days of data.</AppText> : (
          <>
            <View className="min-h-10 justify-center">
              {sel && first ? (
                <AppText variant="label">{`${sel.day} · Net ${change(sel.net, first.net)} · Gross ${change(sel.gross, first.gross)}`}</AppText>
              ) : <AppText variant="micro" tone="faint">Touch and drag across the chart to read a day.</AppText>}
            </View>
            <View accessible accessibilityRole="image" onLayout={(e) => setWidth(e.nativeEvent.layout.width || 1)} {...scrub}
              accessibilityLabel={`Simulated index, base 100, from ${first.day} to ${end.day}. Net moved from ${Number(first.net).toFixed(2)} to ${Number(end.net).toFixed(2)}; gross from ${Number(first.gross).toFixed(2)} to ${Number(end.gross).toFixed(2)}.`}>
              <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                <Defs>
                  <LinearGradient id="net-fill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colors.accent} stopOpacity={0.18} />
                    <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                <Line x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} stroke={colors.lineStrong} />
                <Path d={`${line("net")} L${(W - PAD).toFixed(1)} ${H - PAD} L${PAD} ${H - PAD} Z`} fill="url(#net-fill)" />
                <Path d={line("gross")} fill="none" stroke={colors.inkFaint} strokeWidth={1.5} strokeDasharray="6 5" />
                <Path d={line("net")} fill="none" stroke={colors.accent} strokeWidth={2.5} strokeLinejoin="round" />
                {sel ? (
                  <>
                    <Line x1={x(sel.day)} x2={x(sel.day)} y1={PAD} y2={H - PAD} stroke={colors.inkMuted} strokeWidth={1} strokeDasharray="3 3" />
                    <Circle cx={x(sel.day)} cy={y(sel.net)} r={5} fill={colors.accent} stroke={colors.surface} strokeWidth={2} />
                  </>
                ) : null}
              </Svg>
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <AppText variant="micro" tone="faint">{`${first.day} → ${end.day} · Net solid · Gross dashed`}</AppText>
            </View>
            <View accessibilityRole="radiogroup" className="flex-row gap-2">
              {RANGES.map((r) => <Chip key={r.id} label={r.label} selected={range === r.id} onPress={() => { setAt(null); setRange(r.id); }} />)}
            </View>
          </>
        )}
      </Card>
      <View className="flex-row flex-wrap gap-2">
        {TILES.map(([key, title, days]) => (
          <View key={key} className="min-w-[45%] flex-1 gap-1 rounded-tile bg-surface-muted p-4">
            <AppText variant="micro" tone="faint">{`${title} · net`}</AppText>
            <AppText tone={tone(metrics.net[key])} className="font-medium">{tile(metrics.net[key], days)}</AppText>
            {!unavailable && metrics.gross[key] !== null ? <AppText variant="micro" tone="faint">Gross {formatFraction(metrics.gross[key], true)}</AppText> : null}
          </View>
        ))}
        <View className="min-w-[45%] flex-1 gap-1 rounded-tile bg-surface-muted p-4">
          <AppText variant="micro" tone="faint">Volatility · annualized</AppText>
          <AppText className="font-medium">{tile(metrics.volatility, 30, false)}</AppText>
        </View>
        <View className="min-w-[45%] flex-1 gap-1 rounded-tile bg-surface-muted p-4">
          <AppText variant="micro" tone="faint">Max drawdown</AppText>
          <AppText className="font-medium">{tile(metrics.maxDrawdown, 30, false)}</AppText>
        </View>
      </View>
    </View>
  );
}

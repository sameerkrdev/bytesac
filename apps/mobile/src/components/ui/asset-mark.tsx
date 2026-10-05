import { Image } from "expo-image";
import { View } from "react-native";
import { cryptoLogo } from "@/lib/crypto-logos";
import { AppText } from "./app-text";

const TINTS = ["bg-data1", "bg-data2", "bg-data3", "bg-data4", "bg-data5", "bg-data6"];

/**
 * An asset's mark: the registry logo when there is one, else a bundled icon for common tickers, else a monogram.
 * Decorative: the symbol always appears as text next to it.
 */
export function AssetMark({ symbol, logoUrl, size = 32, index = 0, ring = false }: { symbol: string; logoUrl?: string | null; size?: number; index?: number; ring?: boolean }) {
  const src = logoUrl ?? cryptoLogo(symbol);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (src) {
    return (
      <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className={`overflow-hidden bg-surface ${ring ? "border-2 border-surface" : ""}`} style={box}>
        <Image source={src} style={{ width: "100%", height: "100%" }} contentFit="contain" />
      </View>
    );
  }
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className={`items-center justify-center ${TINTS[index % TINTS.length]} ${ring ? "border-2 border-surface" : ""}`} style={box}>
      <AppText className="font-mono-medium" tone={index % 6 === 0 || index % 6 === 5 ? "primaryInk" : "ink"} style={{ fontSize: Math.max(8, size * 0.3) }}>{symbol.slice(0, symbol.length > 4 ? 3 : 4)}</AppText>
    </View>
  );
}

/** Overlapping marks of a basket's largest holdings. */
export function AssetStack({ symbols, size = 30, max = 3 }: { symbols: string[]; size?: number; max?: number }) {
  return (
    <View className="flex-row" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {symbols.slice(0, max).map((s, i) => <View key={s} style={{ marginLeft: i === 0 ? 0 : -size * 0.28 }}><AssetMark symbol={s} size={size} index={i} ring /></View>)}
    </View>
  );
}

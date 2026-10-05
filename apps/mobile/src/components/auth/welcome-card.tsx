import { Image } from "expo-image";
import { Wallet } from "lucide-react-native";
import { useState } from "react";
import { type NativeScrollEvent, type NativeSyntheticEvent, ScrollView, useWindowDimensions, View } from "react-native";
import { Logo } from "@/components/brand/logo";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Sky } from "@/components/ui/sky";
import { useTheme } from "@/lib/theme";

 
const PANELS = [
  { art: require("../../../assets/visuals/glass-allocation-ring-640.webp"), ratio: 640 / 760, eyebrow: "Research", title: "Baskets with their homework shown",
    body: "Strategies published by organizations, with thesis, fees, risks and simulated model performance — labelled as simulated." },
  { art: require("../../../assets/visuals/glass-wallet-640.webp"), ratio: 640 / 486, eyebrow: "Self-custody", title: "Your wallet. Your signature.",
    body: "Assets stay in your own wallets. You approve every step of every investment, one by one." },
  { art: require("../../../assets/visuals/glass-portfolio-prism-560.webp"), ratio: 560 / 828, eyebrow: "Your decision", title: "Updates are yours to accept",
    body: "When a manager publishes a new version you review it and choose to follow or skip. Skipping never trades." },
];
 

export function SessionExpiredBanner() {
  return (
    <View accessibilityRole="alert" className="rounded-card border border-info/30 bg-info-soft p-4">
      <AppText>Your session expired. Sign in with your wallet again.</AppText>
    </View>
  );
}

/** First run: three calm panels over the sky (research, self-custody, your decision), then Connect wallet. */
export function WelcomeCard({ expired, onConnect }: { expired: boolean; onConnect(): void }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const [page, setPage] = useState(0);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1)));
  const art = Math.min(height * 0.3, 260);
  return (
    <View className="flex-1">
      <Sky height={height * 0.46} />
      {/* Above the absolutely positioned sky (on web it would otherwise paint over in-flow content). */}
      <View className="flex-1" style={{ zIndex: 1 }}>
      <View className="flex-row items-center gap-2 px-5 pt-14">
        <View className="rounded-control bg-white p-1"><Logo size={24} /></View>
        <AppText variant="heading" accessibilityRole="header">Welcome to Bytesac</AppText>
      </View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} onScroll={onScroll} scrollEventThrottle={64} className="flex-1"
        accessibilityLabel={`Introduction, page ${page + 1} of ${PANELS.length}`}>
        {PANELS.map((p) => (
          <View key={p.title} style={{ width }} className="justify-end gap-3 px-6 pb-6">
            <View className="flex-1 items-center justify-center">
              <Image source={p.art} accessibilityElementsHidden importantForAccessibility="no" contentFit="contain" style={{ height: art, width: art * p.ratio }} />
            </View>
            <AppText variant="eyebrow" tone="muted">{p.eyebrow}</AppText>
            <AppText variant="display">{p.title}</AppText>
            <AppText variant="bodyLarge" tone="muted">{p.body}</AppText>
          </View>
        ))}
      </ScrollView>
      <View className="gap-4 px-5 pb-10">
        <View className="flex-row justify-center gap-1.5" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {PANELS.map((p, i) => <View key={p.title} className={`h-1.5 rounded-pill ${i === page ? "w-6 bg-ink" : "w-1.5 bg-line-strong"}`} />)}
        </View>
        {expired && <SessionExpiredBanner />}
        <Button size="lg" onPress={onConnect} icon={<Wallet size={18} color={colors.primaryInk} />}>Connect wallet</Button>
        <AppText variant="micro" tone="faint" className="text-center">Connecting only reads your address. Signing in is a message, not a transaction.</AppText>
      </View>
      </View>
    </View>
  );
}

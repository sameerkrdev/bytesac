import { Wallet } from "lucide-react-native";
import { View } from "react-native";
import { palette } from "@repo/design-tokens";
import { Logo } from "@/components/brand/logo";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";

export function SessionExpiredBanner() {
  return (
    <View accessibilityRole="alert" className="rounded-xl border border-info bg-slate p-3">
      <AppText>Your session expired. Sign in with your wallet again.</AppText>
    </View>
  );
}

export function WelcomeCard({ expired, onConnect }: { expired: boolean; onConnect(): void }) {
  return (
    <View className="flex-1 justify-center gap-6">
      <View className="items-center"><Logo size={64} /></View>
      {expired && <SessionExpiredBanner />}
      <AppText variant="display" className="text-center" accessibilityRole="header">Welcome to Bytesac</AppText>
      <AppText variant="bodyLarge" tone="muted" className="text-center">Build, discover and invest in on-chain investment baskets.</AppText>
      <Button onPress={onConnect} icon={<Wallet size={18} color={palette.space} />}>Connect wallet</Button>
    </View>
  );
}

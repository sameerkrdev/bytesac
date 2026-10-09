import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { View } from "react-native";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { SessionExpiredBanner, WelcomeCard } from "@/components/auth/welcome-card";
import { AppText } from "@/components/ui/app-text";
import { Screen } from "@/components/ui/screen";
import { Sky } from "@/components/ui/sky";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

/** Welcome panels until a wallet is connected; then Connected → Sign to verify. */
export default function SignInScreen() {
  const router = useRouter();
  const { expired, status } = useAuth();
  // A flow that starts signed-out navigates itself via onVerified; only redirect users who were already signed in.
  const startedSignedOut = useRef(false);
  useEffect(() => {
    if (status === "signedOut") startedSignedOut.current = true;
    else if (status === "signedIn" && !startedSignedOut.current) router.replace("/(app)/(tabs)/home");
  }, [status, router]);
  const wallet = useWalletConnector();
  const onVerified = useCallback(
    (isNewUser: boolean) => {
      router.replace(isNewUser ? "/(auth)/contact" : "/(app)/(tabs)/home");
    },
    [router],
  );
  if (wallet.network === "none") return <View className="flex-1 bg-canvas"><WelcomeCard expired={expired} onConnect={wallet.connect} /></View>;
  return (
    <Screen edges={["left", "right", "bottom"]} backdrop={<Sky height={360} />}>
      <View className="gap-2 pt-20">
        <AppText variant="eyebrow" tone="muted">Sign in</AppText>
        <AppText variant="display" accessibilityRole="header">Prove it is your wallet</AppText>
        <AppText tone="muted">One signed message, no transaction and no spending permission.</AppText>
      </View>
      {expired && <SessionExpiredBanner />}
      <WalletVerification purpose="sign_in" onVerified={onVerified} />
      {/* ADR-004: an unknown address signing in creates a new user; accounts are never merged. */}
      <AppText variant="label" tone="faint">
        {"Signing in with a wallet Bytesac hasn't seen creates a new account. To add a wallet to your existing account, sign in with that account, then use Profile → Add chain account."}
      </AppText>
    </Screen>
  );
}

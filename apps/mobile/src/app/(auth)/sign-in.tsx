import { useRouter } from "expo-router";
import { useCallback } from "react";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { SessionExpiredBanner, WelcomeCard } from "@/components/auth/welcome-card";
import { Screen } from "@/components/ui/screen";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

export default function SignInScreen() {
  const router = useRouter();
  const { expired } = useAuth();
  const wallet = useWalletConnector();
  const onVerified = useCallback(
    (isNewUser: boolean) => {
      router.replace(isNewUser ? "/(auth)/contact" : "/(app)/home");
    },
    [router],
  );
  return (
    <Screen scroll={wallet.network !== "none"}>
      {wallet.network === "none"
        ? <WelcomeCard expired={expired} onConnect={wallet.connect} />
        : (
          <>
            {expired && <SessionExpiredBanner />}
            <WalletVerification purpose="sign_in" onVerified={onVerified} />
          </>
        )}
    </Screen>
  );
}

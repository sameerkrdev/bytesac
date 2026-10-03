import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { SessionExpiredBanner, WelcomeCard } from "@/components/auth/welcome-card";
import { Screen } from "@/components/ui/screen";
import { useAuth } from "@/lib/auth-context";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

export default function SignInScreen() {
  const router = useRouter();
  const { expired, status } = useAuth();
  // A flow that starts signed-out navigates itself via onVerified; only redirect users who were already signed in.
  const startedSignedOut = useRef(false);
  useEffect(() => {
    if (status === "signedOut") startedSignedOut.current = true;
    else if (status === "signedIn" && !startedSignedOut.current) router.replace("/(app)/(tabs)/discover");
  }, [status, router]);
  const wallet = useWalletConnector();
  const onVerified = useCallback(
    (isNewUser: boolean) => {
      router.replace(isNewUser ? "/(auth)/contact" : "/(app)/(tabs)/discover");
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

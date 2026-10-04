"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { WelcomeCard } from "@/components/auth/welcome-card";
import { api } from "@/lib/api";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

function SignIn() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const wallet = useWalletConnector();
  const onVerified = useCallback((isNewUser: boolean) => {
    qc.clear();
    router.replace(isNewUser ? "/onboarding/contact" : "/home");
  }, [qc, router]);

  useEffect(() => {
    let cancelled = false;
    api.me().then(() => { if (!cancelled) router.replace("/home"); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [router]);

  const expired = params.get("reason") === "expired";
  return (
    <AuthFrame title={<>Your wallet is your account.<span className="block text-ink-muted">Nothing moves without your signature.</span></>}>
      {wallet.network === "none"
        ? <WelcomeCard expired={expired} onConnect={() => void wallet.connect()} />
        : <WalletVerification purpose="sign_in" expired={expired} onVerified={onVerified} />}
    </AuthFrame>
  );
}

export default function SignInPage() {
  return <Suspense><SignIn /></Suspense>;
}

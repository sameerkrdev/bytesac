"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { WelcomeCard } from "@/components/auth/welcome-card";
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

  return (
    <main className="grid min-h-screen place-items-center bg-space px-4">
      {wallet.network === "none"
        ? <WelcomeCard expired={params.get("reason") === "expired"} onConnect={() => void wallet.connect()} />
        : <WalletVerification purpose="sign_in" onVerified={onVerified} />}
    </main>
  );
}

export default function SignInPage() {
  return <Suspense><SignIn /></Suspense>;
}

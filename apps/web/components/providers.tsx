"use client";

import { createAppQueryClient } from "@repo/app-core";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WalletProviders } from "@/lib/appkit";

export function Providers({ children, cookies }: { children: ReactNode; cookies: string | null }) {
  const [qc] = useState(() => createAppQueryClient(() => window.location.replace("/sign-in?reason=expired")));
  return (
    <QueryClientProvider client={qc}>
      <WalletProviders cookies={cookies}>{children}</WalletProviders>
    </QueryClientProvider>
  );
}

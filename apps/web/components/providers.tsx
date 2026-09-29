"use client";

import { ApiError } from "@repo/api-client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WalletProviders } from "@/lib/appkit";

const EXPIRED = new Set(["SESSION_EXPIRED", "USER_NOT_ACTIVE"]);

export function createAppQueryClient(onSessionExpired: () => void): QueryClient {
  let fired = false;
  const reset = () => { fired = false; };
  const handle = (err: unknown) => {
    if (err instanceof ApiError && EXPIRED.has(err.code) && !fired) {
      fired = true;
      qc.clear();
      onSessionExpired();
    }
  };
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: handle, onSuccess: reset }),
    mutationCache: new MutationCache({ onError: handle, onSuccess: reset }),
    defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, staleTime: 30_000 } },
  });
  return qc;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => createAppQueryClient(() => window.location.replace("/sign-in?reason=expired")));
  return (
    <QueryClientProvider client={qc}>
      <WalletProviders>{children}</WalletProviders>
    </QueryClientProvider>
  );
}

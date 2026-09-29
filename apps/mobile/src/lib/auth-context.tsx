import { ApiError } from "@repo/api-client";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import { tokenStore } from "./token-store";

type Status = "loading" | "signedOut" | "signedIn";
interface AuthValue {
  status: Status;
  expired: boolean;
  acceptToken(token?: string): Promise<void>;
  signOut(opts?: { expired?: boolean; remote?: boolean }): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);
const EXPIRED = new Set(["SESSION_EXPIRED", "USER_NOT_ACTIVE"]);
const DISCONNECT_TIMEOUT_MS = 3000;

export function createAppQueryClient(onExpired: () => void): QueryClient {
  const handle = (e: unknown) => {
    if (e instanceof ApiError && EXPIRED.has(e.code)) onExpired();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: { queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, staleTime: 30_000 } },
  });
}

async function withTimeout(task: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      task().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * `disconnectWallet` is injected because AuthProvider sits outside the wallet providers.
 * It is best-effort, bounded by a timeout, and only used on explicit (remote) logout.
 */
export function AuthProvider({ children, disconnectWallet }: { children: ReactNode; disconnectWallet?: () => Promise<void> }) {
  const [status, setStatus] = useState<Status>("loading");
  const [expired, setExpired] = useState(false);
  const signingOut = useRef(false);
  const disconnectRef = useRef(disconnectWallet);
  useEffect(() => {
    disconnectRef.current = disconnectWallet;
  }, [disconnectWallet]);

  useEffect(() => {
    void tokenStore.get().then((t) => setStatus(t ? "signedIn" : "signedOut"));
  }, []);

  const [expiredSignal, setExpiredSignal] = useState(0);
  const [qc] = useState(() => createAppQueryClient(() => setExpiredSignal((n) => n + 1)));

  const signOut = useCallback(
    async (opts: { expired?: boolean; remote?: boolean } = {}) => {
      if (signingOut.current) return;
      signingOut.current = true;
      try {
        if (opts.remote) {
          await api.logout().catch(() => undefined);
          const disconnect = disconnectRef.current;
          if (disconnect) await withTimeout(disconnect, DISCONNECT_TIMEOUT_MS);
        }
        await tokenStore.clear();
        qc.clear();
        setExpired(Boolean(opts.expired));
        setStatus("signedOut");
      } finally {
        signingOut.current = false;
      }
    },
    [qc],
  );
  useEffect(() => {
    if (expiredSignal > 0) void signOut({ expired: true });
  }, [expiredSignal, signOut]);

  const acceptToken = useCallback(async (token?: string) => {
    if (token) await tokenStore.set(token);
    setExpired(false);
    setStatus("signedIn");
  }, []);

  const value = useMemo(() => ({ status, expired, acceptToken, signOut }), [status, expired, acceptToken, signOut]);
  return (
    <Ctx.Provider value={value}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </Ctx.Provider>
  );
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

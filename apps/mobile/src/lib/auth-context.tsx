import { createAppQueryClient } from "@repo/app-core";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { api } from "./api";
import { revokeStoredPushToken } from "./push";
import { tokenStore } from "./token-store";

type Status = "loading" | "signedOut" | "signedIn";
interface AuthValue {
  status: Status;
  expired: boolean;
  acceptToken(token?: string): Promise<void>;
  signOut(opts?: { expired?: boolean; remote?: boolean; disconnect?: boolean }): Promise<void>;
}

const Ctx = createContext<AuthValue | null>(null);
const DISCONNECT_TIMEOUT_MS = 3000;

async function withTimeout(task: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.resolve().then(task).catch(() => undefined), new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); })]);
  } finally {
    clearTimeout(timer);
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

  useEffect(() => {
    // Resuming the app revalidates active queries (React Query has no window focus event on native).
    const sub = AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
    return () => sub.remove();
  }, []);

  const signOut = useCallback(
    async (opts: { expired?: boolean; remote?: boolean; disconnect?: boolean } = {}) => {
      if (signingOut.current) return;
      signingOut.current = true;
      try {
        // Stop pushes to this phone while the session can still authorize the revoke (best effort, bounded).
        await withTimeout(revokeStoredPushToken, DISCONNECT_TIMEOUT_MS);
        if (opts.remote) {
          await api.logout().catch(() => undefined);
        }
        if (opts.remote || opts.disconnect) {
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

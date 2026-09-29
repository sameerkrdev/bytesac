import { ApiError } from "@repo/api-client";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

const EXPIRED = new Set(["SESSION_EXPIRED", "USER_NOT_ACTIVE"]);

/** Fires `onSessionExpired` once per expiry (re-armed by the next success) and drops cached data. */
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

import { createApiClient } from "@repo/api-client";
import { tokenStore } from "./token-store";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://10.0.2.2:4000";

function bearerOf(init: RequestInit | undefined): string | null {
  const auth = new Headers(init?.headers).get("Authorization");
  return auth?.startsWith("Bearer ") ? auth.slice(7) : null;
}

/**
 * Discards auth failures (401/403) for requests sent with a token that is no longer the
 * current session token. Without this, a late SESSION_EXPIRED from a superseded session
 * would sign out the new one. The discarded request surfaces as a network error, which
 * never triggers the expiry sign-out.
 */
function createSessionGuardedFetch(
  inner: typeof fetch,
  currentToken: () => Promise<string | null>,
): typeof fetch {
  return async (input, init) => {
    const used = bearerOf(init);
    const res = await inner(input, init);
    if (used !== null && (res.status === 401 || res.status === 403) && used !== (await currentToken())) {
      throw new TypeError("Response for a superseded session was discarded");
    }
    return res;
  };
}

export const api = createApiClient({
  baseUrl,
  transport: { kind: "bearer", getToken: () => tokenStore.get() },
  fetch: createSessionGuardedFetch((input, init) => globalThis.fetch(input, init), () => tokenStore.get()),
});

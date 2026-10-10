import { PREVIEW_GATE_HEADER } from "@repo/validator";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";

/**
 * Soft-launch gate (ADR-022). The web keeps the gate token in an httpOnly cookie; the app has no cookie jar, so the token
 * from POST /v1/preview-gate/login lives in the secure store and goes out as X-Preview-Token on every request.
 * Builds for the soft launch set EXPO_PUBLIC_PREVIEW_GATE=1 so the login shows before the wallet sign-in.
 */
const KEY = "bytesac.preview";
let cache: string | null | undefined;

export const previewGateEnabled = () => process.env.EXPO_PUBLIC_PREVIEW_GATE === "1";

export const previewToken = {
  async get(): Promise<string | null> {
    if (cache === undefined) cache = await SecureStore.getItemAsync(KEY).catch(() => null);
    return cache;
  },
  async set(token: string): Promise<void> {
    cache = token;
    await SecureStore.setItemAsync(KEY, token).catch(() => undefined);
  },
  async clear(): Promise<void> {
    cache = null;
    await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  },
};

/**
 * Adds the gate token. A PREVIEW_GATE_REQUIRED answer (no token, or it expired after 7 days) clears it, opens the
 * preview login and surfaces as a network error, so the session is never treated as expired and signed out.
 */
export function withPreviewGate(inner: typeof fetch): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    const token = await previewToken.get();
    if (token) headers.set(PREVIEW_GATE_HEADER, token);
    const res = await inner(input, { ...init, headers });
    if (res.status === 401) {
      const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
      if (body?.error?.code === "PREVIEW_GATE_REQUIRED") {
        await previewToken.clear();
        router.replace("/(auth)/preview-access");
        throw new TypeError("Preview access required");
      }
    }
    return res;
  };
}

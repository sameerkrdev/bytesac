import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const KEY = "bytesac.session";
let cache: string | null | undefined;
// Bumped by set/clear so an in-flight get() cannot overwrite a newer value.
let generation = 0;

export function __resetTokenCache(): void {
  cache = undefined;
  generation++;
}

/**
 * QA only: the Expo web build used for screenshots sets EXPO_PUBLIC_MOCK_SESSION=1 and passes `?as=investor|manager|new`;
 * the token becomes `mock-<persona>`, which only the local mock API accepts. Never set in real builds.
 */
const mockSession = (): string | null => {
  if (process.env.EXPO_PUBLIC_MOCK_SESSION !== "1" || Platform.OS !== "web" || typeof window === "undefined") return null;
  // Kept for the tab session so redirects (which drop the query) keep the persona.
  const fromUrl = new URLSearchParams(window.location.search).get("as");
  if (fromUrl) window.sessionStorage.setItem("bx_mock_as", fromUrl);
  const as = fromUrl ?? window.sessionStorage.getItem("bx_mock_as");
  return as && /^(investor|manager|ops|new)$/.test(as) ? `mock-${as}` : null;
};

export const tokenStore = {
  async get(): Promise<string | null> {
    const mock = mockSession();
    if (mock) return mock;
    if (cache !== undefined) return cache;
    const started = generation;
    let loaded: string | null;
    try {
      loaded = await SecureStore.getItemAsync(KEY);
    } catch (err) {
      console.warn("Secure storage unavailable; treating as signed out", err instanceof Error ? err.message : "unknown");
      loaded = null;
    }
    if (generation === started) cache = loaded;
    return cache === undefined ? null : cache;
  },
  async set(token: string): Promise<void> {
    generation++;
    cache = token;
    try {
      await SecureStore.setItemAsync(KEY, token);
    } catch (err) {
      console.warn("Could not persist session token", err instanceof Error ? err.message : "unknown");
    }
  },
  async clear(): Promise<void> {
    generation++;
    cache = null;
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* already gone */
    }
  },
};

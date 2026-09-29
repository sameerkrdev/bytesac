import * as SecureStore from "expo-secure-store";

const KEY = "bytesac.session";
let cache: string | null | undefined;
// Bumped by set/clear so an in-flight get() cannot overwrite a newer value.
let generation = 0;

export function __resetTokenCache(): void {
  cache = undefined;
  generation++;
}

export const tokenStore = {
  async get(): Promise<string | null> {
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

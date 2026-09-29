import * as SecureStore from "expo-secure-store";

const KEY = "bytesac.session";
let cache: string | null | undefined;

export function __resetTokenCache(): void {
  cache = undefined;
}

export const tokenStore = {
  async get(): Promise<string | null> {
    if (cache !== undefined) return cache;
    try {
      cache = await SecureStore.getItemAsync(KEY);
    } catch (err) {
      console.warn("Secure storage unavailable; treating as signed out", err instanceof Error ? err.message : "unknown");
      cache = null;
    }
    return cache;
  },
  async set(token: string): Promise<void> {
    cache = token;
    try {
      await SecureStore.setItemAsync(KEY, token);
    } catch (err) {
      console.warn("Could not persist session token", err instanceof Error ? err.message : "unknown");
    }
  },
  async clear(): Promise<void> {
    cache = null;
    try {
      await SecureStore.deleteItemAsync(KEY);
    } catch {
      /* already gone */
    }
  },
};

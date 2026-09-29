import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Storage } from "@reown/appkit-react-native";
import { safeJsonParse, safeJsonStringify } from "@walletconnect/safe-json";

/** AppKit connection state only. The Bytesac session token never goes here (see token-store.ts). */
export const appKitStorage: Storage = {
  getKeys: async () => [...(await AsyncStorage.getAllKeys())],
  getEntries: async <T = unknown>(): Promise<[string, T][]> => {
    const keys = await AsyncStorage.getAllKeys();
    const entries = await AsyncStorage.multiGet(keys);
    return entries.map(([k, v]) => [k, safeJsonParse(v ?? "") as T]);
  },
  setItem: async (key, value) => { await AsyncStorage.setItem(key, safeJsonStringify(value)); },
  getItem: async <T = unknown>(key: string): Promise<T | undefined> => {
    const item = await AsyncStorage.getItem(key);
    return item === null ? undefined : (safeJsonParse(item) as T);
  },
  removeItem: async (key) => { await AsyncStorage.removeItem(key); },
};

process.env.EXPO_PUBLIC_WEB_URL = "https://web.example";
jest.mock(
  "expo-secure-store",
  () => {
    const store = new Map<string, string>();
    return {
      getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
      setItemAsync: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      deleteItemAsync: jest.fn(async (k: string) => {
        store.delete(k);
      }),
      __store: store,
    };
  },
  { virtual: true },
);

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"));
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(async () => undefined), selectionAsync: jest.fn(async () => undefined), notificationAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: { Light: "light", Medium: "medium" }, NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" } }));

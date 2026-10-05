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
// Reanimated 4 needs the worklets native module (absent in jest), so a tiny stand-in covers what the sky's cloud drift uses.
jest.mock("react-native-reanimated", () => {
  const { View } = require("react-native");
  const id = (v: unknown) => v;
  return {
    __esModule: true, default: { View }, Easing: { linear: id, inOut: () => id, ease: id },
    useSharedValue: (v: unknown) => ({ value: v }), useAnimatedStyle: (f: () => unknown) => f(), useReducedMotion: () => true,
    withRepeat: id, withTiming: id, cancelAnimation: () => undefined,
  };
});

// ReanimatedSwipeable needs native gestures and Reanimated; tests render the row and use its Revoke button instead.
jest.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({ __esModule: true, default: ({ children }: { children: unknown }) => children }));

// Push needs native modules; tests see a physical device with push off (the switch and banner logic run against this).
jest.mock("expo-device", () => ({ isDevice: true, modelName: "Test phone" }));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "undetermined" })), requestPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })), setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(), useLastNotificationResponse: jest.fn(() => null), DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT", AndroidImportance: { HIGH: 4 },
}));

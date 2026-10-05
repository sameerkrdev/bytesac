import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "@/lib/api";

/*
 * Mobile push (decided 2026-10-05): an Expo push token per device, registered with the API as platform ios/android and
 * provider expo; the API sends through the Expo push service with the inbox title and body. Push is opt-in from the
 * app (Profile → Notifications or the Alerts banner); the OS permission prompt only appears after that tap.
 * Docs: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
 */

const KEY = "bx_push_token";
export const NATIVE = Platform.OS === "ios" || Platform.OS === "android";
const CHANNEL = "default";

export type PushState = "on" | "off" | "denied" | "unsupported" | "simulator" | "unconfigured";

/** The EAS project id the Expo push token is issued for (set by `eas init` in app.json → extra.eas.projectId). */
const projectId = (): string | undefined => (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;

/** Why push cannot work here, or null when it can (a physical iOS/Android device in a build with a project id). */
export function pushBlocker(): Exclude<PushState, "on" | "off" | "denied"> | null {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return "unsupported";
  if (!Device.isDevice) return "simulator";
  if (!projectId()) return "unconfigured";
  return null;
}

/** Banners and the notification list while the app is open; no sound or badge changes. */
if (NATIVE) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** The device token this app registered (kept so sign-out and the switch can revoke it). */
export const stored = async () => { try { return await AsyncStorage.getItem(KEY); } catch { return null; } };

/** Current state for the settings switch. */
export async function pushState(): Promise<PushState> {
  const blocker = pushBlocker();
  if (blocker) return blocker;
  const { status } = await Notifications.getPermissionsAsync();
  if (status === "denied") return "denied";
  return status === "granted" && (await stored()) ? "on" : "off";
}

/** Registers (or re-registers) this device's Expo token with the API and remembers it. */
export async function register(): Promise<void> {
  if (Platform.OS === "android") {
    // Android 13+ needs a channel before a token can be issued; the server sends on this channel.
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Basket updates", importance: Notifications.AndroidImportance.HIGH });
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId()! });
  await api.registerPushToken({ token, platform: Platform.OS as "ios" | "android", provider: "expo", userAgent: `${Device.modelName ?? "Device"} · ${Platform.OS} ${String(Platform.Version)}`.slice(0, 300) });
  const previous = await stored();
  if (previous && previous !== token) await api.revokePushToken(previous).catch(() => undefined);
  await AsyncStorage.setItem(KEY, token);
}

/** Asks the OS for permission (only now, after the user's tap) and registers this device. */
export async function enablePush(): Promise<PushState> {
  const blocker = pushBlocker();
  if (blocker) return blocker;
  const current = await Notifications.getPermissionsAsync();
  const { status } = current.status === "granted" ? current : await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
  if (status !== "granted") return "denied";
  await register();
  return "on";
}

/** Stops pushes to this device: the server revokes the token (revoked, never deleted). */
export async function disablePush(): Promise<PushState> {
  const token = await stored();
  if (token) await api.revokePushToken(token).catch(() => undefined);
  await AsyncStorage.removeItem(KEY).catch(() => undefined);
  return pushBlocker() ?? "off";
}

/** Sign-out: best effort, before the session is cleared (the revoke call needs it). */
export const revokeStoredPushToken = async () => { const token = await stored(); if (!token) return; await api.revokePushToken(token).catch(() => undefined); await AsyncStorage.removeItem(KEY).catch(() => undefined); };

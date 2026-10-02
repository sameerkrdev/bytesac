import { getApps, initializeApp } from "firebase/app";
import { getMessaging, isSupported } from "firebase/messaging";

// NEXT_PUBLIC_* must be read by literal name so Next inlines them. These are public web-app identifiers, not secrets.
const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};
export const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? "";

/** The service worker cannot read env, so the public config travels in its URL. */
export const serviceWorkerUrl = `/firebase-messaging-sw.js?${new URLSearchParams(config)}`;

/** Messaging, or null when push is not configured or the browser cannot do it. */
export async function getPushMessaging() {
  if (![...Object.values(config), vapidKey].every(Boolean) || !(await isSupported())) return null;
  return getMessaging(getApps()[0] ?? initializeApp(config));
}

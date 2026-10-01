import { cert, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { logger } from "@repo/logger";
import { env } from "../env";

/** Web push through Firebase Cloud Messaging. Without `FIREBASE_SERVICE_ACCOUNT` (JSON) push is off: nothing is sent and the inbox and email still work. */
const app = env.FIREBASE_SERVICE_ACCOUNT ? initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) }) : null;
if (!app && env.NODE_ENV !== "test") logger.warn("FIREBASE_SERVICE_ACCOUNT is not set: web push is disabled");

/** FCM answers these for a token that will never work again (the browser unsubscribed, or the token is malformed). */
const DEAD_TOKEN = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"];

/**
 * Sends one notification to every token (a user has a handful, well under FCM's 500 per call) and returns the tokens FCM reports as dead, so the caller
 * can revoke them. `link` must be an absolute https URL. Throws when FCM itself fails; the caller logs it.
 */
export async function sendPush(tokens: string[], n: { title: string; body: string; link: string }): Promise<string[]> {
  if (!app || tokens.length === 0) return [];
  const res = await getMessaging(app).sendEachForMulticast({ tokens, notification: { title: n.title, body: n.body }, webpush: { fcmOptions: { link: n.link } } });
  return tokens.filter((_, i) => !res.responses[i]!.success && DEAD_TOKEN.includes(res.responses[i]!.error?.code ?? ""));
}

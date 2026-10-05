import { z } from "@repo/validator";
import { env } from "@/config/dotenv";

/**
 * Mobile push through the Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/), which
 * delivers to APNs and FCM with the credentials uploaded to EAS. `EXPO_ACCESS_TOKEN` is optional (Expo's enhanced push
 * security); without it the service still accepts tokens issued for this project.
 */
const URL = "https://exp.host/--/api/v2/push/send";
/** Expo accepts at most 100 messages per request. */
const BATCH = 100;

const ticketsSchema = z.object({
  data: z.array(z.object({ status: z.enum(["ok", "error"]), id: z.string().optional(), message: z.string().optional(), details: z.object({ error: z.string().optional() }).passthrough().optional() })).optional(),
  errors: z.array(z.object({ code: z.string(), message: z.string() })).optional(),
});

export type ExpoMessage = { title: string; body: string; data: { link: string; notificationId: string } };

/**
 * Sends one notification to every token in batches of 100 and returns the tokens Expo reports as `DeviceNotRegistered`
 * (the app was uninstalled or push turned off), so the caller can revoke them. Delivery receipts are not polled.
 * Throws when the push service itself fails; the caller logs it. `fetchImpl` exists for tests.
 */
export async function sendExpoPush(tokens: string[], m: ExpoMessage, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const dead: string[] = [];
  for (let i = 0; i < tokens.length; i += BATCH) {
    const batch = tokens.slice(i, i + BATCH);
    const res = await fetchImpl(URL, {
      method: "POST",
      headers: { accept: "application/json", "accept-encoding": "gzip, deflate", "content-type": "application/json", ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) },
      body: JSON.stringify(batch.map((to) => ({ to, title: m.title, body: m.body, data: m.data, sound: "default", channelId: "default", priority: "high" }))),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Expo push failed: HTTP ${res.status}`);
    const parsed = ticketsSchema.parse(await res.json());
    if (parsed.errors?.length) throw new Error(`Expo push failed: ${parsed.errors[0]!.code}`);
    parsed.data?.forEach((t, n) => { if (t.status === "error" && t.details?.error === "DeviceNotRegistered") dead.push(batch[n]!); });
  }
  return dead;
}

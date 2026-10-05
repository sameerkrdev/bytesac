import { describe, expect, it, vi } from "vitest";

const real = () => vi.importActual<typeof import("@/providers/expo-push")>("@/providers/expo-push");
const msg = { title: "Blue has drifted", body: "Review your basket.", data: { link: "/portfolio", notificationId: "n-1" } };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Expo push provider", () => {
  it("posts the documented message shape in batches of 100 and reports DeviceNotRegistered tokens as dead", async () => {
    const { sendExpoPush } = await real();
    const tokens = Array.from({ length: 150 }, (_, i) => `ExponentPushToken[t${i}]`);
    const bodies: unknown[][] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const batch = JSON.parse(String(init!.body)) as { to: string }[];
      bodies.push(batch);
      return reply({ data: batch.map((m) => (m.to === "ExponentPushToken[t120]" ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
        : m.to === "ExponentPushToken[t3]" ? { status: "error", message: "slow down", details: { error: "MessageRateExceeded" } } : { status: "ok", id: "r" })) });
    });
    const dead = await sendExpoPush(tokens, msg, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://exp.host/--/api/v2/push/send");
    expect(bodies.map((b) => b.length)).toEqual([100, 50]);
    expect(bodies[0]![0]).toEqual({ to: "ExponentPushToken[t0]", title: msg.title, body: msg.body, data: msg.data, sound: "default", channelId: "default", priority: "high" });
    expect(dead).toEqual(["ExponentPushToken[t120]"]);
  });

  it("throws on an HTTP or request-level error so the caller logs it", async () => {
    const { sendExpoPush } = await real();
    await expect(sendExpoPush(["ExponentPushToken[a]"], msg, (async () => reply({}, 500)) as unknown as typeof fetch)).rejects.toThrow("HTTP 500");
    await expect(sendExpoPush(["ExponentPushToken[a]"], msg, (async () => reply({ errors: [{ code: "PUSH_TOO_MANY_NOTIFICATIONS", message: "x" }] })) as unknown as typeof fetch)).rejects.toThrow("PUSH_TOO_MANY_NOTIFICATIONS");
  });

  it("sends nothing for no tokens", async () => {
    const { sendExpoPush } = await real();
    const fetchImpl = vi.fn();
    expect(await sendExpoPush([], msg, fetchImpl as unknown as typeof fetch)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

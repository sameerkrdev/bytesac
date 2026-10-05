import { describe, expect, it } from "vitest";
import { pushTokenSchema, revokePushTokenSchema } from "./rebalance";

describe("pushTokenSchema", () => {
  it("defaults a web registration to web / fcm, so the web client is unchanged", () => {
    expect(pushTokenSchema.parse({ token: "fcm-token", userAgent: "Firefox" })).toEqual({ token: "fcm-token", userAgent: "Firefox", platform: "web", provider: "fcm" });
  });
  it("accepts an Expo token from the iOS or Android app", () => {
    for (const token of ["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "ExpoPushToken[abc_DEF-123]"]) {
      expect(pushTokenSchema.safeParse({ token, platform: "ios", provider: "expo" }).success).toBe(true);
      expect(pushTokenSchema.safeParse({ token, platform: "android", provider: "expo" }).success).toBe(true);
    }
  });
  it("refuses an Expo provider on the web, a malformed Expo token and FCM from the app", () => {
    expect(pushTokenSchema.safeParse({ token: "ExponentPushToken[abc]", platform: "web", provider: "expo" }).success).toBe(false);
    expect(pushTokenSchema.safeParse({ token: "ExponentPushToken[]", platform: "ios", provider: "expo" }).success).toBe(false);
    expect(pushTokenSchema.safeParse({ token: "fcm-token", platform: "ios", provider: "expo" }).success).toBe(false);
    expect(pushTokenSchema.safeParse({ token: "fcm-token", platform: "android", provider: "fcm" }).success).toBe(false);
    expect(pushTokenSchema.safeParse({ token: "fcm-token", extra: 1 }).success).toBe(false);
  });
  it("revoking needs only the token", () => {
    expect(revokePushTokenSchema.safeParse({ token: "ExponentPushToken[abc]" }).success).toBe(true);
    expect(revokePushTokenSchema.safeParse({ token: "" }).success).toBe(false);
  });
});

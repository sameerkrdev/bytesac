import { describe, expect, it } from "vitest";
import {
  addContactRequestSchema, challengeRequestSchema, updateNotificationPreferencesSchema,
  verifyContactRequestSchema, verifyRequestSchema,
} from "./index";

describe("schemas", () => {
  it("challenge request", () => {
    expect(challengeRequestSchema.parse({ purpose: "sign_in", chain: "base", address: "0xabc" }).chain).toBe("base");
    expect(() => challengeRequestSchema.parse({ purpose: "sign_in", chain: "dogecoin", address: "0xabc" })).toThrow();
  });
  it("verify request requires uuid challenge id and client", () => {
    expect(() => verifyRequestSchema.parse({ challengeId: "x", signature: "0x1", client: "web" })).toThrow();
    const ok = verifyRequestSchema.parse({
      challengeId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", signature: "0x1", client: "mobile",
    });
    expect(ok.client).toBe("mobile");
  });
  it("otp code is 6 digits", () => {
    expect(() => verifyContactRequestSchema.parse({ code: "12345" })).toThrow();
    expect(verifyContactRequestSchema.parse({ code: "123456" }).code).toBe("123456");
  });
  it("contact type is email or phone", () => {
    expect(() => addContactRequestSchema.parse({ type: "fax", value: "1" })).toThrow();
  });
  it("preferences patch rejects empty and unknown keys", () => {
    expect(() => updateNotificationPreferencesSchema.parse({})).toThrow();
    expect(() => updateNotificationPreferencesSchema.parse({ security: false })).toThrow();
    expect(updateNotificationPreferencesSchema.parse({ marketing: true })).toEqual({ marketing: true });
  });
});

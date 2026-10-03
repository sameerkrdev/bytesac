import { describe, expect, it } from "vitest";
import { maskContact, normalizeContact } from "@/modules/contacts/contact-value.service";
import { generateOtp, hashOtp, otpMatches } from "@/modules/contacts/otp.service";

const ALLOWED = ["IN", "US"];

describe("contact values", () => {
  it("normalizes email (trim, lowercase)", () => {
    expect(normalizeContact("email", "  Alice@Example.COM ", ALLOWED)).toBe("alice@example.com");
    expect(() => normalizeContact("email", "not-an-email", ALLOWED)).toThrow();
  });
  it("requires international phone format and an allowed country", () => {
    expect(normalizeContact("phone", "+91 98765 43210", ALLOWED)).toBe("+919876543210");
    expect(() => normalizeContact("phone", "9876543210", ALLOWED)).toThrow(/country code/);
    expect(() => normalizeContact("phone", "+44 7911 123456", ALLOWED)).toThrow(/not supported/);
  });
  it("masks values for audit", () => {
    expect(maskContact("email", "alice@example.com")).toBe("a***@example.com");
    expect(maskContact("phone", "+919876543210")).toBe("+*********10");
  });
});

describe("otp", () => {
  it("6 digits; hash binds to verification id", () => {
    const code = generateOtp();
    expect(code).toMatch(/^\d{6}$/);
    const h = hashOtp("s".repeat(32), "v1", code);
    expect(otpMatches("s".repeat(32), "v1", code, h)).toBe(true);
    expect(otpMatches("s".repeat(32), "v2", code, h)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { formatRelative, shortAddress } from "@/lib/format";

describe("format", () => {
  it("shortAddress", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(shortAddress("4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T")).toBe("4Nd1mB…DB4T");
  });
  it("formatRelative", () => {
    const now = new Date("2026-09-29T12:00:00Z");
    expect(formatRelative("2026-09-29T11:59:30Z", now)).toBe("just now");
    expect(formatRelative("2026-09-29T11:00:00Z", now)).toBe("1 hour ago");
    expect(formatRelative("2026-09-27T12:00:00Z", now)).toBe("2 days ago");
  });
});

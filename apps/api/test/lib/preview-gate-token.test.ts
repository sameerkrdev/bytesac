import { describe, expect, it } from "vitest";
import { issuePreviewGateToken, verifyPreviewGateToken } from "@/lib/preview-gate-token";

describe("preview gate token", () => {
  const secret = "s".repeat(32);

  it("issues a token that verifies for seven days", () => {
    const { token } = issuePreviewGateToken(secret, Date.now());
    expect(verifyPreviewGateToken(token, secret)).toBe(true);
  });

  it("rejects tampered tokens", () => {
    const { token } = issuePreviewGateToken(secret);
    expect(verifyPreviewGateToken(`${token}x`, secret)).toBe(false);
  });

  it("rejects expired tokens", () => {
    const past = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const { token } = issuePreviewGateToken(secret, past);
    expect(verifyPreviewGateToken(token, secret, Date.now())).toBe(false);
  });
});

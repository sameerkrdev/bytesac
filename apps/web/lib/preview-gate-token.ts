import { createHmac, timingSafeEqual } from "node:crypto";

/** Same verifier as the API (shared secret in PREVIEW_GATE_JWT_SECRET). */
export function verifyPreviewGateToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token || !secret) return false;
  const i = token.lastIndexOf(".");
  if (i <= 0) return false;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  try {
    const a = Buffer.from(sig, "base64url");
    const b = Buffer.from(expected, "base64url");
    if (a.length !== b.length) return false;
    if (!timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  let exp: number;
  try {
    exp = (JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: number }).exp ?? 0;
  } catch {
    return false;
  }
  return exp > Math.floor(now / 1000);
}

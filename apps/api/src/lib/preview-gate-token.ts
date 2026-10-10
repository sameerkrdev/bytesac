import { createHmac, timingSafeEqual } from "node:crypto";

const PREVIEW_TTL_SEC = 7 * 24 * 60 * 60;

/** HMAC-signed token: `<base64url(payload)>.<base64url(sig)>`, payload `{ exp: unixSeconds }`. */
export function issuePreviewGateToken(secret: string, now = Date.now()): { token: string; expiresAt: Date } {
  const exp = Math.floor(now / 1000) + PREVIEW_TTL_SEC;
  const body = Buffer.from(JSON.stringify({ exp }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return { token: `${body}.${sig}`, expiresAt: new Date(exp * 1000) };
}

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

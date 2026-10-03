import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export const OTP_TTL = "10 minutes";
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SEC = 60;

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(secret: string, verificationId: string, code: string): string {
  return createHmac("sha256", secret).update(`${verificationId}:${code}`).digest("hex");
}

export function otpMatches(secret: string, verificationId: string, code: string, hash: string): boolean {
  const a = Buffer.from(hashOtp(secret, verificationId, code), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

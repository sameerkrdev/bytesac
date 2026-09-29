import createHttpError from "http-errors";
import twilio from "twilio";
import { env } from "../env";

const verify = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN).verify.v2.services(env.TWILIO_VERIFY_SERVICE_SID);

/** Twilio error codes: https://www.twilio.com/docs/api/errors */
const NOT_FOUND = 20404; // verification expired, already approved or canceled
const TOO_MANY_REQUESTS = 20429; // account concurrency limit; safe to retry after backing off
const MAX_CHECK_ATTEMPTS = 60202;
const MAX_SEND_ATTEMPTS = 60203; // lifts when the verification expires (about 10 minutes)

const errorOf = (err: unknown) => err as { status?: number; code?: number } | null | undefined;
const isRateLimit = (e: ReturnType<typeof errorOf>) => e?.status === 429 || e?.code === TOO_MANY_REQUESTS;
const rateLimited = (retryAfterSec: number, code: "RATE_LIMITED" | "OTP_COOLDOWN" = "RATE_LIMITED") =>
  createHttpError(429, "Too many requests. Try again later.", { code, headers: { "retry-after": String(retryAfterSec) } });

/** Starts an SMS verification and returns Twilio's verification SID. Create is not idempotent, so it is never retried. */
export async function startSmsVerification(to: string): Promise<string> {
  try {
    return (await verify.verifications.create({ to, channel: "sms" })).sid;
  } catch (err) {
    const e = errorOf(err);
    if (e?.code === MAX_SEND_ATTEMPTS) throw rateLimited(600, "OTP_COOLDOWN");
    if (isRateLimit(e)) throw rateLimited(60);
    throw createHttpError(503, "We couldn't send the code. Try again shortly.", { code: "OTP_DELIVERY_FAILED", cause: err });
  }
}

/** True when the code is approved; false when it is wrong, expired or out of attempts. */
export async function checkSmsVerification(to: string, code: string): Promise<boolean> {
  try {
    return (await verify.verificationChecks.create({ to, code })).status === "approved";
  } catch (err) {
    const e = errorOf(err);
    if (e?.status === 404 || e?.code === NOT_FOUND || e?.code === MAX_CHECK_ATTEMPTS) return false;
    if (isRateLimit(e)) throw rateLimited(60);
    throw createHttpError(503, "We couldn't check the code. Try again shortly.", { code: "OTP_DELIVERY_FAILED", cause: err });
  }
}

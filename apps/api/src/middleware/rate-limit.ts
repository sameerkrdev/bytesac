import createHttpError from "http-errors";
import { Redis } from "ioredis";
import { RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import { env } from "../env";

export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

const limiter = (keyPrefix: string, points: number, duration: number) => new RateLimiterRedis({ storeClient: redis, keyPrefix, points, duration });

/** Fixed windows: `points` per `duration` seconds. */
export const limits = {
  challengeIp: limiter("challenge:ip", 20, 60),
  challengeAddress: limiter("challenge:addr", 10, 60),
  verifyIp: limiter("verify:ip", 30, 60),
  otpUser: limiter("otp:user", 5, 3600),
  otpDestinationHour: limiter("otp:dest:h", 3, 3600),
  otpDestinationDay: limiter("otp:dest:d", 10, 86_400),
  otpIp: limiter("otp:ip", 10, 3600),
  otpGlobalEmail: limiter("otp:global:email", 1000, 60),
  otpGlobalSms: limiter("otp:global:sms", 200, 60),
};

/** Takes one point for `key`; throws 429 RATE_LIMITED past the limit. Returns a function that gives the point back. */
export async function consume(rateLimiter: RateLimiterRedis, key: string): Promise<() => Promise<unknown>> {
  try {
    await rateLimiter.consume(key);
  } catch (err) {
    if (!(err instanceof RateLimiterRes)) throw err;
    throw createHttpError(429, "Too many requests. Try again later.", {
      code: "RATE_LIMITED",
      headers: { "retry-after": String(Math.max(1, Math.ceil(err.msBeforeNext / 1000))) },
    });
  }
  return () => rateLimiter.reward(key);
}

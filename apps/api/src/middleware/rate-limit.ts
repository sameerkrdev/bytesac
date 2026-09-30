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
  appCreateIp: limiter("app:create:ip", 5, 3600),
  appCreateEmail: limiter("app:create:email", 3, 86_400),
  appResendEmail: limiter("app:resend:email", 5, 3600),
  appTokenIp: limiter("app:token:ip", 30, 60),
  opsUser: limiter("ops:user", 120, 60),
  ownerMutationUser: limiter("org:mutate:user", 60, 60),
  documentPresignOrg: limiter("org:presign:org", 30, 3600),
  inviteOrg: limiter("org:invite:org", 20, 3600),
  memberDocumentPresign: limiter("member:presign:membership", 30, 3600),
  assetVerifyUser: limiter("asset:verify:user", 30, 3600),
  publicProfileIp: limiter("public:org:ip", 60, 60),
};

/** Takes one point for `key`; throws 429 RATE_LIMITED past the limit. Returns a function that gives the point back. */
export async function consume(rateLimiter: RateLimiterRedis, key: string): Promise<() => Promise<unknown>> {
  try {
    await rateLimiter.consume(key);
  } catch (err) {
    if (!(err instanceof RateLimiterRes)) throw err;
    throw createHttpError("Too many requests. Try again later.", {
      code: "RATE_LIMITED",
      headers: { "retry-after": String(Math.max(1, Math.ceil(err.msBeforeNext / 1000))) },
    });
  }
  // Skip when the window already expired: reward() would recreate the key at -1 and grant a bonus point.
  return async () => { if (await rateLimiter.get(key)) await rateLimiter.reward(key); };
}

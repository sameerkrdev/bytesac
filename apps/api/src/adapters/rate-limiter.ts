import type { Redis } from "ioredis";
import { DomainError } from "../shared/errors.js";

export interface RateLimitResult { allowed: boolean; retryAfterSec: number; bucketKey: string }
export interface RateLimiter {
  consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
  refund(bucketKey: string): Promise<void>;
}

export class RedisRateLimiter implements RateLimiter {
  constructor(private readonly redis: Redis) {}

  async consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(nowSec / windowSec);
    const bucketKey = `rl:${key}:${windowSec}:${bucket}`;
    const [[, count]] = (await this.redis.multi().incr(bucketKey).expire(bucketKey, windowSec + 1).exec()) as [[null, number], [null, number]];
    const retryAfterSec = (bucket + 1) * windowSec - nowSec;
    return { allowed: count <= limit, retryAfterSec: count <= limit ? 0 : Math.max(1, retryAfterSec), bucketKey };
  }

  async refund(bucketKey: string): Promise<void> {
    await this.redis.decr(bucketKey);
  }
}

export async function enforceRateLimit(limiter: RateLimiter, key: string, limit: number, windowSec: number): Promise<RateLimitResult> {
  const r = await limiter.consume(key, limit, windowSec);
  if (!r.allowed) throw new DomainError("RATE_LIMITED", "Too many requests. Try again later.", { retryAfterSec: r.retryAfterSec });
  return r;
}

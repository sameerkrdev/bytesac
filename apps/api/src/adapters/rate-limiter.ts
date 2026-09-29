export interface RateLimitResult { allowed: boolean; retryAfterSec: number; bucketKey: string }
export interface RateLimiter {
  consume(key: string, limit: number, windowSec: number): Promise<RateLimitResult>;
  refund(bucketKey: string): Promise<void>;
}

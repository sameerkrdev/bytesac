import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RedisRateLimiter } from "../../src/adapters/rate-limiter.js";

const redis = new Redis(process.env.TEST_REDIS_URL ?? "");
afterAll(() => redis.quit());
beforeEach(async () => { await redis.flushdb(); });

describe("RedisRateLimiter", () => {
  it("allows up to the limit then blocks with retry-after", async () => {
    const rl = new RedisRateLimiter(redis);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await rl.consume("t:k", 3, 60));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]!.retryAfterSec).toBeGreaterThan(0);
    expect(results[3]!.retryAfterSec).toBeLessThanOrEqual(60);
  });
  it("refund returns capacity", async () => {
    const rl = new RedisRateLimiter(redis);
    const a = await rl.consume("t:r", 1, 60);
    await rl.refund(a.bucketKey);
    expect((await rl.consume("t:r", 1, 60)).allowed).toBe(true);
  });
});

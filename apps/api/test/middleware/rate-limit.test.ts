import { beforeEach, describe, expect, it } from "vitest";
import { consume, limits, redis } from "../../src/middleware/rate-limit";

beforeEach(async () => { await redis.flushdb(); });

describe("consume", () => {
  it("allows up to the limit then rejects with 429 RATE_LIMITED and Retry-After", async () => {
    const results: unknown[] = [];
    for (let i = 0; i < 31; i++) results.push(await consume(limits.verifyIp, "t:k").catch((e: unknown) => e)); // limit is 30 per 60 s
    expect(results.slice(0, 30).every((r) => typeof r === "function")).toBe(true);
    expect(results[30]).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    const retryAfter = Number((results[30] as { headers: Record<string, string> }).headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });
  it("the returned function gives the point back", async () => {
    const refund = await consume(limits.otpUser, "u1");
    expect((await limits.otpUser.get("u1"))?.consumedPoints).toBe(1);
    await refund();
    expect((await limits.otpUser.get("u1"))?.consumedPoints).toBe(0);
  });
});

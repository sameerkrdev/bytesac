import { describe, expect, it } from "vitest";
import { redisOptionsFromUrl } from "../../src/config/redis-options.js";

describe("redisOptionsFromUrl", () => {
  it("strips IPv6 brackets", () => {
    expect(redisOptionsFromUrl("redis://[::1]:6379/2")).toMatchObject({ host: "::1", port: 6379, db: 2 });
  });
  it("parses a plain host", () => {
    expect(redisOptionsFromUrl("redis://localhost:63799/1")).toMatchObject({ host: "localhost", port: 63799, db: 1 });
  });
});

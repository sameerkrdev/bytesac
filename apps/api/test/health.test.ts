import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";

describe("GET /health", () => {
  it("reports ok when db and redis are up", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });
  it("reports 503 when a dependency is down", async () => {
    vi.spyOn(redis, "ping").mockRejectedValueOnce(new Error("down"));
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.redis).toBe("down");
  });
});

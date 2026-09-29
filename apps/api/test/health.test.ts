import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app.js";

describe("GET /health", () => {
  it("reports ok when db and redis are up", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });
  it("reports 503 when a dependency is down", async () => {
    const { app } = buildTestApp({ health: { db: async () => undefined, redis: async () => { throw new Error("down"); } } });
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.redis).toBe("down");
  });
});

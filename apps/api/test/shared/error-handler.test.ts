import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DomainError } from "../../src/shared/errors.js";
import { errorHandler } from "../../src/shared/error-handler.js";
import { createLogger } from "../../src/shared/logger.js";
import { requestContext } from "../../src/shared/request-context.js";
import { parseOrThrow } from "../../src/shared/validate.js";

function appThrowing(err: unknown) {
  const app = express();
  app.use(requestContext);
  app.get("/x", () => { throw err; });
  app.use(errorHandler(createLogger("silent")));
  return app;
}

describe("errorHandler", () => {
  it("maps DomainError to code/status and Retry-After", async () => {
    const res = await request(appThrowing(new DomainError("RATE_LIMITED", "Too many requests", { retryAfterSec: 7 }))).get("/x");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("7");
    expect(res.body).toEqual({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("maps validation errors", async () => {
    let caught: unknown;
    try { parseOrThrow(z.object({ a: z.string() }), {}); } catch (e) { caught = e; }
    const res = await request(appThrowing(caught)).get("/x");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
  it("hides unknown errors", async () => {
    const res = await request(appThrowing(new Error("db password is hunter2"))).get("/x");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "INTERNAL", message: "Something went wrong" } });
  });
  it("maps malformed JSON bodies to VALIDATION_FAILED", async () => {
    const app = express();
    app.use(requestContext);
    app.use(express.json());
    app.post("/y", (_req, res) => { res.json({}); });
    app.use(errorHandler(createLogger("silent")));
    const res = await request(app).post("/y").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("errorHandler logging", () => {
  it("does not log SQL params or query from driver errors", async () => {
    const lines: string[] = [];
    const logger = createLogger("info", { write: (msg: string) => { lines.push(msg); } });
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const err = Object.assign(new Error('Failed query: insert into "contacts" values ($1) params: alice@example.com', { cause }), {
      name: "DrizzleQueryError",
      query: 'insert into "contacts" values ($1)',
      params: ["alice@example.com"],
    });
    const app = express();
    app.use(requestContext);
    app.get("/x", () => { throw err; });
    app.use(errorHandler(logger));
    const res = await request(app).get("/x");
    expect(res.status).toBe(500);
    const out = lines.join("");
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("insert into");
    expect(out).not.toContain("params");
    expect(out).toContain("23505");
    expect(out).toContain("DrizzleQueryError");
  });
});

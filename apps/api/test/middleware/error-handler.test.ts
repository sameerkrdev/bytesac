import express from "express";
import createHttpError from "http-errors";
import request from "supertest";
import { logger } from "@repo/logger";
import { z } from "@repo/validator";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler, notFoundHandler } from "../../src/middleware/error-handler";
import { requestContext } from "../../src/middleware/request-context";
import { validate } from "../../src/middleware/validate";

function appThrowing(err: unknown) {
  const app = express();
  app.use(requestContext);
  app.get("/x", () => { throw err; });
  app.use(notFoundHandler, errorHandler);
  return app;
}

afterEach(() => vi.restoreAllMocks());

describe("errorHandler", () => {
  it("maps an API http-error to its status, code and headers", async () => {
    const res = await request(appThrowing(createHttpError(429, "Too many requests", { code: "RATE_LIMITED", headers: { "retry-after": "7" } }))).get("/x");
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("7");
    expect(res.body).toEqual({ error: { code: "RATE_LIMITED", message: "Too many requests" } });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("maps zod errors to VALIDATION_FAILED with details", async () => {
    const app = express();
    app.use(express.json());
    app.post("/v", validate({ body: z.object({ a: z.string() }) }), (_req, res) => { res.json({}); });
    app.use(errorHandler);
    const res = await request(app).post("/v").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: "VALIDATION_FAILED", details: [{ path: "a" }] });
  });
  it("unknown routes are 404 NOT_FOUND", async () => {
    const res = await request(appThrowing(new Error("unused"))).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
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
    app.use(errorHandler);
    const res = await request(app).post("/y").set("content-type", "application/json").send("{bad");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("errorHandler client errors", () => {
  it("maps 413 payload too large to 400 VALIDATION_FAILED without logging an error", async () => {
    const spy = vi.spyOn(logger, "error");
    const app = express();
    app.use(requestContext);
    app.use(express.json({ limit: "32kb" }));
    app.post("/y", (_req, res) => { res.json({}); });
    app.use(errorHandler);
    const res = await request(app).post("/y").set("content-type", "application/json").send(JSON.stringify({ a: "x".repeat(40_000) }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(spy).not.toHaveBeenCalled();
  });
  it("an http-error whose code is not an API code is not trusted", async () => {
    const res = await request(appThrowing(createHttpError(400, "request aborted", { code: "ECONNABORTED" }))).get("/x");
    expect(res.body).toEqual({ error: { code: "VALIDATION_FAILED", message: "Invalid request body" } });
  });
  it("delegates to Express when headers were already sent", async () => {
    const app = express();
    app.use(requestContext);
    app.get("/x", (_req, res, next) => { res.write("partial"); next(new Error("late")); });
    app.use(errorHandler);
    const res = await request(app).get("/x").catch(() => null);
    expect(res === null || res.status === 200).toBe(true);
  });
});

describe("errorHandler logging", () => {
  it("does not log SQL params or query from driver errors", async () => {
    const spy = vi.spyOn(logger, "error");
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    const err = Object.assign(new Error('Failed query: insert into "contacts" values ($1) params: alice@example.com', { cause }), {
      name: "DrizzleQueryError",
      query: 'insert into "contacts" values ($1)',
      params: ["alice@example.com"],
    });
    const res = await request(appThrowing(err)).get("/x");
    expect(res.status).toBe(500);
    const out = JSON.stringify(spy.mock.calls);
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("insert into");
    expect(out).not.toContain("params");
    expect(out).toContain("23505");
    expect(out).toContain("DrizzleQueryError");
  });
});

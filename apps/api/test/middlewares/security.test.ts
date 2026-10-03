import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { csrfGuard, noCors, rejectDualAuth } from "@/middlewares/security.middleware";
import { errorHandler } from "@/middlewares/error-handler.middleware";
import { requestContext } from "@/middlewares/request-context.middleware";

const ORIGIN = "http://localhost:3000";
function app() {
  const a = express();
  a.use(requestContext, express.json(), cookieParser(), noCors, rejectDualAuth, csrfGuard);
  a.post("/v1/auth/verify", (_req, res) => { res.json({ ok: true }); });
  a.post("/v1/auth/logout", (_req, res) => { res.json({ ok: true }); });
  a.get("/v1/me", (_req, res) => { res.json({ ok: true }); });
  a.use(errorHandler);
  return a;
}

describe("security middleware", () => {
  it("never sends CORS headers and rejects preflight", async () => {
    const pre = await request(app()).options("/v1/me").set("Origin", "https://evil.test").set("Access-Control-Request-Method", "POST");
    expect(pre.status).toBe(403);
    const get = await request(app()).get("/v1/me").set("Origin", "https://evil.test");
    expect(get.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("cookie mutation without Origin -> 403", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Cookie", "bx_session=t").set("X-Requested-With", "bytesac");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_REJECTED");
  });
  it("cookie mutation from foreign Origin -> 403", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Cookie", "bx_session=t").set("Origin", "https://evil.test").set("X-Requested-With", "bytesac");
    expect(res.status).toBe(403);
  });
  it("cookie mutation without custom header -> 403", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Cookie", "bx_session=t").set("Origin", ORIGIN);
    expect(res.status).toBe(403);
  });
  it("cookie mutation with allowed Origin and header passes", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Cookie", "bx_session=t").set("Origin", ORIGIN).set("X-Requested-With", "bytesac");
    expect(res.status).toBe(200);
  });
  it("web sign-in without cookie still requires Origin (login CSRF)", async () => {
    const res = await request(app()).post("/v1/auth/verify").send({ client: "web" });
    expect(res.status).toBe(403);
  });
  it("web sign-in with trailing slash or different case still requires Origin", async () => {
    const strict = await request(app()).post("/v1/auth/verify/").send({ client: "web" });
    expect(strict.status).toBe(403);
    const cased = await request(app()).post("/v1/Auth/Verify").send({ client: "web" });
    expect(cased.status).toBe(403);
  });
  it("mobile sign-in without Origin is allowed", async () => {
    const res = await request(app()).post("/v1/auth/verify").send({ client: "mobile" });
    expect(res.status).toBe(200);
  });
  it("bearer mutation is exempt", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Authorization", "Bearer t");
    expect(res.status).toBe(200);
  });
  it("cookie and bearer together -> 400", async () => {
    const res = await request(app()).post("/v1/auth/logout").set("Authorization", "Bearer t").set("Cookie", "bx_session=t");
    expect(res.status).toBe(400);
  });
  it("GET with cookie is not CSRF-checked", async () => {
    const res = await request(app()).get("/v1/me").set("Cookie", "bx_session=t");
    expect(res.status).toBe(200);
  });
  it("challenge without cookie: browser needs Origin, mobile sends X-Client", async () => {
    const a = express();
    a.use(requestContext, express.json(), cookieParser(), csrfGuard);
    a.post("/v1/auth/challenge", (_req, res) => { res.json({ ok: true }); });
    a.use(errorHandler);
    expect((await request(a).post("/v1/auth/challenge").send({})).status).toBe(403);
    expect((await request(a).post("/v1/auth/challenge").set("X-Client", "mobile").send({})).status).toBe(200);
    expect((await request(a).post("/v1/auth/challenge").set("Origin", ORIGIN).set("X-Requested-With", "bytesac").send({})).status).toBe(200);
  });
});

describe("public application forms", () => {
  it("cookie-less browser POST needs Origin; a bearer request is exempt", async () => {
    const a = express();
    a.use(requestContext, express.json(), cookieParser(), csrfGuard);
    a.post("/v1/manager-applications", (_req, res) => { res.json({ ok: true }); });
    a.use(errorHandler);
    expect((await request(a).post("/v1/manager-applications").send({})).status).toBe(403);
    expect((await request(a).post("/v1/manager-applications").set("Origin", ORIGIN).set("X-Requested-With", "bytesac").send({})).status).toBe(200);
    expect((await request(a).post("/v1/manager-applications").set("Authorization", "Bearer t").send({})).status).toBe(200);
  });
});

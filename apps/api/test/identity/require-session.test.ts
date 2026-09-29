import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { db } from "@repo/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/env";
import { optionalSession, requireSession } from "../../src/middleware/auth";
import { errorHandler } from "../../src/middleware/error-handler";
import { requestContext } from "../../src/middleware/request-context";
import { createSession, revokeSession } from "../../src/services/sessions";
import { createUserWithWallet } from "../../src/services/wallets";
import { adminSql, resetDb } from "../helpers/db";

const meta = { requestId: "r", ip: "", ipPrefix: null, userAgent: null };
const pepper = env.SESSION_TOKEN_PEPPER;
beforeEach(resetDb);

function probe() {
  const app = express();
  app.use(requestContext, cookieParser());
  app.get("/p", requireSession, (req, res) => { res.json(req.auth); });
  app.get("/o", optionalSession, (req, res) => { res.json({ auth: req.auth ?? null }); });
  app.use(errorHandler);
  return app;
}

async function issue(client: "web" | "mobile") {
  const userId = await db.transaction((tx) => createUserWithWallet(tx, { rows: [] }));
  return { userId, s: await createSession(db, { userId, client, pepper, meta }) };
}

describe("requireSession", () => {
  it("accepts cookie and bearer", async () => {
    const app = probe();
    const { s, userId } = await issue("web");
    const a = await request(app).get("/p").set("Cookie", `bx_session=${s.token}`);
    expect(a.body).toMatchObject({ userId, sessionId: s.id, transport: "cookie", client: "web" });
    const m = await issue("mobile");
    const b = await request(app).get("/p").set("Authorization", `Bearer ${m.s.token}`);
    expect(b.body).toMatchObject({ userId: m.userId, transport: "bearer", client: "mobile" });
  });
  it("missing, unknown, revoked, idle-expired, absolute-expired → 401 SESSION_EXPIRED", async () => {
    const app = probe();
    expect((await request(app).get("/p")).body.error.code).toBe("SESSION_EXPIRED");
    expect((await request(app).get("/p").set("Authorization", "Bearer nope")).status).toBe(401);
    const r = await issue("web");
    await revokeSession(db, r.s.id, "logout");
    expect((await request(app).get("/p").set("Cookie", `bx_session=${r.s.token}`)).status).toBe(401);
    const i = await issue("web");
    await adminSql`UPDATE app.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = ${i.s.id}`;
    expect((await request(app).get("/p").set("Cookie", `bx_session=${i.s.token}`)).status).toBe(401);
    const x = await issue("web");
    await adminSql`UPDATE app.sessions SET absolute_expires_at = now() - interval '1 second' WHERE id = ${x.s.id}`;
    expect((await request(app).get("/p").set("Cookie", `bx_session=${x.s.token}`)).status).toBe(401);
  });
  it("suspended user → 401 USER_NOT_ACTIVE", async () => {
    const app = probe();
    const { s, userId } = await issue("web");
    await adminSql`UPDATE app.users SET status = 'suspended' WHERE id = ${userId}`;
    const res = await request(app).get("/p").set("Cookie", `bx_session=${s.token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("USER_NOT_ACTIVE");
  });
  it("concurrent requests during renewal all succeed with the same token", async () => {
    const app = probe();
    const { s } = await issue("mobile");
    await adminSql`UPDATE app.sessions SET last_seen_at = now() - interval '10 minutes' WHERE id = ${s.id}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => request(app).get("/p").set("Authorization", `Bearer ${s.token}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});

describe("optionalSession", () => {
  it("treats invalid sessions as anonymous but propagates infrastructure errors", async () => {
    const app = probe();
    const ok = await request(app).get("/o").set("Authorization", "Bearer nope");
    expect(ok.status).toBe(200);
    expect(ok.body.auth).toBeNull();
    vi.spyOn(db, "select").mockImplementationOnce(() => { throw new Error("db down"); });
    const res = await request(app).get("/o").set("Authorization", "Bearer nope");
    expect(res.status).toBe(500);
  });
});

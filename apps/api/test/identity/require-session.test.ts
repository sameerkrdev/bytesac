import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "../../src/db/schema/index.js";
import { rotateSession } from "../../src/modules/identity/application/session-service.js";
import { optionalSession, requireSession } from "../../src/modules/identity/http/require-session.js";
import { sessionRepo } from "../../src/modules/identity/infra/session-repository.js";
import { walletRepo } from "../../src/modules/identity/infra/wallet-repository.js";
import { errorHandler } from "../../src/shared/error-handler.js";
import { createLogger } from "../../src/shared/logger.js";
import { requestContext } from "../../src/shared/request-context.js";
import { buildTestApp } from "../helpers/app.js";
import { adminSql, resetDb, testDb } from "../helpers/db.js";

const db = testDb.db;
const meta = { requestId: "r", ip: "", ipPrefix: null, userAgent: null };
beforeEach(resetDb);

function probe() {
  const { deps } = buildTestApp();
  const app = express();
  app.use(requestContext, cookieParser());
  app.get("/p", requireSession(deps), (req, res) => { res.json(req.auth); });
  app.use(errorHandler(createLogger("silent")));
  return { app, pepper: deps.env.SESSION_TOKEN_PEPPER };
}

async function issue(client: "web" | "mobile", pepper: string) {
  const { userId } = await db.transaction((tx) => walletRepo.createUserWithWallet(tx, { rows: [] }));
  return { userId, s: await sessionRepo.create(db, { userId, client, pepper, meta }) };
}

describe("requireSession", () => {
  it("accepts cookie and bearer", async () => {
    const { app, pepper } = probe();
    const { s, userId } = await issue("web", pepper);
    const a = await request(app).get("/p").set("Cookie", `bx_session=${s.token}`);
    expect(a.body).toMatchObject({ userId, sessionId: s.id, transport: "cookie", client: "web" });
    const m = await issue("mobile", pepper);
    const b = await request(app).get("/p").set("Authorization", `Bearer ${m.s.token}`);
    expect(b.body).toMatchObject({ userId: m.userId, transport: "bearer", client: "mobile" });
  });
  it("missing, unknown, revoked, idle-expired, absolute-expired → 401 SESSION_EXPIRED", async () => {
    const { app, pepper } = probe();
    expect((await request(app).get("/p")).body.error.code).toBe("SESSION_EXPIRED");
    expect((await request(app).get("/p").set("Authorization", "Bearer nope")).status).toBe(401);
    const r = await issue("web", pepper);
    await sessionRepo.revoke(db, r.s.id, "logout");
    expect((await request(app).get("/p").set("Cookie", `bx_session=${r.s.token}`)).status).toBe(401);
    const i = await issue("web", pepper);
    await adminSql`UPDATE app.sessions SET idle_expires_at = now() - interval '1 second' WHERE id = ${i.s.id}`;
    expect((await request(app).get("/p").set("Cookie", `bx_session=${i.s.token}`)).status).toBe(401);
    const x = await issue("web", pepper);
    await adminSql`UPDATE app.sessions SET absolute_expires_at = now() - interval '1 second' WHERE id = ${x.s.id}`;
    expect((await request(app).get("/p").set("Cookie", `bx_session=${x.s.token}`)).status).toBe(401);
  });
  it("suspended user → 401 USER_NOT_ACTIVE", async () => {
    const { app, pepper } = probe();
    const { s, userId } = await issue("web", pepper);
    await adminSql`UPDATE app.users SET status = 'suspended' WHERE id = ${userId}`;
    const res = await request(app).get("/p").set("Cookie", `bx_session=${s.token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("USER_NOT_ACTIVE");
  });
  it("concurrent requests during renewal all succeed with the same token", async () => {
    const { app, pepper } = probe();
    const { s } = await issue("mobile", pepper);
    await adminSql`UPDATE app.sessions SET last_seen_at = now() - interval '10 minutes' WHERE id = ${s.id}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => request(app).get("/p").set("Authorization", `Bearer ${s.token}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
  });
});

describe("optionalSession", () => {
  it("treats invalid sessions as anonymous but propagates infrastructure errors", async () => {
    const { deps } = buildTestApp();
    const build = (d: typeof deps) => {
      const app = express();
      app.use(requestContext, cookieParser());
      app.get("/o", optionalSession(d), (req, res) => { res.json({ auth: req.auth ?? null }); });
      app.use(errorHandler(createLogger("silent")));
      return app;
    };
    const ok = await request(build(deps)).get("/o").set("Authorization", "Bearer nope");
    expect(ok.status).toBe(200);
    expect(ok.body.auth).toBeNull();
    const brokenDb = { select: () => { throw new Error("db down"); } } as unknown as typeof deps.db;
    const res = await request(build({ ...deps, db: brokenDb })).get("/o").set("Authorization", "Bearer nope");
    expect(res.status).toBe(500);
  });
});

describe("rotateSession", () => {
  it("refuses to rotate an already revoked session and issues nothing", async () => {
    const { deps } = buildTestApp();
    const pepper = deps.env.SESSION_TOKEN_PEPPER;
    const { s, userId } = await issue("web", pepper);
    await sessionRepo.revoke(db, s.id, "logout");
    await expect(db.transaction((tx) => rotateSession(tx, { userId, oldSessionId: s.id, client: "web", pepper, meta })))
      .rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(1);
  });
  it("rotates an active session and links the replacement", async () => {
    const { deps } = buildTestApp();
    const pepper = deps.env.SESSION_TOKEN_PEPPER;
    const { s, userId } = await issue("web", pepper);
    const next = await db.transaction((tx) => rotateSession(tx, { userId, oldSessionId: s.id, client: "web", pepper, meta }));
    const [old] = await db.select().from(sessions).where(eq(sessions.id, s.id));
    expect(old).toMatchObject({ revokeReason: "rotated", replacedBySessionId: next.id });
  });
});

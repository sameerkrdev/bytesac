import { eq } from "drizzle-orm";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents } from "@repo/db";
import { app } from "@/app";
import { challengeFor, signIn, webHeaders } from "../../helpers/auth";
import { resetDb, testDb } from "../../helpers/db";
import { newEvmWallet } from "../../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

describe("session revoke and sign-in client", () => {
  it("re-revoking an already revoked session is a no-op and writes no second audit row", async () => {
    const w = newEvmWallet();
    const a = await signIn(app, w, "base");
    const b = await signIn(app, w, "base");
    const list = await request(app).get("/v1/me/sessions").set(webHeaders(a.cookie));
    const other = list.body.sessions.find((s: { current: boolean }) => !s.current);
    for (let i = 0; i < 2; i++) {
      expect((await request(app).delete(`/v1/me/sessions/${other.id}`).set(webHeaders(a.cookie))).status).toBe(204);
    }
    expect(b.cookie).toBeDefined();
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "session.revoked"))).toHaveLength(1);
  });

  it("sign_in with an existing web session issues a session for body.client and keeps the old one", async () => {
    const w = newEvmWallet();
    const web = await signIn(app, w, "base");
    const ch = await challengeFor(app, { purpose: "sign_in", chain: "base", address: w.address }, { ...webHeaders(web.cookie), "X-Client": "mobile" });
    const res = await request(app).post("/v1/auth/verify").set(webHeaders(web.cookie))
      .send({ challengeId: ch.body.challengeId, signature: await w.sign(ch.body.message), client: "mobile" });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.headers["set-cookie"]).toBeUndefined();
    const sessions = await request(app).get("/v1/me/sessions").set({ Authorization: `Bearer ${res.body.token}` });
    expect(sessions.body.sessions.map((s: { client: string }) => s.client).sort()).toEqual(["mobile", "web"]);
    expect((await request(app).get("/v1/me").set(webHeaders(web.cookie))).status).toBe(200);
  });
});

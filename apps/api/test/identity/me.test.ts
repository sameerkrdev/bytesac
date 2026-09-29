import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { meResponseSchema, sessionsResponseSchema } from "@repo/validator";
import { app } from "../../src/app";
import { signIn, webHeaders } from "../helpers/auth";
import { resetDb } from "../helpers/db";
import { newEvmWallet, newSolanaWallet } from "../helpers/wallets";

beforeEach(resetDb);

describe("/v1/me", () => {
  it("returns the user, wallet addresses and contacts in contract shape", async () => {
    const s = await signIn(app, newEvmWallet(), "base");
    const res = await request(app).get("/v1/me").set("Cookie", s.cookie!);
    expect(res.status).toBe(200);
    const me = meResponseSchema.parse(res.body);
    expect(me.user.id).toBe(s.userId);
    expect(me.wallet.addresses).toHaveLength(4);
    expect(me.contacts).toEqual([]);
  });

  it("sessions list marks current; revoke own; other user's session → 404", async () => {
    const w = newEvmWallet();
    const web = await signIn(app, w, "base");
    const mob = await signIn(app, w, "base", "mobile");
    const other = await signIn(app, newSolanaWallet(), "solana", "mobile");
    const list = sessionsResponseSchema.parse((await request(app).get("/v1/me/sessions").set("Cookie", web.cookie!)).body);
    expect(list.sessions).toHaveLength(2);
    expect(list.sessions.filter((x) => x.current)).toHaveLength(1);
    const mobileId = list.sessions.find((x) => x.client === "mobile")!.id;
    const otherList = sessionsResponseSchema.parse((await request(app).get("/v1/me/sessions").set("Authorization", `Bearer ${other.token}`)).body);
    expect((await request(app).delete(`/v1/me/sessions/${otherList.sessions[0]!.id}`).set(webHeaders(web.cookie))).status).toBe(404);
    expect((await request(app).delete(`/v1/me/sessions/${mobileId}`).set(webHeaders(web.cookie))).status).toBe(204);
    expect((await request(app).get("/v1/me").set("Authorization", `Bearer ${mob.token}`)).status).toBe(401);
  });

  it("logout revokes current and clears cookie; logout-all revokes every session", async () => {
    const w = newEvmWallet();
    const a = await signIn(app, w, "base");
    const out = await request(app).post("/v1/auth/logout").set(webHeaders(a.cookie));
    expect(out.status).toBe(204);
    expect(String(out.headers["set-cookie"])).toMatch(/bx_session=;/);
    expect((await request(app).get("/v1/me").set("Cookie", a.cookie!)).status).toBe(401);
    const b = await signIn(app, w, "base");
    const c = await signIn(app, w, "base", "mobile");
    expect((await request(app).post("/v1/auth/logout-all").set("Authorization", `Bearer ${c.token}`)).status).toBe(204);
    expect((await request(app).get("/v1/me").set("Cookie", b.cookie!)).status).toBe(401);
  });

  it("logout requires CSRF headers on the cookie path", async () => {
    const a = await signIn(app, newEvmWallet(), "base");
    expect((await request(app).post("/v1/auth/logout").set("Cookie", a.cookie!)).status).toBe(403);
  });
});

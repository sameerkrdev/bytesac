import { createHash } from "node:crypto";
import request from "supertest";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, contactVerifications, contacts } from "@repo/db";
import { app } from "../../src/app";
import { fakes } from "../helpers/fakes";
import { limits } from "../../src/middleware/rate-limit";
import { signIn, webHeaders } from "../helpers/auth";
import { adminSql, resetDb, testDb } from "../helpers/db";
import { newEvmWallet } from "../helpers/wallets";

const db = testDb.db;
beforeEach(resetDb);

async function setup() {
  const s = await signIn(app, newEvmWallet(), "base");
  const h = webHeaders(s.cookie);
  return { app, fakes, s, h };
}

describe("contacts", () => {
  it("email: add → code emailed → verify", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: " Alice@Example.com " });
    expect(add.status).toBe(201);
    expect(add.body.contact).toMatchObject({ type: "email", value: "alice@example.com", status: "unverified" });
    const code = fakes.email.sent[0]!.code;
    const bad = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: code === "000000" ? "111111" : "000000" });
    expect(bad.body.error.code).toBe("OTP_INVALID");
    const ok = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe("verified");
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, "contact.verified"));
    expect(JSON.stringify(audit[0]!.metadata)).not.toContain("alice@example.com");
  });

  it("phone: Twilio Verify start/check with the stored destination", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "phone", value: "+1 415 555 2671" });
    expect(fakes.sms.started).toEqual(["+14155552671"]);
    expect((await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: "123456" })).body.status).toBe("verified");
  });

  it("phone: provider failure on check → 503 OTP_DELIVERY_FAILED, then retry succeeds", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "phone", value: "+1 415 555 2671" });
    fakes.sms.checkFail = true;
    const res = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: "123456" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("OTP_DELIVERY_FAILED");
    const [after] = await db.select().from(contactVerifications);
    expect(after!.attempts).toBe(0);
    fakes.sms.checkFail = false;
    expect((await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: "123456" })).body.status).toBe("verified");
  });

  it("phone without country code → 400 with clear message", async () => {
    const { app, h } = await setup();
    const res = await request(app).post("/v1/me/contacts").set(h).send({ type: "phone", value: "4155552671" });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/country code/);
  });

  it("5 wrong attempts → OTP_ATTEMPTS_EXCEEDED, then even the right code fails", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" });
    const code = fakes.email.sent[0]!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: wrong });
    const res = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code });
    expect(res.body.error.code).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  it("expired code → OTP_EXPIRED", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" });
    await adminSql`UPDATE app.contact_verifications SET expires_at = now() - interval '1 second'`;
    const res = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: fakes.email.sent[0]!.code });
    expect(res.body.error.code).toBe("OTP_EXPIRED");
  });

  it("replacing a contact supersedes old OTPs; old code cannot verify the new contact", async () => {
    const { app, fakes, h } = await setup();
    const first = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "old@b.co" });
    const oldCode = fakes.email.sent[0]!.code;
    const second = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "new@b.co" });
    expect((await request(app).post(`/v1/me/contacts/${first.body.contact.id}/verify`).set(h).send({ code: oldCode })).status).toBe(404);
    const newCode = fakes.email.sent[1]!.code;
    if (newCode !== oldCode) {
      expect((await request(app).post(`/v1/me/contacts/${second.body.contact.id}/verify`).set(h).send({ code: oldCode })).body.error.code).toBe("OTP_INVALID");
    }
    const rows = await db.select().from(contacts);
    expect(rows.map((r) => r.status).sort()).toEqual(["replaced", "unverified"]);
    expect((await db.select().from(contactVerifications)).map((v) => v.status).sort()).toEqual(["pending", "superseded"]);
  });

  it("resend: 60 s cooldown, then supersedes the previous code", async () => {
    const { app, fakes, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" });
    const early = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/resend`).set(h);
    expect(early.status).toBe(429);
    expect(early.body.error.code).toBe("OTP_COOLDOWN");
    await adminSql`UPDATE app.contact_verifications SET created_at = now() - interval '61 seconds'`;
    const again = await request(app).post(`/v1/me/contacts/${add.body.contact.id}/resend`).set(h);
    expect(again.status).toBe(200);
    const firstCode = fakes.email.sent[0]!.code;
    const secondCode = fakes.email.sent[1]!.code;
    if (firstCode !== secondCode) {
      expect((await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: firstCode })).body.error.code).toBe("OTP_INVALID");
    }
    expect((await request(app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(h).send({ code: secondCode })).status).toBe(200);
  });

  it("concurrent resends: one 200, one 429, never 500", async () => {
    const { app, h } = await setup();
    const add = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" });
    await adminSql`UPDATE app.contact_verifications SET created_at = now() - interval '61 seconds'`;
    const url = `/v1/me/contacts/${add.body.contact.id}/resend`;
    const [r1, r2] = await Promise.all([request(app).post(url).set(h), request(app).post(url).set(h)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 429]);
    const lost = r1.status === 429 ? r1 : r2;
    expect(lost.body.error.code).toBe("OTP_COOLDOWN");
    expect(Number(lost.headers["retry-after"])).toBeGreaterThan(0);
    expect((await db.select().from(contactVerifications)).filter((v) => v.status === "pending")).toHaveLength(1);
  });

  it("concurrent adds of the same type never 500 and leave one current contact", async () => {
    const { app, h } = await setup();
    const add = (v: string) => request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: v });
    const res = await Promise.all([add("a@b.co"), add("c@d.co"), add("e@f.co")]);
    for (const r of res) expect([201, 404, 429]).toContain(r.status);
    expect(res.some((r) => r.status === 201)).toBe(true);
    expect((await db.select().from(contacts)).filter((c) => c.status !== "replaced")).toHaveLength(1);
  });

  it("limits: per-destination and channel-wide limits reject; a failed delivery gives the points back", async () => {
    const { app, fakes, h, s } = await setup();
    const destinationHash = createHash("sha256").update("a@b.co").digest("hex").slice(0, 32);
    await limits.otpDestinationHour.block(destinationHash, 60);
    expect((await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "a@b.co" })).status).toBe(429);
    await limits.otpGlobalSms.block("sms", 60);
    const g = await request(app).post("/v1/me/contacts").set(h).send({ type: "phone", value: "+14155552671" });
    expect(g.status).toBe(503);
    expect(g.body.error.code).toBe("OTP_DELIVERY_FAILED");
    fakes.email.fail = true;
    const f = await request(app).post("/v1/me/contacts").set(h).send({ type: "email", value: "c@d.co" });
    expect(f.body.error.code).toBe("OTP_DELIVERY_FAILED");
    expect((await limits.otpUser.get(s.userId))?.consumedPoints ?? 0).toBe(0);
  });

  it("another user's contact → 404; cookie path requires CSRF headers", async () => {
    const a = await setup();
    const add = await request(a.app).post("/v1/me/contacts").set(a.h).send({ type: "email", value: "a@b.co" });
    const b = await signIn(a.app, newEvmWallet(), "base");
    expect((await request(a.app).post(`/v1/me/contacts/${add.body.contact.id}/verify`).set(webHeaders(b.cookie)).send({ code: "123456" })).status).toBe(404);
    expect((await request(a.app).post("/v1/me/contacts").set("Cookie", a.s.cookie!).send({ type: "email", value: "x@y.co" })).status).toBe(403);
  });
});

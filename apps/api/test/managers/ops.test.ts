import request from "supertest";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { applicationEvents, auditEvents, managerApplications, platformRoles } from "@repo/db";
import { app } from "../../src/app";
import { grantRole } from "../../src/services/platform-roles";
import { signIn, webHeaders } from "../helpers/auth";
import { fakes } from "../helpers/fakes";
import { adminSql, resetDb, testDb } from "../helpers/db";
import { newEvmWallet } from "../helpers/wallets";
import { opsUser, seedApplication } from "./helpers";

const db = testDb.db;
beforeEach(resetDb);

const transition = (h: Record<string, string>, id: string, body: object) => request(app).post(`/v1/ops/applications/${id}/transition`).set(h).send(body);

describe("ops routes require a role", () => {
  it("a signed-in user without a role gets 403 on every ops route; anonymous gets 401", async () => {
    const h = webHeaders((await signIn(app, newEvmWallet(), "base")).cookie);
    const id = await seedApplication();
    const uuid = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f";
    const calls = [
      request(app).get("/v1/ops/applications").set(h),
      request(app).get(`/v1/ops/applications/${id}`).set(h),
      request(app).post(`/v1/ops/applications/${id}/transition`).set(h).send({ to: "SCREENING" }),
      request(app).post(`/v1/ops/applications/${id}/notes`).set(h).send({ internalNote: "x" }),
      request(app).get("/v1/ops/roles").set(h),
      request(app).post("/v1/ops/roles").set(h).send({ userId: uuid, role: "ops_admin" }),
      request(app).delete(`/v1/ops/roles/${uuid}`).set(h),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect((await request(app).get("/v1/ops/applications")).status).toBe(401);
    expect((await db.select().from(managerApplications).where(eq(managerApplications.id, id)))[0]!.status).toBe("SUBMITTED");
  });
});

describe("reviewer", () => {
  it("lists, reads, transitions and notes, but cannot manage roles", async () => {
    const r = await opsUser(app, "ops_reviewer");
    const id = await seedApplication();
    expect((await request(app).get("/v1/ops/applications").set(r.h)).body.items).toHaveLength(1);
    const moved = await transition(r.h, id, { to: "SCREENING", internalNote: "looks fine" });
    expect(moved.status).toBe(200);
    expect(moved.body.status).toBe("SCREENING");
    const note = await request(app).post(`/v1/ops/applications/${id}/notes`).set(r.h).send({ internalNote: "called them" });
    expect(note.status).toBe(201);
    const detail = await request(app).get(`/v1/ops/applications/${id}`).set(r.h);
    expect(detail.body.events.map((e: { kind: string; internalNote: string | null }) => e.internalNote)).toEqual(["looks fine", "called them"]);
    expect(detail.body.email).toBeTruthy();
    expect((await request(app).get("/v1/ops/roles").set(r.h)).status).toBe(403);
    expect((await request(app).post("/v1/ops/roles").set(r.h).send({ userId: r.userId, role: "ops_admin" })).status).toBe(403);
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, "application.status_changed"));
    expect(audit[0]).toMatchObject({ actorType: "user", actorUserId: r.userId, entityId: id, metadata: { from: "SUBMITTED", to: "SCREENING" } });
  });

  it("invalid transition -> 409 INVALID_TRANSITION; terminal states stay terminal", async () => {
    const r = await opsUser(app, "ops_reviewer");
    const id = await seedApplication();
    const bad = await transition(r.h, id, { to: "SCREENING_APPROVED" });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe("INVALID_TRANSITION");
    expect((await transition(r.h, id, { to: "SCREENING_REJECTED" })).status).toBe(200);
    expect((await transition(r.h, id, { to: "SCREENING" })).body.error.code).toBe("INVALID_TRANSITION");
    const [row] = await db.select().from(managerApplications).where(eq(managerApplications.id, id));
    expect(row).toMatchObject({ status: "SCREENING_REJECTED", decidedByUserId: r.userId });
    expect(row!.decidedAt).toBeTruthy();
  });

  it("the four notified statuses send an email with an idempotency key per event; other transitions do not", async () => {
    const r = await opsUser(app, "ops_reviewer");
    const id = await seedApplication();
    await transition(r.h, id, { to: "SCREENING" });
    expect(fakes.email.application).toHaveLength(0);
    await transition(r.h, id, { to: "CONTACTED", messageToApplicant: "We will email you" });
    await transition(r.h, id, { to: "ADDITIONAL_INFORMATION_REQUIRED", messageToApplicant: "Send a CV" });
    await transition(r.h, id, { to: "SCREENING" });
    await transition(r.h, id, { to: "SCREENING_APPROVED" });
    const other = await seedApplication({ status: "SCREENING" });
    await transition(r.h, other, { to: "SCREENING_REJECTED", messageToApplicant: "Not a fit" });
    expect(fakes.email.application.map((m) => m.kind)).toEqual(["contacted", "info_required", "approved", "rejected"]);
    expect(fakes.email.application[1]!.data.message).toBe("Send a CV");
    expect(fakes.email.application[2]!.data.walletLabel).toMatch(/^0x[0-9a-f]{4}….{4} on Base$/);
    const events = await db.select().from(applicationEvents).where(and(eq(applicationEvents.applicationId, id), eq(applicationEvents.toStatus, "CONTACTED")));
    expect(fakes.email.application[0]!.idempotencyKey).toBe(`application-status/${events[0]!.id}`);
    expect(new Set(fakes.email.application.map((m) => m.idempotencyKey)).size).toBe(4);
  });

  it("list excludes EMAIL_PENDING, paginates stably by (submitted_at, id) and searches", async () => {
    const r = await opsUser(app, "ops_reviewer");
    await seedApplication({ status: "EMAIL_PENDING" });
    // Rows share submitted_at in groups of three, so the id tie-break is exercised.
    await adminSql`
      INSERT INTO app.manager_applications (id, applicant_type, full_name, firm_name, email, country, professional_background, investment_experience, reason, intended_baskets,
        wallet_chain, wallet_family, wallet_address, status, submitted_at)
      SELECT gen_random_uuid(), 'individual', 'Person ' || i, CASE WHEN i = 5 THEN 'Acme_100% Capital' END, 'p' || i || '@example.com', 'GB', 'x', 'x', 'x', 'x',
        'base', 'evm', '0x' || lpad(i::text, 40, '0'), 'SUBMITTED', now() - (i / 3) * interval '1 second'
      FROM generate_series(1, 27) i`;
    const page1 = await request(app).get("/v1/ops/applications").set(r.h);
    expect(page1.body.items).toHaveLength(25);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await request(app).get("/v1/ops/applications").query({ cursor: page1.body.nextCursor }).set(r.h);
    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.nextCursor).toBeNull();
    const ids = [...page1.body.items, ...page2.body.items].map((x: { id: string }) => x.id);
    expect(new Set(ids).size).toBe(27);
    const q = (params: object) => request(app).get("/v1/ops/applications").query(params).set(r.h).then((res) => res.body.items as Array<{ fullName: string }>);
    expect(await q({ q: "person 27" })).toHaveLength(1);
    expect(await q({ q: "P5@EXAMPLE" })).toHaveLength(1);
    expect(await q({ q: "acme_100%" })).toHaveLength(1);
    expect(await q({ q: "%" })).toHaveLength(1);
    expect(await q({ status: "SCREENING" })).toHaveLength(0);
    expect((await request(app).get("/v1/ops/applications").query({ cursor: "garbage" }).set(r.h)).status).toBe(400);
  });

  it("unknown id -> 404", async () => {
    const r = await opsUser(app, "ops_reviewer");
    expect((await request(app).get("/v1/ops/applications/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f").set(r.h)).status).toBe(404);
  });
});

describe("roles", () => {
  it("admin grants and revokes; revocation applies to the next request", async () => {
    const admin = await opsUser(app, "ops_admin");
    const target = await opsUser(app, "ops_reviewer");
    const [held] = await db.select().from(platformRoles).where(eq(platformRoles.userId, target.userId));
    expect((await request(app).get("/v1/ops/applications").set(target.h)).status).toBe(200);
    expect((await request(app).delete(`/v1/ops/roles/${held!.id}`).set(admin.h)).status).toBe(204);
    expect((await request(app).get("/v1/ops/applications").set(target.h)).status).toBe(403);
    const granted = await request(app).post("/v1/ops/roles").set(admin.h).send({ userId: target.userId, role: "ops_reviewer" });
    expect(granted.status).toBe(201);
    expect((await request(app).post("/v1/ops/roles").set(admin.h).send({ userId: target.userId, role: "ops_reviewer" })).body.id).toBe(granted.body.id);
    expect((await request(app).get("/v1/ops/applications").set(target.h)).status).toBe(200);
    expect((await request(app).get("/v1/ops/roles").set(admin.h)).body.roles).toHaveLength(2);
    const actions = (await db.select().from(auditEvents)).map((a) => a.action);
    expect(actions.filter((a) => a === "platform_role.granted")).toHaveLength(3);
    expect(actions).toContain("platform_role.revoked");
  });

  it("an admin also passes reviewer checks", async () => {
    const admin = await opsUser(app, "ops_admin");
    expect((await request(app).get("/v1/ops/applications").set(admin.h)).status).toBe(200);
  });

  it("the last active admin cannot be revoked, but can once another admin exists", async () => {
    const admin = await opsUser(app, "ops_admin");
    const [mine] = await db.select().from(platformRoles).where(eq(platformRoles.userId, admin.userId));
    const refused = await request(app).delete(`/v1/ops/roles/${mine!.id}`).set(admin.h);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "At least one ops admin must remain." });
    const second = await opsUser(app, "ops_admin");
    expect((await request(app).delete(`/v1/ops/roles/${mine!.id}`).set(second.h)).status).toBe(204);
  });

  it("a suspended admin does not count as a remaining admin", async () => {
    const a = await opsUser(app, "ops_admin");
    const b = await opsUser(app, "ops_admin");
    await adminSql`UPDATE app.users SET status = 'suspended' WHERE id = ${b.userId}`;
    const [mine] = await db.select().from(platformRoles).where(eq(platformRoles.userId, a.userId));
    expect((await request(app).delete(`/v1/ops/roles/${mine!.id}`).set(a.h)).status).toBe(409);
  });

  it("racing revokes of the two remaining admins leave one", async () => {
    const a = await opsUser(app, "ops_admin");
    const b = await opsUser(app, "ops_admin");
    const rows = await db.select().from(platformRoles);
    const results = await Promise.all(rows.map((row, i) => request(app).delete(`/v1/ops/roles/${row.id}`).set((i === 0 ? a : b).h)));
    expect(results.map((r) => r.status).sort()).toEqual([204, 409]);
  });

  it("granting to an unknown user -> 404", async () => {
    const admin = await opsUser(app, "ops_admin");
    expect((await request(app).post("/v1/ops/roles").set(admin.h).send({ userId: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", role: "ops_admin" })).status).toBe(404);
  });

  it("CLI path: an operator grant is audited as ops and shows in /me", async () => {
    const s = await signIn(app, newEvmWallet(), "base");
    await grantRole({ operator: "sameer", requestId: "ops-cli-1" }, s.userId, "ops_admin");
    const audit = (await db.select().from(auditEvents)).find((a) => a.action === "platform_role.granted");
    expect(audit).toMatchObject({ actorType: "ops", actorOpsId: "sameer", entityId: s.userId });
    const me = await request(app).get("/v1/me").set(webHeaders(s.cookie));
    expect(me.body).toMatchObject({ platformRoles: ["ops_admin"], permissions: [] });
  });
});

describe("review rules", () => {
  it("moving to ADDITIONAL_INFORMATION_REQUIRED without a message is a 400", async () => {
    const r = await opsUser(app, "ops_reviewer");
    const id = await seedApplication({ status: "SCREENING" });
    const res = await transition(r.h, id, { to: "ADDITIONAL_INFORMATION_REQUIRED" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect((await transition(r.h, id, { to: "ADDITIONAL_INFORMATION_REQUIRED", messageToApplicant: "Please send proof" })).status).toBe(200);
  });

  it("a reviewer cannot act on an application whose wallet they own", async () => {
    const w = newEvmWallet();
    const s = await signIn(app, w, "base");
    await grantRole({ operator: "test", requestId: "r" }, s.userId, "ops_reviewer");
    const id = await seedApplication({ status: "SCREENING", walletAddress: w.address.toLowerCase() });
    for (const to of ["SCREENING_APPROVED", "SCREENING_REJECTED", "CONTACTED"]) {
      const res = await transition(webHeaders(s.cookie), id, { to });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect((await db.select().from(managerApplications).where(eq(managerApplications.id, id)))[0]!.status).toBe("SCREENING");
  });

  it("an approved application can be rejected only while its wallet is unproven", async () => {
    const r = await opsUser(app, "ops_reviewer");
    const unproven = await seedApplication({ status: "SCREENING_APPROVED" });
    expect((await transition(r.h, unproven, { to: "SCREENING_REJECTED" })).status).toBe(200);
    const proven = await seedApplication({ status: "SCREENING_APPROVED" });
    await adminSql`UPDATE app.manager_applications SET wallet_proven_at = now() WHERE id = ${proven}`;
    const res = await transition(r.h, proven, { to: "SCREENING_REJECTED" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });
});

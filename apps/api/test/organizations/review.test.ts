import request from "supertest";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, organizationEvents, organizationVersions, organizations } from "@repo/db";
import { app } from "@/app";
import { grantRole } from "@/services/platform-roles";
import { adminSql, testDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { addMember, orgWithOwner } from "../members/helpers";
import { DOCS, createOrg, fillAll, ops, proveWallet, readyOrg, resetOrgDb, submit, transition, user, verifiedOrg } from "./helpers";

const db = testDb.db;
beforeEach(resetOrgDb);

const orgRow = async (id: string) => (await db.select().from(organizations).where(eq(organizations.id, id)))[0]!;
const versions = (id: string) => db.select().from(organizationVersions).where(eq(organizationVersions.organizationId, id)).orderBy(organizationVersions.versionNumber);
const opsGet = (h: Record<string, string>, path: string) => request(app).get(`/v1/ops/organizations${path}`).set(h);
const decide = (h: Record<string, string>, id: string, versionId: string, body: object) => request(app).post(`/v1/ops/organizations/${id}/versions/${versionId}/decision`).set(h).send(body);

describe("submit", () => {
  it("an incomplete organization gets 422 with the exact missing list", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const res = await submit(app, u.h, id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("REQUIREMENTS_INCOMPLETE");
    expect(res.body.error.details.missing).toEqual({
      fields: ["displayName", "about", "experience", "legalName", "dateOfBirth", "residentialAddress", "professionalHistory"],
      documents: [...DOCS.individual],
      payoutWallet: true,
    });
    await fillAll(app, u.h, id);
    expect((await submit(app, u.h, id)).body.error.details.missing).toEqual({ fields: [], documents: [], payoutWallet: true });
    expect((await orgRow(id)).status).toBe("DRAFT");
  });

  it("only a DRAFT or CHANGES_REQUIRED organization can be submitted", async () => {
    const o = await readyOrg(app);
    expect((await submit(app, o.h, o.id)).body.status).toBe("SUBMITTED");
    const again = await submit(app, o.h, o.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("INVALID_TRANSITION");
    expect((await versions(o.id))[0]).toMatchObject({ status: "in_review" });
  });
});

describe("full review journey", () => {
  it("create -> fill -> documents -> wallet -> submit -> review -> changes -> resubmit -> verified, with emails", async () => {
    const reviewer = await ops(app);
    const o = await readyOrg(app);
    const ownerEmail = fakes.email.organization; // populated below
    expect((await submit(app, o.h, o.id)).body.status).toBe("SUBMITTED");
    expect((await transition(app, reviewer.h, o.id, { to: "UNDER_REVIEW" })).body.status).toBe("UNDER_REVIEW");

    const noMessage = await transition(app, reviewer.h, o.id, { to: "CHANGES_REQUIRED" });
    expect(noMessage.status).toBe(400);
    const changes = await transition(app, reviewer.h, o.id, { to: "CHANGES_REQUIRED", messageToOwner: "Please fix your address", internalNote: "address looks fake" });
    expect(changes.status).toBe(200);
    expect(changes.body.status).toBe("CHANGES_REQUIRED");
    expect((await versions(o.id))[0]!.status).toBe("changes_required");
    expect(ownerEmail.at(-1)).toMatchObject({ kind: "changes_required", data: { message: "Please fix your address" }, idempotencyKey: expect.stringMatching(/^organization-status\//) });

    const detail = (await request(app).get(`/v1/organizations/${o.id}`).set(o.h)).body;
    expect(detail.latestMessageToOwner).toBe("Please fix your address");
    expect(JSON.stringify(detail)).not.toContain("address looks fake");
    const edit = await request(app).patch(`/v1/organizations/${o.id}/draft`).set(o.h).send({ privateDetails: { residentialAddress: "2 Difference Engine Rd, London" } });
    expect(edit.status).toBe(200);
    expect((await submit(app, o.h, o.id)).body.status).toBe("RESUBMITTED");
    expect((await transition(app, reviewer.h, o.id, { to: "UNDER_REVIEW" })).status).toBe(200);
    const verified = await transition(app, reviewer.h, o.id, { to: "VERIFIED", internalNote: "all good" });
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe("VERIFIED");

    const row = await orgRow(o.id);
    const [v1] = await versions(o.id);
    expect(row).toMatchObject({ status: "VERIFIED", currentVersionId: v1!.id, decidedByUserId: reviewer.userId });
    expect(row.verifiedAt).toBeTruthy();
    expect(v1).toMatchObject({ status: "approved", decidedByUserId: reviewer.userId });
    expect(ownerEmail.map((m) => m.kind)).toEqual(["changes_required", "verified"]);
    expect(ownerEmail.every((m) => m.to.startsWith("owner-"))).toBe(true);
    expect(verified.body.events.map((e: { kind: string; toStatus: string | null }) => e.toStatus).filter(Boolean)).toEqual(["DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "RESUBMITTED", "UNDER_REVIEW", "VERIFIED"]);
    expect((await request(app).get("/v1/me").set(o.h)).body.organizations).toEqual([{ id: o.id, displayName: expect.any(String), role: "OWNER", status: "VERIFIED", membershipId: expect.any(String), membershipStatus: "ACTIVE" }]);
    const audit = await db.select().from(auditEvents).where(eq(auditEvents.action, "organization.status_changed"));
    expect(audit).toHaveLength(6);
  });

  it("rejection marks the version rejected, emails the owner, and frees the owner to start over", async () => {
    const reviewer = await ops(app);
    const o = await readyOrg(app);
    await submit(app, o.h, o.id);
    expect((await transition(app, reviewer.h, o.id, { to: "REJECTED", messageToOwner: "Not a fit" })).status).toBe(200);
    expect((await versions(o.id))[0]).toMatchObject({ status: "rejected" });
    expect(fakes.email.organization.at(-1)).toMatchObject({ kind: "rejected", data: { message: "Not a fit" } });
    expect((await request(app).post("/v1/organizations").set(o.h).send({ type: "firm", jurisdiction: "GB" })).status).toBe(201);
  });

  it("an owner without a verified email is not emailed, and the transition still succeeds", async () => {
    const reviewer = await ops(app);
    const u = await user(app);
    const id = await createOrg(app, u.h);
    await fillAll(app, u.h, id);
    await proveWallet(app, u.h, id);
    await submit(app, u.h, id);
    expect((await transition(app, reviewer.h, id, { to: "REJECTED" })).status).toBe(200);
    expect(fakes.email.organization).toHaveLength(0);
  });

  it("invalid transitions are 409 and terminal states stay terminal", async () => {
    const reviewer = await ops(app);
    const o = await readyOrg(app);
    await submit(app, o.h, o.id);
    const bad = await transition(app, reviewer.h, o.id, { to: "VERIFIED" });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe("INVALID_TRANSITION");
    expect((await transition(app, reviewer.h, o.id, { to: "REJECTED" })).status).toBe(200);
    expect((await transition(app, reviewer.h, o.id, { to: "UNDER_REVIEW" })).status).toBe(409);
    expect((await transition(app, reviewer.h, "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f", { to: "UNDER_REVIEW" })).status).toBe(404);
  });
});

describe("ops access", () => {
  it("without a role every ops organization route is 403; anonymous is 401", async () => {
    const plain = await user(app);
    const o = await readyOrg(app);
    const uuid = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f";
    const base = `/v1/ops/organizations/${o.id}`;
    const calls = [
      request(app).get("/v1/ops/organizations").set(plain.h),
      request(app).get(base).set(plain.h),
      request(app).post(`${base}/transition`).set(plain.h).send({ to: "UNDER_REVIEW" }),
      request(app).post(`${base}/versions/${uuid}/decision`).set(plain.h).send({ decision: "approved" }),
      request(app).post(`${base}/payout-wallets/${uuid}/decision`).set(plain.h).send({ decision: "approved" }),
      request(app).post(`${base}/notes`).set(plain.h).send({ internalNote: "x" }),
      request(app).get(`${base}/documents/${uuid}/download`).set(plain.h),
      // the owner is not an ops user either
      request(app).get(base).set(o.h),
      request(app).get(`${base}/documents/${uuid}/download`).set(o.h),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect((await request(app).get("/v1/ops/organizations")).status).toBe(401);
  });

  it("an ops user who belongs to the organization is refused every mutation and download, but may read", async () => {
    const o = await readyOrg(app);
    await grantRole({ operator: "test", requestId: "grant" }, o.userId, "ops_reviewer");
    await submit(app, o.h, o.id);
    const [w] = await adminSql<{ id: string }[]>`SELECT id FROM app.organization_payout_wallets WHERE organization_id = ${o.id}`;
    const [d] = await adminSql<{ id: string }[]>`SELECT id FROM app.organization_documents WHERE organization_id = ${o.id} LIMIT 1`;
    const [v] = await versions(o.id);
    const base = `/v1/ops/organizations/${o.id}`;
    const calls = [
      request(app).post(`${base}/transition`).set(o.h).send({ to: "UNDER_REVIEW" }),
      request(app).post(`${base}/versions/${v!.id}/decision`).set(o.h).send({ decision: "approved" }),
      request(app).post(`${base}/payout-wallets/${w!.id}/decision`).set(o.h).send({ decision: "approved" }),
      request(app).post(`${base}/notes`).set(o.h).send({ internalNote: "self" }),
      request(app).get(`${base}/documents/${d!.id}/download`).set(o.h),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe("You can't review your own organization.");
    }
    expect((await orgRow(o.id)).status).toBe("SUBMITTED");
    expect((await request(app).get(base).set(o.h)).status).toBe(200);
  });

  it("notes are stored as internal and never reach the owner", async () => {
    const reviewer = await ops(app);
    const o = await readyOrg(app);
    await submit(app, o.h, o.id);
    const res = await request(app).post(`/v1/ops/organizations/${o.id}/notes`).set(reviewer.h).send({ internalNote: "call the referee" });
    expect(res.status).toBe(201);
    expect(res.body.events.at(-1)).toMatchObject({ kind: "note", internalNote: "call the referee", actorUserId: reviewer.userId });
    expect(JSON.stringify((await request(app).get(`/v1/organizations/${o.id}`).set(o.h)).body)).not.toContain("call the referee");
  });
});

describe("ops detail and download", () => {
  it("shows everything to ops, and download redirects to a short-lived attachment link and is audited", async () => {
    const reviewer = await ops(app);
    const o = await readyOrg(app);
    await submit(app, o.h, o.id);
    const detail = (await opsGet(reviewer.h, `/${o.id}`)).body;
    expect(detail.versions[0].privateDetails.legalName).toBe("Ada Lovelace");
    expect(detail.owner).toMatchObject({ userId: o.userId, addresses: expect.arrayContaining([expect.objectContaining({ chain: "base" })]) });
    expect(detail.payoutWallets).toEqual([expect.objectContaining({ address: o.payoutWallet.address, status: "VERIFIED" })]);
    expect(detail.documents).toHaveLength(2);
    expect(detail.documents[0].versionIds).toEqual([detail.versions[0].id]);
    expect(JSON.stringify(detail)).not.toMatch(/r2Key|r2_key/);

    const doc = detail.documents.find((d: { documentType: string }) => d.documentType === "government_id");
    const res = await request(app).get(`/v1/ops/organizations/${o.id}/documents/${doc.id}/download`).set(reviewer.h);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://r2.test/documents/${o.id}/${doc.id}?sig`);
    const signed = fakes.r2.signed.at(-1)!;
    expect(signed).toMatchObject({ command: "GetObjectCommand", input: { Key: `documents/${o.id}/${doc.id}`, ResponseContentDisposition: 'attachment; filename="government_id.pdf"' }, options: { expiresIn: 300 } });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "organization_document.downloaded"))).toHaveLength(1);
    expect((await request(app).get(`/v1/ops/organizations/${o.id}/documents/0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f/download`).set(reviewer.h)).status).toBe(404);
  });
});

describe("queues", () => {
  it("filter by queue, status and search", async () => {
    const reviewer = await ops(app);
    const submitted = await readyOrg(app);
    await submit(app, submitted.h, submitted.id);
    const draftUser = await user(app);
    const draftId = await createOrg(app, draftUser.h);
    const withChange = await verifiedOrg(app, reviewer);
    await request(app).post(`/v1/organizations/${withChange.id}/change-request`).set(withChange.h);
    await request(app).patch(`/v1/organizations/${withChange.id}/draft`).set(withChange.h).send({ publicProfile: { displayName: "Renamed Fund" } });
    expect((await request(app).post(`/v1/organizations/${withChange.id}/change-request/submit`).set(withChange.h)).status).toBe(200);
    const withPayout = await verifiedOrg(app, reviewer);
    await proveWallet(app, withPayout.h, withPayout.id);

    const ids = async (query: string) => ((await opsGet(reviewer.h, query)).body.items as Array<{ id: string }>).map((i) => i.id).sort();
    expect(await ids("")).toEqual([submitted.id, withChange.id, withPayout.id].sort());
    expect(await ids("")).not.toContain(draftId);
    expect(await ids("?queue=change_requests")).toEqual([withChange.id]);
    expect(await ids("?queue=payout_changes")).toEqual([withPayout.id]);
    expect(await ids("?status=SUBMITTED")).toEqual([submitted.id]);
    expect(await ids("?q=renamed")).toEqual([withChange.id]);
    expect(await ids("?q=lovelace")).toHaveLength(3);
    expect(await ids("?q=nomatch")).toEqual([]);
    expect(await ids("?q=%25")).toEqual([]);
    const summary = (await opsGet(reviewer.h, `?q=renamed`)).body.items[0];
    expect(summary).toMatchObject({ displayName: "Renamed Fund", legalName: "Ada Lovelace", status: "VERIFIED" });
    expect((await opsGet(reviewer.h, "?cursor=garbage")).status).toBe(400);
    expect((await opsGet(reviewer.h, "?queue=nope")).status).toBe(400);
  });

  it("pages 25 at a time with a cursor", async () => {
    const reviewer = await ops(app);
    const owner = await user(app);
    const first = await createOrg(app, owner.h);
    await adminSql`UPDATE app.organizations SET status = 'SUBMITTED' WHERE id = ${first}`;
    await adminSql`INSERT INTO app.users (id, status) SELECT gen_random_uuid(), 'active' FROM generate_series(1, 25)`;
    await adminSql`INSERT INTO app.organizations (id, type, status, jurisdiction, created_by_user_id)
      SELECT gen_random_uuid(), 'individual', 'SUBMITTED', 'GB', id FROM app.users WHERE id <> ${owner.userId} AND id NOT IN (SELECT user_id FROM app.investment_wallets) LIMIT 25`;
    const page1 = (await opsGet(reviewer.h, "")).body;
    expect(page1.items).toHaveLength(25);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (await opsGet(reviewer.h, `?cursor=${encodeURIComponent(page1.nextCursor)}`)).body;
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect(new Set([...page1.items, ...page2.items].map((i: { id: string }) => i.id)).size).toBe(26);
  });
});

describe("change requests", () => {
  it("one open request at a time; ops decide changes_required (message needed) then approve", async () => {
    const reviewer = await ops(app);
    const o = await verifiedOrg(app, reviewer);
    const cr = await request(app).post(`/v1/organizations/${o.id}/change-request`).set(o.h);
    expect(cr.status).toBe(201);
    expect(cr.body.openVersion).toMatchObject({ versionNumber: 2, status: "draft", publicProfile: { displayName: "Ada Capital" } });
    expect(cr.body.openVersion.documents).toHaveLength(2);
    const again = await request(app).post(`/v1/organizations/${o.id}/change-request`).set(o.h);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe("A change request is already open.");

    // incomplete edits cannot be submitted
    await request(app).patch(`/v1/organizations/${o.id}/draft`).set(o.h).send({ publicProfile: { displayName: "Ada Capital Two" } });
    const submitted = await request(app).post(`/v1/organizations/${o.id}/change-request/submit`).set(o.h);
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe("VERIFIED");
    expect(submitted.body.openVersion.status).toBe("in_review");
    const [, v2] = await versions(o.id);
    expect((await request(app).patch(`/v1/organizations/${o.id}/draft`).set(o.h).send({ publicProfile: { displayName: "Late" } })).status).toBe(409);

    expect((await decide(reviewer.h, o.id, v2!.id, { decision: "changes_required" })).status).toBe(400);
    const back = await decide(reviewer.h, o.id, v2!.id, { decision: "changes_required", messageToOwner: "Tone it down" });
    expect(back.status).toBe(200);
    expect(fakes.email.organization.at(-1)).toMatchObject({ kind: "change_request_decided", data: { decision: "changes_required", message: "Tone it down" } });
    expect((await versions(o.id))[1]!.status).toBe("changes_required");
    expect((await request(app).post(`/v1/organizations/${o.id}/change-request/submit`).set(o.h)).status).toBe(200);
    expect((await decide(reviewer.h, o.id, v2!.id, { decision: "approved" })).status).toBe(200);
    const after = await versions(o.id);
    expect(after.map((v) => v.status)).toEqual(["superseded", "approved"]);
    expect((await orgRow(o.id)).currentVersionId).toBe(v2!.id);
    // a decided version cannot be decided again
    expect((await decide(reviewer.h, o.id, v2!.id, { decision: "rejected" })).status).toBe(409);
  });

  it("a change request needs a verified organization; incomplete content is refused", async () => {
    const o = await readyOrg(app);
    expect((await request(app).post(`/v1/organizations/${o.id}/change-request`).set(o.h)).status).toBe(409);
    expect((await request(app).post(`/v1/organizations/${o.id}/change-request/submit`).set(o.h)).status).toBe(409);
  });

  it("emails include no internal notes", async () => {
    const reviewer = await ops(app);
    const o = await verifiedOrg(app, reviewer);
    await request(app).post(`/v1/organizations/${o.id}/change-request`).set(o.h);
    await request(app).post(`/v1/organizations/${o.id}/change-request/submit`).set(o.h);
    const [, v2] = await versions(o.id);
    await decide(reviewer.h, o.id, v2!.id, { decision: "rejected", internalNote: "secret" });
    expect(JSON.stringify(fakes.email.organization)).not.toContain("secret");
    expect((await db.select().from(organizationEvents).where(eq(organizationEvents.kind, "version_decided")))[0]).toMatchObject({ decision: "rejected", internalNote: "secret" });
  });
});

describe("members in the ops organization detail", () => {
  it("lists open memberships with their role, status and approved-verification flag, and omits ended ones", async () => {
    const reviewer = await ops(app);
    const owner = await orgWithOwner(app);
    const approved = await addMember(app, owner.id, "ADMIN");
    const plain = await addMember(app, owner.id, "VIEWER");
    await addMember(app, owner.id, "VIEWER", "REVOKED");
    await adminSql`INSERT INTO app.member_verifications (id, membership_id, status) VALUES (gen_random_uuid(), ${approved.mid}, 'approved')`;
    const res = await opsGet(reviewer.h, `/${owner.id}`);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(3);
    expect(res.body.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: owner.mid, role: "OWNER", status: "ACTIVE", verificationApproved: false }),
      expect.objectContaining({ id: approved.mid, role: "ADMIN", status: "ACTIVE", verificationApproved: true }),
      expect.objectContaining({ id: plain.mid, role: "VIEWER", status: "ACTIVE", verificationApproved: false }),
    ]));
  });
});

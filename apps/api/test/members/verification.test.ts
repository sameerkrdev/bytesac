import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { grantRole } from "../../src/services/platform-roles";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { ops, resetOrgDb } from "../organizations/helpers";
import {
  MEMBER_DETAILS, acceptedMember, addMember, completeAndSubmit, decide, eventsOf, memberAction, orgWithOwner, rowOf, uploadMemberDocument,
} from "./helpers";

beforeEach(resetOrgDb);

const verificationOf = (h: Record<string, string>, mid: string) => request(app).get(`/v1/memberships/${mid}/verification`).set(h);

describe("the member's own verification", () => {
  it("starts as a draft listing exactly what is missing", async () => {
    const owner = await orgWithOwner(app);
    const m = await acceptedMember(owner, "MANAGER");
    const res = await verificationOf(m.h, m.mid);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: "draft", membershipStatus: "PENDING_DOCUMENTS", role: "MANAGER", requestedRole: null, details: {}, documents: [],
      template: { requiredFields: ["legalName", "dateOfBirth", "residentialAddress", "professionalHistory"], requiredDocuments: ["government_id", "proof_of_address"] },
      missing: { fields: ["legalName", "dateOfBirth", "residentialAddress", "professionalHistory"], documents: ["government_id", "proof_of_address"] },
    });
  });

  it("an incomplete submit is 422 with the exact missing items; null clears a value", async () => {
    const owner = await orgWithOwner(app);
    const m = await acceptedMember(owner, "MANAGER");
    await request(app).patch(`/v1/memberships/${m.mid}/verification`).set(m.h).send({ details: { legalName: "Grace Hopper", residentialAddress: "1 Compiler Way, New York" } });
    await uploadMemberDocument(m.h, m.mid, "government_id").then((u) => u.confirm);
    const res = await request(app).post(`/v1/memberships/${m.mid}/verification/submit`).set(m.h);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "REQUIREMENTS_INCOMPLETE", details: { missing: { fields: ["dateOfBirth", "professionalHistory"], documents: ["proof_of_address"] } } });
    const cleared = await request(app).patch(`/v1/memberships/${m.mid}/verification`).set(m.h).send({ details: { residentialAddress: null } });
    expect(cleared.body.details).toEqual({ legalName: "Grace Hopper" });
    expect((await rowOf(m.mid)).status).toBe("PENDING_DOCUMENTS");
  });

  it("rejects unknown, invalid and non-member-template keys", async () => {
    const owner = await orgWithOwner(app);
    const m = await acceptedMember(owner, "MANAGER");
    const patch = (details: object) => request(app).patch(`/v1/memberships/${m.mid}/verification`).set(m.h).send({ details });
    expect((await patch({ nope: "x" })).status).toBe(400);
    expect((await patch({ dateOfBirth: "2015-01-01" })).status).toBe(400);
    const outside = await patch({ qualifications: "CFA" });
    expect(outside.status).toBe(400);
    expect(outside.body.error).toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["qualifications"] } });
  });

  it("a confirmed document is stored under the member key, linked, and invisible to the organization", async () => {
    const owner = await orgWithOwner(app);
    const m = await acceptedMember(owner, "MANAGER");
    const up = await uploadMemberDocument(m.h, m.mid, "government_id");
    const confirmed = await up.confirm;
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.documents).toEqual([expect.objectContaining({ id: up.documentId, documentType: "government_id", status: "uploaded" })]);
    expect(confirmed.body.missing.documents).toEqual(["proof_of_address"]);
    expect(fakes.r2.objects.has(`documents/members/${m.mid}/${up.documentId}`)).toBe(true);
    expect(fakes.r2.objects.has(`incoming/members/${m.mid}/${up.documentId}`)).toBe(false);
    expect(await adminSql`SELECT membership_id, organization_id FROM app.organization_documents WHERE id = ${up.documentId}`).toEqual([{ membership_id: m.mid, organization_id: owner.id }]);
    expect(JSON.stringify(confirmed.body)).not.toMatch(/r2Key|r2_key|documents\/members/);

    // The organization's owner cannot read the member's details or documents; only the status is visible.
    expect((await verificationOf(owner.h, m.mid)).status).toBe(404);
    expect((await request(app).post(`/v1/memberships/${m.mid}/verification/submit`).set(owner.h)).status).toBe(404);
    expect((await request(app).post(`/v1/memberships/${m.mid}/verification/documents/${up.documentId}/confirm`).set(owner.h)).status).toBe(404);
    const list = await request(app).get(`/v1/organizations/${owner.id}/members`).set(owner.h);
    const row = list.body.members.find((x: { id: string }) => x.id === m.mid);
    expect(row.verificationStatus).toBe("draft");
    expect(JSON.stringify(list.body)).not.toContain("Grace");
    expect(await adminSql`SELECT 1 FROM app.organization_version_documents`).toHaveLength(0);
    const asOps = await ops(app);
    const orgReview = await request(app).get(`/v1/ops/organizations/${owner.id}`).set(asOps.h);
    expect(orgReview.body.documents).toEqual([]);
    expect((await request(app).get(`/v1/ops/organizations/${owner.id}/documents/${up.documentId}/download`).set(asOps.h)).status).toBe(404);
  });

  it("a wrong file is rejected, a new document replaces the same type, and unlink is soft", async () => {
    const owner = await orgWithOwner(app);
    const m = await acceptedMember(owner, "MANAGER");
    const bad = await request(app).post(`/v1/memberships/${m.mid}/verification/documents`).set(m.h).send({ documentType: "government_id", contentType: "application/pdf", sizeBytes: 50 });
    fakes.r2.put(`incoming/members/${m.mid}/${bad.body.documentId}`, Buffer.from("not a pdf at all, nope"), "application/pdf");
    const rejected = await request(app).post(`/v1/memberships/${m.mid}/verification/documents/${bad.body.documentId}/confirm`).set(m.h);
    expect(rejected.status).toBe(422);
    expect(rejected.body.error.code).toBe("DOCUMENT_REJECTED");
    const first = await (await uploadMemberDocument(m.h, m.mid, "government_id")).confirm;
    const second = await (await uploadMemberDocument(m.h, m.mid, "government_id")).confirm;
    expect(first.body.documents).toHaveLength(1);
    expect(second.body.documents).toHaveLength(1);
    expect(second.body.documents[0].id).not.toBe(first.body.documents[0].id);
    const unlinked = await request(app).delete(`/v1/memberships/${m.mid}/verification/documents/${second.body.documents[0].id}`).set(m.h);
    expect(unlinked.body.documents).toEqual([]);
    expect(await adminSql`SELECT 1 FROM app.organization_documents WHERE membership_id = ${m.mid} AND status = 'uploaded'`).toHaveLength(2);
    expect((await request(app).delete(`/v1/memberships/${m.mid}/verification/documents/${second.body.documents[0].id}`).set(m.h)).status).toBe(404);
  });

  it("another member cannot touch someone else's verification or document", async () => {
    const owner = await orgWithOwner(app);
    const m = await acceptedMember(owner, "MANAGER");
    const other = await acceptedMember(owner, "ADMIN");
    const up = await uploadMemberDocument(m.h, m.mid, "government_id");
    expect((await request(app).post(`/v1/memberships/${other.mid}/verification/documents/${up.documentId}/confirm`).set(other.h)).status).toBe(404);
    expect((await request(app).patch(`/v1/memberships/${m.mid}/verification`).set(other.h).send({ details: { legalName: "Hijack" } })).status).toBe(404);
    expect((await request(app).post(`/v1/memberships/${m.mid}/verification/documents`).set(other.h).send({ documentType: "government_id", contentType: "application/pdf", sizeBytes: 10 })).status).toBe(404);
  });
});

describe("ops review of a new member", () => {
  it("submit -> UNDER_REVIEW; changes required needs a message; resubmit; approve -> ACTIVE with the invited role", async () => {
    const owner = await orgWithOwner(app);
    const reviewer = await ops(app);
    const m = await acceptedMember(owner, "MANAGER");
    const submitted = await completeAndSubmit(m.h, m.mid);
    expect(submitted.status).toBe(200);
    expect(submitted.body).toMatchObject({ status: "in_review", membershipStatus: "UNDER_REVIEW" });
    expect((await request(app).patch(`/v1/memberships/${m.mid}/verification`).set(m.h).send({ details: { legalName: "Late" } })).status).toBe(409);
    expect((await request(app).get(`/v1/organizations/${owner.id}`).set(m.h)).status).toBe(403);

    const queue = await request(app).get("/v1/ops/members").set(reviewer.h);
    expect(queue.body.items).toEqual([expect.objectContaining({ id: m.mid, status: "UNDER_REVIEW", verificationStatus: "in_review", role: "MANAGER", requestedRole: null, publicDisplayName: null })]);
    const detail = (await request(app).get(`/v1/ops/members/${m.mid}`).set(reviewer.h)).body;
    expect(detail.verification.details).toMatchObject(MEMBER_DETAILS);
    expect(detail.verification.documents).toHaveLength(2);
    expect(detail.addresses.length).toBeGreaterThan(0);
    expect(JSON.stringify(detail)).not.toMatch(/r2Key|r2_key/);

    const noMessage = await decide(app, reviewer.h, m.mid, { decision: "changes_required" });
    expect(noMessage.status).toBe(400);
    expect((await rowOf(m.mid)).status).toBe("UNDER_REVIEW");
    const changes = await decide(app, reviewer.h, m.mid, { decision: "changes_required", messageToMember: "Your ID scan is blurry.", internalNote: "check again" });
    expect(changes.status).toBe(200);
    expect((await rowOf(m.mid)).status).toBe("CHANGES_REQUIRED");
    const seen = await verificationOf(m.h, m.mid);
    expect(seen.body).toMatchObject({ status: "changes_required", membershipStatus: "CHANGES_REQUIRED", latestMessageToMember: "Your ID scan is blurry." });
    expect(JSON.stringify(seen.body)).not.toContain("check again");
    expect((await decide(app, reviewer.h, m.mid, { decision: "approved" })).status).toBe(409);

    await request(app).patch(`/v1/memberships/${m.mid}/verification`).set(m.h).send({ details: { legalName: "Grace B. Hopper" } });
    expect((await request(app).post(`/v1/memberships/${m.mid}/verification/submit`).set(m.h)).body.membershipStatus).toBe("UNDER_REVIEW");
    const approved = await decide(app, reviewer.h, m.mid, { decision: "approved" });
    expect(approved.status).toBe(200);
    expect(await rowOf(m.mid)).toMatchObject({ status: "ACTIVE", role: "MANAGER", decided_by_user_id: reviewer.userId });
    expect((await rowOf(m.mid)).activated_at).toBeTruthy();
    expect((await request(app).get(`/v1/organizations/${owner.id}`).set(m.h)).body.myPermissions).toEqual(["org.read", "analytics.read", "baskets.manage"]);
    expect((await eventsOf(m.mid)).map((e) => e.kind)).toEqual(["invited", "accepted", "verification_submitted", "verification_decided", "verification_submitted", "verification_decided"]);
    const mails = fakes.email.membership.filter((x) => x.kind.startsWith("verification_")).map((x) => [x.kind, x.to]);
    expect(mails).toEqual([["verification_changes_required", expect.stringContaining("member-")], ["verification_approved", expect.stringContaining("member-")]]);
    expect(fakes.email.membership.find((x) => x.kind === "verification_changes_required")!.data.message).toBe("Your ID scan is blurry.");
    expect((await request(app).get("/v1/ops/members").set(reviewer.h)).body.items).toEqual([]);
  });

  it("reject -> REJECTED and terminal", async () => {
    const owner = await orgWithOwner(app);
    const reviewer = await ops(app);
    const m = await acceptedMember(owner, "ADMIN");
    await completeAndSubmit(m.h, m.mid);
    expect((await decide(app, reviewer.h, m.mid, { decision: "rejected", messageToMember: "Cannot verify you." })).status).toBe(200);
    expect(await rowOf(m.mid)).toMatchObject({ status: "REJECTED" });
    expect((await request(app).get(`/v1/organizations/${owner.id}`).set(m.h)).status).toBe(403);
    expect(fakes.email.membership.some((x) => x.kind === "verification_rejected")).toBe(true);
    expect((await decide(app, reviewer.h, m.mid, { decision: "approved" })).status).toBe(409);
  });

  it("a reviewer who belongs to the organization cannot decide or download", async () => {
    const owner = await orgWithOwner(app);
    const m = await acceptedMember(owner, "MANAGER");
    await completeAndSubmit(m.h, m.mid);
    const insider = await addMember(app, owner.id, "VIEWER");
    await grantRole({ operator: "test", requestId: "grant" }, insider.userId, "ops_reviewer");
    const doc = (await adminSql<{ id: string }[]>`SELECT id FROM app.organization_documents WHERE membership_id = ${m.mid} LIMIT 1`)[0]!;
    const res = await decide(app, insider.h, m.mid, { decision: "approved" });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe("You can't review your own organization.");
    expect((await request(app).get(`/v1/ops/members/${m.mid}/documents/${doc.id}/download`).set(insider.h)).status).toBe(403);
    expect((await rowOf(m.mid)).status).toBe("UNDER_REVIEW");
  });

  it("only ops reviewers reach the ops routes", async () => {
    const owner = await orgWithOwner(app);
    const m = await acceptedMember(owner, "MANAGER");
    const zero = "00000000-0000-4000-8000-000000000000";
    for (const res of [
      await request(app).get("/v1/ops/members").set(owner.h),
      await request(app).get(`/v1/ops/members/${m.mid}`).set(m.h),
      await request(app).post(`/v1/ops/members/${m.mid}/decision`).set(m.h).send({ decision: "approved" }),
      await request(app).get(`/v1/ops/members/${m.mid}/documents/${zero}/download`).set(owner.h),
    ]) expect(res.status).toBe(403);
    expect((await request(app).get("/v1/ops/members")).status).toBe(401);
  });

  it("the download redirects to a short-lived attachment link and is audited", async () => {
    const owner = await orgWithOwner(app);
    const reviewer = await ops(app);
    const m = await acceptedMember(owner, "MANAGER");
    await completeAndSubmit(m.h, m.mid);
    const doc = (await adminSql<{ id: string }[]>`SELECT id FROM app.organization_documents WHERE membership_id = ${m.mid} AND document_type = 'government_id'`)[0]!;
    const res = await request(app).get(`/v1/ops/members/${m.mid}/documents/${doc.id}/download`).set(reviewer.h);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://r2.test/documents/members/${m.mid}/${doc.id}?sig`);
    expect(fakes.r2.signed.at(-1)).toMatchObject({
      command: "GetObjectCommand", input: { Key: `documents/members/${m.mid}/${doc.id}`, ResponseContentDisposition: 'attachment; filename="government_id.pdf"' }, options: { expiresIn: 300 },
    });
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'member_document.downloaded' AND entity_id = ${doc.id}`).toHaveLength(1);
    expect((await request(app).get(`/v1/ops/members/${m.mid}/documents/00000000-0000-4000-8000-000000000000/download`).set(reviewer.h)).status).toBe(404);
  });

  it("the queue filters by status and pages with a cursor", async () => {
    const owner = await orgWithOwner(app);
    const reviewer = await ops(app);
    // Direct inserts: 26 sign-ins would trip the challenge rate limit.
    await adminSql`
      WITH u AS (INSERT INTO app.users (id, status) SELECT gen_random_uuid(), 'active' FROM generate_series(1, 26) RETURNING id),
      m AS (INSERT INTO app.organization_memberships (id, organization_id, user_id, role, status) SELECT gen_random_uuid(), ${owner.id}, id, 'MANAGER', 'UNDER_REVIEW' FROM u RETURNING id)
      INSERT INTO app.member_verifications (id, membership_id, status, submitted_at) SELECT gen_random_uuid(), id, 'in_review', now() FROM m`;
    const first = await request(app).get("/v1/ops/members").set(reviewer.h);
    expect(first.body.items).toHaveLength(25);
    expect(first.body.nextCursor).toBeTruthy();
    const second = await request(app).get("/v1/ops/members").query({ cursor: first.body.nextCursor }).set(reviewer.h);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
    expect((await request(app).get("/v1/ops/members").query({ status: "ACTIVE" }).set(reviewer.h)).body.items.map((i: { role: string }) => i.role)).toEqual(["OWNER"]);
    expect((await request(app).get("/v1/ops/members").query({ cursor: "garbage" }).set(reviewer.h)).status).toBe(400);
  });
});

describe("a role upgrade", () => {
  async function requested(role: "MANAGER" | "ADMIN" = "MANAGER") {
    const owner = await orgWithOwner(app);
    const reviewer = await ops(app);
    const viewer = await addMember(app, owner.id, "VIEWER");
    await memberAction(app, owner.h, owner.id, viewer.mid, "role", { role });
    return { owner, reviewer, viewer };
  }

  it("keeps the old role's permissions until ops approve, then switches the role", async () => {
    const { owner, reviewer, viewer } = await requested();
    const permissions = async () => (await request(app).get(`/v1/organizations/${owner.id}`).set(viewer.h)).body.myPermissions;
    expect(await permissions()).toEqual(["org.read"]);
    const view = await verificationOf(viewer.h, viewer.mid);
    expect(view.body).toMatchObject({ status: "draft", role: "VIEWER", requestedRole: "MANAGER", membershipStatus: "ACTIVE" });
    const submitted = await completeAndSubmit(viewer.h, viewer.mid);
    expect(submitted.body).toMatchObject({ status: "in_review", membershipStatus: "ACTIVE" });
    expect(await permissions()).toEqual(["org.read"]);
    expect((await request(app).get("/v1/ops/members").set(reviewer.h)).body.items).toEqual([expect.objectContaining({ id: viewer.mid, status: "ACTIVE", role: "VIEWER", requestedRole: "MANAGER" })]);

    const changes = await decide(app, reviewer.h, viewer.mid, { decision: "changes_required", messageToMember: "Add a clearer ID." });
    expect(changes.status).toBe(200);
    expect(await rowOf(viewer.mid)).toMatchObject({ status: "ACTIVE", role: "VIEWER", requested_role: "MANAGER" });
    expect((await request(app).post(`/v1/memberships/${viewer.mid}/verification/submit`).set(viewer.h)).status).toBe(200);
    expect((await decide(app, reviewer.h, viewer.mid, { decision: "approved" })).status).toBe(200);
    expect(await rowOf(viewer.mid)).toMatchObject({ status: "ACTIVE", role: "MANAGER", requested_role: null });
    expect(await permissions()).toEqual(["org.read", "analytics.read", "baskets.manage"]);
    expect((await eventsOf(viewer.mid)).map((e) => e.kind)).toEqual(["role_requested", "verification_submitted", "verification_decided", "verification_submitted", "verification_decided"]);
  });

  it("a rejected upgrade clears the request and leaves the member ACTIVE in the old role", async () => {
    const { owner, reviewer, viewer } = await requested("ADMIN");
    await completeAndSubmit(viewer.h, viewer.mid);
    expect((await decide(app, reviewer.h, viewer.mid, { decision: "rejected" })).status).toBe(200);
    expect(await rowOf(viewer.mid)).toMatchObject({ status: "ACTIVE", role: "VIEWER", requested_role: null });
    expect((await request(app).get(`/v1/organizations/${owner.id}`).set(viewer.h)).status).toBe(200);
    expect(await adminSql`SELECT status FROM app.member_verifications WHERE membership_id = ${viewer.mid}`).toEqual([{ status: "rejected" }]);
  });

  it("an active member without a requested role cannot submit", async () => {
    const owner = await orgWithOwner(app);
    const viewer = await addMember(app, owner.id, "VIEWER");
    expect((await request(app).post(`/v1/memberships/${viewer.mid}/verification/submit`).set(viewer.h)).status).toBe(409);
    expect((await verificationOf(viewer.h, viewer.mid)).status).toBe(404);
  });
});

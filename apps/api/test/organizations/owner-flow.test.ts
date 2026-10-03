import request from "supertest";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, organizationDocuments, organizationMemberships, organizationVersionDocuments } from "@repo/db";
import { app } from "@/app";
import { adminSql, testDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { DOCS, FIELDS, PDF, PNG, createOrg, resetOrgDb, uploadDocument, user } from "./helpers";

const db = testDb.db;
beforeEach(resetOrgDb);

const get = (h: Record<string, string>, id: string) => request(app).get(`/v1/organizations/${id}`).set(h);
const patch = (h: Record<string, string>, id: string, body: object) => request(app).patch(`/v1/organizations/${id}/draft`).set(h).send(body);
const presign = (h: Record<string, string>, id: string, body: object) => request(app).post(`/v1/organizations/${id}/documents`).set(h).send(body);
const pdfBody = { documentType: "government_id", contentType: "application/pdf", sizeBytes: 50 };

describe("create", () => {
  it("needs the create_manager_organization permission", async () => {
    const u = await user(app, false);
    const res = await request(app).post("/v1/organizations").set(u.h).send({ type: "individual", jurisdiction: "GB" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("creates a DRAFT with version 1, an OWNER membership and an audit entry", async () => {
    const u = await user(app);
    const res = await request(app).post("/v1/organizations").set(u.h).send({ type: "firm", jurisdiction: "GB" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ type: "firm", status: "DRAFT", openVersion: { versionNumber: 1, status: "draft" }, currentVersion: null });
    const [m] = await db.select().from(organizationMemberships).where(eq(organizationMemberships.organizationId, res.body.id));
    expect(m).toMatchObject({ userId: u.userId, role: "OWNER", status: "ACTIVE" });
    expect(m!.activatedAt).toBeTruthy();
    expect((await db.select().from(auditEvents).where(eq(auditEvents.action, "organization.created")))[0]).toMatchObject({ entityId: res.body.id, actorUserId: u.userId });
    expect((await request(app).get("/v1/organizations/mine").set(u.h)).body.organizations).toEqual([{ id: res.body.id, type: "firm", status: "DRAFT", jurisdiction: "GB", displayName: null, role: "OWNER", membershipId: m!.id, membershipStatus: "ACTIVE" }]);
  });

  it("allows one open organization; a rejected one frees the slot", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const again = await request(app).post("/v1/organizations").set(u.h).send({ type: "individual", jurisdiction: "GB" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ORGANIZATION_EXISTS");
    await adminSql`UPDATE app.organizations SET status = 'REJECTED' WHERE id = ${id}`;
    expect((await request(app).post("/v1/organizations").set(u.h).send({ type: "individual", jurisdiction: "GB" })).status).toBe(201);
  });
});

describe("access", () => {
  it("a non-member gets 403 on read and write; anonymous gets 401; unknown id 404", async () => {
    const owner = await user(app);
    const other = await user(app);
    const id = await createOrg(app, owner.h);
    for (const res of [await get(other.h, id), await patch(other.h, id, { publicProfile: { displayName: "Hijack" } }), await presign(other.h, id, pdfBody)]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect((await request(app).get(`/v1/organizations/${id}`)).status).toBe(401);
    expect((await get(owner.h, "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f")).status).toBe(404);
  });

  it("another owner cannot confirm or unlink someone else's document", async () => {
    const a = await user(app);
    const b = await user(app);
    const idA = await createOrg(app, a.h);
    await createOrg(app, b.h);
    const up = await uploadDocument(app, a.h, idA, "government_id");
    expect((await request(app).post(`/v1/organizations/${idA}/documents/${up.documentId}/confirm`).set(b.h)).status).toBe(403);
    expect((await up.confirm).status).toBe(200);
    expect((await request(app).delete(`/v1/organizations/${idA}/draft/documents/${up.documentId}`).set(b.h)).status).toBe(403);
  });
});

describe("draft", () => {
  it("merges fields, rejects unknown or wrong-visibility keys, and shrinks `missing` as it fills", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h, "firm");
    expect((await get(u.h, id)).body.missing).toEqual({
      fields: ["displayName", "about", "experience", "legalCompanyName", "registrationNumber", "registeredAddress", "directors", "beneficialOwners", "authorizedRepresentatives"],
      documents: ["company_registration", "ownership_structure", "director_id", "proof_of_address"],
      payoutWallet: true,
    });
    expect((await patch(u.h, id, { publicProfile: { nope: "x" } })).status).toBe(400);
    expect((await patch(u.h, id, { publicProfile: { legalCompanyName: "Ltd" } })).status).toBe(400);
    expect((await patch(u.h, id, { publicProfile: { website: "http://example.com" } })).status).toBe(400);
    const res = await patch(u.h, id, { publicProfile: { displayName: "Lovelace Capital" }, privateDetails: { legalCompanyName: "Lovelace Capital Ltd" } });
    expect(res.status).toBe(200);
    expect(res.body.missing.fields).not.toContain("displayName");
    expect(res.body.missing.fields).not.toContain("legalCompanyName");
    const full = await patch(u.h, id, FIELDS.firm);
    expect(full.body.missing.fields).toEqual([]);
    expect(full.body.openVersion.publicProfile.displayName).toBe("Lovelace Capital");
    expect(full.body.missing.documents).toHaveLength(4);
  });

  it("null clears a key: an optional field is removed, a required one is missing again", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h, "firm");
    await patch(u.h, id, { ...FIELDS.firm, publicProfile: { ...FIELDS.firm.publicProfile, website: "https://example.com" } });
    const res = await patch(u.h, id, { publicProfile: { website: null, about: null } });
    expect(res.status).toBe(200);
    expect(res.body.openVersion.publicProfile).not.toHaveProperty("website");
    expect(res.body.openVersion.publicProfile).not.toHaveProperty("about");
    expect(res.body.missing.fields).toEqual(["about"]);
  });

  it("is not editable outside draft or changes_required", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    await adminSql`UPDATE app.organization_versions SET status = 'in_review' WHERE organization_id = ${id}`;
    const res = await patch(u.h, id, { publicProfile: { displayName: "Late edit" } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
  });
});

describe("templates", () => {
  it("a jurisdiction-specific template wins over the default", async () => {
    await adminSql`INSERT INTO app.verification_requirement_templates (id, subject, jurisdiction, required_fields, required_documents)
      VALUES (gen_random_uuid(), 'individual', 'SG', ARRAY['displayName'], ARRAY['government_id'])`;
    const u = await user(app);
    const id = await createOrg(app, u.h, "individual", "SG");
    const body = (await get(u.h, id)).body;
    expect(body.template).toEqual({ requiredFields: ["displayName"], requiredDocuments: ["government_id"] });
    expect(body.missing).toEqual({ fields: ["displayName"], documents: ["government_id"], payoutWallet: true });
  });

  it("a template naming an unknown field or document type is a 500 configuration error", async () => {
    for (const [fields, docs] of [["'displayName','bogusField'", "'government_id'"], ["'displayName'", "'passport'"]]) {
      await adminSql.unsafe(`DELETE FROM app.verification_requirement_templates WHERE jurisdiction = 'ZZ'`);
      await adminSql.unsafe(`INSERT INTO app.verification_requirement_templates (id, subject, jurisdiction, required_fields, required_documents)
        VALUES (gen_random_uuid(), 'individual', 'ZZ', ARRAY[${fields}], ARRAY[${docs}])`);
      const u = await user(app);
      // The organization is created, then its detail view computes `missing` and fails.
      const res = await request(app).post("/v1/organizations").set(u.h).send({ type: "individual", jurisdiction: "ZZ" });
      expect(res.status).toBe(500);
      await adminSql`TRUNCATE app.organizations, app.organization_versions, app.organization_memberships, app.organization_events, app.audit_events CASCADE`;
    }
  });
});

describe("documents", () => {
  it("rejects a bad content type, an unknown document type and an 11 MB file", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    expect((await presign(u.h, id, { ...pdfBody, contentType: "application/x-msdownload" })).status).toBe(400);
    expect((await presign(u.h, id, { ...pdfBody, sizeBytes: 11 * 1024 * 1024 })).status).toBe(400);
    expect((await presign(u.h, id, { ...pdfBody, documentType: "passport" })).status).toBe(400);
  });

  it("presign signs type and length; confirm stores the file privately, links it and never exposes the key", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const pre = await presign(u.h, id, pdfBody);
    expect(pre.status).toBe(201);
    expect(pre.body.uploadUrl).toBe(`https://r2.test/incoming/${id}/${pre.body.documentId}?sig`);
    expect(pre.body.headers).toEqual({ "Content-Type": "application/pdf" });
    expect(fakes.r2.signed[0]).toMatchObject({ command: "PutObjectCommand", input: { Key: `incoming/${id}/${pre.body.documentId}`, ContentType: "application/pdf", ContentLength: 50 } });
    expect(fakes.r2.signed[0]!.options).toMatchObject({ expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) });

    fakes.r2.put(`incoming/${id}/${pre.body.documentId}`, Buffer.concat([PDF, Buffer.alloc(50 - PDF.length)]), "application/pdf");
    const done = await request(app).post(`/v1/organizations/${id}/documents/${pre.body.documentId}/confirm`).set(u.h);
    expect(done.status).toBe(200);
    expect(done.body.openVersion.documents).toEqual([expect.objectContaining({ id: pre.body.documentId, documentType: "government_id", status: "uploaded", sizeBytes: 50 })]);
    expect(JSON.stringify(done.body)).not.toMatch(/r2Key|r2_key|incoming\/|documents\/[0-9a-f]{8}-/);
    expect(done.body.missing.documents).toEqual(["proof_of_address"]);
    const [row] = await db.select().from(organizationDocuments).where(eq(organizationDocuments.id, pre.body.documentId));
    expect(row).toMatchObject({ status: "uploaded", r2Key: `documents/${id}/${pre.body.documentId}`, scanStatus: "not_scanned" });
    expect([...fakes.r2.objects.keys()]).toEqual([`documents/${id}/${pre.body.documentId}`]);
    expect((await request(app).post(`/v1/organizations/${id}/documents/${pre.body.documentId}/confirm`).set(u.h)).status).toBe(409);
  });

  it("PNG bytes declared as a PDF are rejected: object deleted, row rejected_file, nothing linked", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const up = await uploadDocument(app, u.h, id, "government_id", PNG, "application/pdf");
    const res = await up.confirm;
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("DOCUMENT_REJECTED");
    expect(fakes.r2.objects.size).toBe(0);
    expect((await db.select().from(organizationDocuments).where(eq(organizationDocuments.id, up.documentId)))[0]!.status).toBe("rejected_file");
    expect(await db.select().from(organizationVersionDocuments)).toHaveLength(0);
    expect((await get(u.h, id)).body.missing.documents).toContain("government_id");
  });

  it("a size mismatch is rejected too", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const pre = await presign(u.h, id, { ...pdfBody, sizeBytes: 999 });
    fakes.r2.put(`incoming/${id}/${pre.body.documentId}`, PDF, "application/pdf");
    expect((await request(app).post(`/v1/organizations/${id}/documents/${pre.body.documentId}/confirm`).set(u.h)).status).toBe(422);
    expect(fakes.r2.objects.size).toBe(0);
  });

  it("presign without an upload: confirm is refused and the type stays missing", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    const pre = await presign(u.h, id, pdfBody);
    expect((await get(u.h, id)).body.missing.documents).toEqual([...DOCS.individual]);
    const res = await request(app).post(`/v1/organizations/${id}/documents/${pre.body.documentId}/confirm`).set(u.h);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("DOCUMENT_REJECTED");
    expect((await get(u.h, id)).body.missing.documents).toEqual([...DOCS.individual]);
  });

  it("re-uploading the same type replaces the link; unlink removes the link only", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    await (await uploadDocument(app, u.h, id, "government_id")).confirm;
    const second = await uploadDocument(app, u.h, id, "government_id");
    const res = await second.confirm;
    expect(res.body.openVersion.documents.map((d: { id: string }) => d.id)).toEqual([second.documentId]);
    const links = await db.select().from(organizationVersionDocuments);
    expect(links).toHaveLength(2);
    expect(links.filter((l) => l.removedAt === null).map((l) => l.documentId)).toEqual([second.documentId]);

    const removed = await request(app).delete(`/v1/organizations/${id}/draft/documents/${second.documentId}`).set(u.h);
    expect(removed.status).toBe(200);
    expect(removed.body.openVersion.documents).toEqual([]);
    expect(removed.body.missing.documents).toContain("government_id");
    expect((await db.select().from(organizationDocuments).where(eq(organizationDocuments.id, second.documentId)))[0]!.status).toBe("uploaded");
    expect(fakes.r2.objects.has(`documents/${id}/${second.documentId}`)).toBe(true);
    expect((await request(app).delete(`/v1/organizations/${id}/draft/documents/${second.documentId}`).set(u.h)).status).toBe(404);
  });

  it("limits presigns to 30 per hour per organization", async () => {
    const u = await user(app);
    const id = await createOrg(app, u.h);
    for (let i = 0; i < 30; i++) expect((await presign(u.h, id, pdfBody)).status).toBe(201);
    expect((await presign(u.h, id, pdfBody)).status).toBe(429);
  });
});

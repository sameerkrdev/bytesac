import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { ORGANIZATION_FIELDS } from "@repo/validator";
import { app } from "@/app";
import { adminSql } from "../helpers/db";
import { createOrg, fillAll, ops, readyOrg, resetOrgDb, submit, transition, user, verifiedOrg } from "./helpers";

beforeEach(resetOrgDb);

const publicGet = (id: string) => request(app).get(`/v1/public/organizations/${id}`);
const privateKeys = Object.entries(ORGANIZATION_FIELDS).filter(([, f]) => f.visibility === "private").map(([key]) => key);

describe("public profile", () => {
  it("is 404 for unknown, DRAFT and UNDER_REVIEW organizations, with no session needed", async () => {
    const reviewer = await ops(app);
    const u = await user(app);
    const draft = await createOrg(app, u.h);
    await fillAll(app, u.h, draft);
    const o = await readyOrg(app);
    await submit(app, o.h, o.id);
    await transition(app, reviewer.h, o.id, { to: "UNDER_REVIEW" });
    for (const id of [draft, o.id, "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f"]) {
      const res = await publicGet(id);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    expect((await publicGet("not-a-uuid")).status).toBe(400);
  });

  it("shows only public catalog fields of a verified organization", async () => {
    const reviewer = await ops(app);
    const o = await verifiedOrg(app, reviewer);
    const res = await publicGet(o.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: o.id, type: "individual", jurisdiction: "GB", profile: { displayName: "Ada Capital" } });
    expect(res.body.verifiedAt).toBeTruthy();
    const text = JSON.stringify(res.body);
    for (const key of privateKeys) expect(text).not.toContain(`"${key}"`);
    for (const secret of ["Ada Lovelace", "1990-05-01", "Analytical St", "government_id", "r2"]) expect(text).not.toContain(secret);
    expect(Object.keys(res.body.profile).sort()).toEqual(["about", "displayName", "experience"]);
  });

  it("ignores private keys even if one is stored in the public part of a version", async () => {
    const reviewer = await ops(app);
    const o = await verifiedOrg(app, reviewer);
    await adminSql`UPDATE app.organization_versions SET public_profile = public_profile || '{"legalName": "Leak", "junk": 1}'::jsonb WHERE organization_id = ${o.id}`;
    const res = await publicGet(o.id);
    expect(JSON.stringify(res.body)).not.toContain("Leak");
    expect(res.body.profile.junk).toBeUndefined();
  });

  it("a pending change request never shows: the public profile equals the approved version until approval", async () => {
    const reviewer = await ops(app);
    const o = await verifiedOrg(app, reviewer);
    await request(app).post(`/v1/organizations/${o.id}/change-request`).set(o.h);
    await request(app).patch(`/v1/organizations/${o.id}/draft`).set(o.h).send({ publicProfile: { displayName: "Ada Capital Reborn" } });
    expect((await publicGet(o.id)).body.profile.displayName).toBe("Ada Capital");
    await request(app).post(`/v1/organizations/${o.id}/change-request/submit`).set(o.h);
    expect((await publicGet(o.id)).body.profile.displayName).toBe("Ada Capital");
    const detail = (await request(app).get(`/v1/ops/organizations/${o.id}`).set(reviewer.h)).body;
    const proposed = detail.versions.find((v: { status: string }) => v.status === "in_review");
    expect((await request(app).post(`/v1/ops/organizations/${o.id}/versions/${proposed.id}/decision`).set(reviewer.h).send({ decision: "approved" })).status).toBe(200);
    expect((await publicGet(o.id)).body.profile.displayName).toBe("Ada Capital Reborn");
  });

  it("is rate limited per IP", async () => {
    const id = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e5f";
    for (let i = 0; i < 60; i++) expect((await publicGet(id)).status).toBe(404);
    const limited = await publicGet(id);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});

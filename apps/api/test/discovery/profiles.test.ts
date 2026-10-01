import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { activeInstrument, basketOrg, publishedBasket } from "../baskets/helpers";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { opsUser } from "../managers/helpers";
import { addMember } from "../members/helpers";
import { resetOrgDb, user } from "../organizations/helpers";

type Headers = Record<string, string>;
let ctx: Awaited<ReturnType<typeof basketOrg>>;
let admin: { userId: string; h: Headers };
let reviewer: { userId: string; h: Headers };
let basket: { id: string; vid: string };

const put = (h: Headers, body: object) => request(app).put("/v1/me/manager-profile").set(h).send(body);
const act = (h: Headers, action: "publish" | "unpublish") => request(app).post(`/v1/me/manager-profile/${action}`).set(h);
const pub = (handle: string) => request(app).get(`/v1/public/managers/${handle}`);
const body = (over: object = {}) => ({ handle: "ada-l", displayName: "Ada Lovelace", headline: "Quant", experienceYears: 8, qualifications: ["CFA"], links: [{ label: "Site", url: "https://ada.example" }], ...over });

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  admin = await opsUser(app, "ops_admin");
  reviewer = await opsUser(app, "ops_reviewer");
  const [a, b] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
  basket = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Managed Basket");
});
beforeEach(async () => {
  await adminSql`DELETE FROM app.manager_profiles`;
  fakes.queue.jobs = [];
});

describe("own profile", () => {
  it("is empty at first, then created and updated by PUT as a draft", async () => {
    const u = await user(app);
    expect((await request(app).get("/v1/me/manager-profile").set(u.h)).body).toEqual({ profile: null });
    const created = await put(u.h, body());
    expect(created.status).toBe(200);
    expect(created.body.profile).toMatchObject({ handle: "ada-l", status: "draft", publishedAt: null, qualifications: ["CFA"] });
    const updated = await put(u.h, body({ displayName: "Ada L", headline: null, qualifications: [] }));
    expect(updated.body.profile).toMatchObject({ displayName: "Ada L", headline: null, qualifications: [], status: "draft" });
    expect((await request(app).get("/v1/me/manager-profile").set(u.h)).body.profile.displayName).toBe("Ada L");
  });

  it("validates the body, and needs a session", async () => {
    const u = await user(app);
    for (const bad of [body({ handle: "A" }), body({ handle: "has space" }), body({ displayName: "x" }), body({ links: [{ label: "x", url: "http://insecure.example" }] }), body({ qualifications: Array(11).fill("q") }), body({ extra: 1 })]) {
      expect((await put(u.h, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await request(app).get("/v1/me/manager-profile")).status).toBe(401);
  });

  it("answers 409 HANDLE_TAKEN for another user's handle, but lets the owner keep their own", async () => {
    const [one, two] = [await user(app), await user(app)];
    await put(one.h, body());
    const taken = await put(two.h, body({ displayName: "Other" }));
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe("HANDLE_TAKEN");
    expect((await put(one.h, body({ headline: "Changed" }))).status).toBe(200);
  });

  it("publishes and unpublishes idempotently; a draft is a public 404", async () => {
    const u = await user(app);
    expect((await act(u.h, "publish")).status).toBe(404);
    await put(u.h, body());
    expect((await pub("ada-l")).status).toBe(404);
    const published = await act(u.h, "publish");
    expect(published.body.profile).toMatchObject({ status: "published" });
    expect(published.body.profile.publishedAt).toBeTruthy();
    expect((await act(u.h, "publish")).status).toBe(200);
    expect((await pub("ada-l")).status).toBe(200);
    expect((await act(u.h, "unpublish")).body.profile.status).toBe("draft");
    expect((await act(u.h, "unpublish")).status).toBe(200);
    expect((await pub("ada-l")).status).toBe(404);
    expect((await pub("nobody-here")).status).toBe(404);
    expect((await pub("A")).status).toBe(400);
  });
});

describe("public profile", () => {
  it("lists baskets and opted-in organizations and labels self-reported claims, without ids or emails", async () => {
    await put(ctx.owner.h, body());
    await act(ctx.owner.h, "publish");
    await adminSql`UPDATE app.organization_memberships SET public_display_name = 'Ada L.', public_title = 'Founder' WHERE id = ${ctx.owner.mid}`;
    const res = await pub("ada-l");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ handle: "ada-l", displayName: "Ada Lovelace", selfReported: ["experienceYears", "qualifications"], verified: true });
    expect(res.body.baskets).toEqual([{ slug: expect.any(String), name: "Managed Basket", status: "ACTIVE", role: "lead", from: expect.any(String), to: null }]);
    expect(res.body.organizations).toEqual([expect.objectContaining({ organizationId: ctx.owner.id, role: "OWNER", title: "Founder", current: true, to: null })]);
    const json = JSON.stringify(res.body);
    for (const secret of [ctx.owner.userId, "@", "membershipId", "userId", "email"]) expect(json, secret).not.toContain(secret);
    await adminSql`UPDATE app.organization_memberships SET public_display_name = NULL WHERE id = ${ctx.owner.mid}`;
    expect((await pub("ada-l")).body.organizations).toEqual([]);
  });

  it("shows a retired basket and leaves out one that was never published", async () => {
    await put(ctx.owner.h, body());
    await act(ctx.owner.h, "publish");
    await adminSql`UPDATE app.baskets SET status = 'RETIRED' WHERE id = ${basket.id}`;
    expect((await pub("ada-l")).body.baskets).toHaveLength(1);
    await adminSql`UPDATE app.baskets SET status = 'ACTIVE' WHERE id = ${basket.id}`;
  });

  it("verified comes from an approved member verification or from owning a VERIFIED organization, and nothing else", async () => {
    const [approved, plain, owner] = [await addMember(app, ctx.owner.id, "MANAGER"), await addMember(app, ctx.owner.id, "VIEWER"), ctx.owner];
    await adminSql`INSERT INTO app.member_verifications (id, membership_id, status) VALUES (gen_random_uuid(), ${approved.mid}, 'approved')`;
    await put(approved.h, body({ handle: "approved-one" }));
    await put(plain.h, body({ handle: "plain-one" }));
    await put(owner.h, body({ handle: "owner-one" }));
    for (const u of [approved, plain, owner]) await act(u.h, "publish");
    expect([(await pub("approved-one")).body.verified, (await pub("plain-one")).body.verified, (await pub("owner-one")).body.verified]).toEqual([true, false, true]);
    await adminSql`UPDATE app.member_verifications SET status = 'in_review' WHERE membership_id = ${approved.mid}`;
    expect((await pub("approved-one")).body.verified).toBe(false);
    await adminSql`UPDATE app.organizations SET status = 'SUBMITTED' WHERE id = ${ctx.owner.id}`;
    expect((await pub("owner-one")).body.verified).toBe(false);
    await adminSql`UPDATE app.organizations SET status = 'VERIFIED' WHERE id = ${ctx.owner.id}`;
  });
});

describe("moderation", () => {
  it("ops hide: public 404, the owner cannot republish, basket pages fall back to the opt-in name; unhide returns a draft", async () => {
    await put(ctx.owner.h, body());
    await act(ctx.owner.h, "publish");
    await adminSql`UPDATE app.organization_memberships SET public_display_name = 'Opt In Name' WHERE id = ${ctx.owner.mid}`;
    const slug = (await adminSql<{ slug: string }[]>`SELECT slug FROM app.baskets WHERE id = ${basket.id}`)[0]!.slug;
    const manager = async () => (await request(app).get(`/v1/public/baskets/${slug}`)).body.managers[0];
    expect(await manager()).toMatchObject({ displayName: "Ada Lovelace", handle: "ada-l" });

    const list = await request(app).get("/v1/ops/manager-profiles?status=published").set(reviewer.h);
    const id = list.body.items.find((p: { handle: string }) => p.handle === "ada-l").id as string;
    fakes.queue.jobs = [];
    expect((await request(app).post(`/v1/ops/manager-profiles/${id}/hide`).set(reviewer.h).send({})).status).toBe(400);
    const hidden = await request(app).post(`/v1/ops/manager-profiles/${id}/hide`).set(reviewer.h).send({ reason: "Misleading claims" });
    expect(hidden.status).toBe(200);
    expect(hidden.body).toMatchObject({ status: "hidden", hiddenReason: "Misleading claims" });
    expect(fakes.queue.jobs.filter((j) => j.name === "search-index-refresh").map((j) => j.data.basketId)).toContain(basket.id);
    expect((await adminSql`SELECT action FROM app.audit_events WHERE entity_id = ${id}`).map((a) => a.action)).toContain("manager_profile.hidden");

    expect((await pub("ada-l")).status).toBe(404);
    expect(await manager()).toMatchObject({ displayName: "Opt In Name", handle: null });
    const republish = await act(ctx.owner.h, "publish");
    expect(republish.status).toBe(409);
    expect(republish.body.error.code).toBe("INVALID_TRANSITION");
    expect((await act(ctx.owner.h, "unpublish")).status).toBe(409);
    expect((await request(app).get("/v1/me/manager-profile").set(ctx.owner.h)).body.profile).toMatchObject({ status: "hidden", hiddenReason: "Misleading claims" });
    expect((await request(app).post(`/v1/ops/manager-profiles/${id}/hide`).set(reviewer.h).send({ reason: "again" })).status).toBe(409);

    const unhidden = await request(app).post(`/v1/ops/manager-profiles/${id}/unhide`).set(reviewer.h);
    expect(unhidden.body).toMatchObject({ status: "draft", hiddenReason: null });
    expect((await pub("ada-l")).status).toBe(404);
    expect((await act(ctx.owner.h, "publish")).status).toBe(200);
    expect((await pub("ada-l")).status).toBe(200);
  });

  it("ops routes need the reviewer role and the list pages by status", async () => {
    const u = await user(app);
    await put(u.h, body({ handle: "draft-one" }));
    expect((await request(app).get("/v1/ops/manager-profiles").set(u.h)).status).toBe(403);
    expect((await request(app).post(`/v1/ops/manager-profiles/${ctx.owner.id}/hide`).set(u.h).send({ reason: "x" })).status).toBe(403);
    const all = await request(app).get("/v1/ops/manager-profiles").set(reviewer.h);
    expect(all.body.items).toEqual([expect.objectContaining({ handle: "draft-one", status: "draft" })]);
    expect((await request(app).get("/v1/ops/manager-profiles?status=hidden").set(reviewer.h)).body.items).toEqual([]);
    expect(JSON.stringify(all.body)).not.toMatch(/userId|email/);
  });

  it("asset tags are an ops_admin matter", async () => {
    const asTag = (h: Headers) => request(app).post("/v1/ops/asset-tags").set(h).send({ key: "ai-tools", label: "AI tools" });
    expect((await asTag(reviewer.h)).status).toBe(403);
    expect((await asTag(admin.h)).status).toBe(201);
    expect((await asTag(admin.h)).status).toBe(400);
    expect((await request(app).get("/v1/ops/asset-tags").set(reviewer.h)).body.tags).toEqual([expect.objectContaining({ key: "ai-tools", status: "active" })]);
  });
});

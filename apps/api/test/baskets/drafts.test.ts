import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { db } from "@repo/db";
import { contentHash } from "../../src/services/baskets";
import { adminSql } from "../helpers/db";
import { createOrg, resetOrgDb, user } from "../organizations/helpers";
import { FULL_FEES, activeInstrument, basketOrg, basketRow, create, createBasket, eventKinds, forceStatus, getBasket, post, save, saveOpen, validContent } from "./helpers";

const ZERO = "11111111-1111-4111-8111-111111111111";
let ctx: Awaited<ReturnType<typeof basketOrg>>;
let a: string;
let b: string;

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  a = await activeInstrument(ctx.owner.userId, { name: "Alpha" });
  b = await activeInstrument(ctx.owner.userId, { name: "Beta" });
});

describe("create", () => {
  it("makes a draft v1 and an ACTIVE lead with all five flags for the creator", async () => {
    const res = await create(ctx.members.MANAGER.h, ctx.owner.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "DRAFT", publishedVersion: null, myPermissions: ["edit", "submit", "publish", "lifecycle", "assign"] });
    expect(res.body.slug).toMatch(/^core-crypto-[a-z0-9]{6}$/);
    expect(res.body.openVersion).toMatchObject({ versionNumber: 1, status: "draft", name: "Core Crypto", category: "thematic", fees: FULL_FEES, constraints: {}, rebalance: { reviewFrequency: "none" } });
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0]).toMatchObject({ role: "lead", status: "ACTIVE", isSelf: true, permissions: ["edit", "submit", "publish", "lifecycle", "assign"] });
    expect(await eventKinds(res.body.id)).toEqual(["created"]);
  });

  it("needs baskets.manage", async () => {
    for (const role of ["ANALYST", "VIEWER"] as const) expect((await create(ctx.members[role].h, ctx.owner.id)).status).toBe(403);
    expect((await create((await user(app, false)).h, ctx.owner.id)).status).toBe(403);
  });

  it("needs a VERIFIED organization", async () => {
    const other = await user(app);
    const orgId = await createOrg(app, other.h);
    const res = await create(other.h, orgId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "Your organization must be verified to create baskets." });
  });

  it("rejects a bad body", async () => {
    expect((await create(ctx.owner.h, ctx.owner.id, { name: "ab", category: "thematic" })).status).toBe(400);
    expect((await create(ctx.owner.h, ctx.owner.id, { name: "Valid name", category: "nope" })).status).toBe(400);
  });

  it("lists the organization's baskets, filtered by status, for any member", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id, { name: "Listed One", category: "index" });
    const all = await request(app).get(`/v1/organizations/${ctx.owner.id}/baskets`).set(ctx.members.VIEWER.h);
    expect(all.status).toBe(200);
    expect(all.body.baskets.find((x: { id: string }) => x.id === id)).toMatchObject({ name: "Listed One", category: "index", status: "DRAFT", currentVersionNumber: null, openVersionStatus: "draft" });
    const none = await request(app).get(`/v1/organizations/${ctx.owner.id}/baskets?status=RETIRED`).set(ctx.owner.h);
    expect(none.body.baskets).toEqual([]);
    expect((await request(app).get(`/v1/organizations/${ctx.owner.id}/baskets`).set((await user(app, false)).h)).status).toBe(403);
  });
});

describe("save draft", () => {
  it("returns validation with warnings and never blocks on an incomplete draft", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    const body = await saveOpen(ctx.owner.h, id, { shortDescription: "Short", assets: [{ instrumentId: a, targetWeightBps: 9000 }] });
    expect(body.openVersion.assets).toHaveLength(1);
    expect(body.validation.issues.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(["ALLOCATION_TOTAL_INVALID", "DISCLOSURE_MISSING", "MINIMUM_INVESTMENT_INVALID"]));
    expect(body.validation.warnings.map((i: { code: string }) => i.code)).toEqual(expect.arrayContaining(["CONSTRAINT_VIOLATION", "BASKET_NAME_REQUIRED"]));
    const ok = await saveOpen(ctx.owner.h, id, validContent(a, b));
    expect(ok.validation.issues).toEqual([]);
  });

  it("replaces assets as a new revision: old rows stay and only the current revision is read", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    await saveOpen(ctx.owner.h, id, { assets: [{ instrumentId: a, targetWeightBps: 5000 }, { instrumentId: b, targetWeightBps: 5000 }] });
    const body = await saveOpen(ctx.owner.h, id, { assets: [{ instrumentId: b, targetWeightBps: 10_000, rationale: "All in" }] });
    expect(body.openVersion.assets).toMatchObject([{ instrumentId: b, targetWeightBps: 10_000, rationale: "All in" }]);
    const rows = await adminSql<{ revision: number; instrument_id: string }[]>`SELECT revision, instrument_id FROM app.basket_version_assets WHERE version_id = ${body.openVersion.id} ORDER BY revision`;
    expect(rows.map((r) => r.revision)).toEqual([1, 1, 2]);
    const [v] = await adminSql<{ assets_revision: number }[]>`SELECT assets_revision FROM app.basket_versions WHERE id = ${body.openVersion.id}`;
    expect(v!.assets_revision).toBe(2);
    const cleared = await saveOpen(ctx.owner.h, id, { assets: [] });
    expect(cleared.openVersion.assets).toEqual([]);
  });

  it("treats null as clear and an omitted key as unchanged", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    await saveOpen(ctx.owner.h, id, { thesis: "Kept", objective: "Goes away" });
    const body = await saveOpen(ctx.owner.h, id, { objective: null, constraints: { maxWeightPerAssetBps: 5000 } });
    expect(body.openVersion).toMatchObject({ thesis: "Kept", objective: null, constraints: { maxWeightPerAssetBps: 5000 } });
  });

  it("refuses duplicates, unknown assets, unknown keys and client-supplied status", async () => {
    const { id, openVersion } = await createBasket(ctx.owner.h, ctx.owner.id);
    const base = { expectedUpdatedAt: openVersion.updatedAt };
    expect((await save(ctx.owner.h, id, { ...base, assets: [{ instrumentId: a, targetWeightBps: 5000 }, { instrumentId: a, targetWeightBps: 5000 }] })).status).toBe(400);
    expect((await save(ctx.owner.h, id, { ...base, assets: [{ instrumentId: ZERO, targetWeightBps: 10_000 }] })).status).toBe(400);
    expect((await save(ctx.owner.h, id, { ...base, status: "published" })).status).toBe(400);
    expect((await save(ctx.owner.h, id, { ...base, fees: { ...FULL_FEES, entry: { type: "percent", bps: 101 } } })).status).toBe(400);
    expect((await save(ctx.owner.h, id, { shortDescription: "x" })).status).toBe(400);
  });

  it("answers a stale expectedUpdatedAt with VERSION_CONFLICT and overwrites nothing (two managers)", async () => {
    const { id, openVersion } = await createBasket(ctx.owner.h, ctx.owner.id);
    const first = await save(ctx.owner.h, id, { expectedUpdatedAt: openVersion.updatedAt, thesis: "First writer" });
    expect(first.status).toBe(200);
    const second = await save(ctx.owner.h, id, { expectedUpdatedAt: openVersion.updatedAt, thesis: "Second writer", assets: [{ instrumentId: a, targetWeightBps: 10_000 }] });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: "VERSION_CONFLICT", message: "This draft changed since you opened it." });
    const now = (await getBasket(ctx.owner.h, id)).body.openVersion;
    expect(now).toMatchObject({ thesis: "First writer", assets: [] });
  });

  it("lets exactly one of two simultaneous saves win", async () => {
    const { id, openVersion } = await createBasket(ctx.owner.h, ctx.owner.id);
    const results = await Promise.all(["One", "Two"].map((t) => save(ctx.owner.h, id, { expectedUpdatedAt: openVersion.updatedAt, thesis: t })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!.body.openVersion.thesis;
    expect((await getBasket(ctx.owner.h, id)).body.openVersion.thesis).toBe(winner);
  });

  it("refuses to edit a frozen version or a read-only basket", async () => {
    const { id, openVersion } = await createBasket(ctx.owner.h, ctx.owner.id);
    await forceStatus(id, "in_review");
    const res = await save(ctx.owner.h, id, { expectedUpdatedAt: openVersion.updatedAt, thesis: "Too late" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_TRANSITION");
    await adminSql`UPDATE app.baskets SET status = 'RETIRED' WHERE id = ${id}`;
    expect((await save(ctx.owner.h, id, { expectedUpdatedAt: openVersion.updatedAt, thesis: "Nope" })).status).toBe(409);
  });

  it("validates and previews the open version for any member", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    await saveOpen(ctx.owner.h, id, validContent(a, b));
    const v = await post(ctx.members.VIEWER.h, `/v1/baskets/${id}/validate`);
    expect(v.body.issues).toEqual([]);
    const p = await request(app).get(`/v1/baskets/${id}/preview`).set(ctx.members.VIEWER.h);
    expect(p.body.version).toMatchObject({ name: "Core Crypto", assets: [{ symbol: expect.any(String) }, { symbol: expect.any(String) }] });
    expect(p.body.validation.issues).toEqual([]);
  });
});

describe("content hash", () => {
  it("ignores asset order and changes with any content or allocation change", async () => {
    const one = await createBasket(ctx.owner.h, ctx.owner.id);
    const two = await createBasket(ctx.owner.h, ctx.owner.id);
    const c = validContent(a, b);
    await saveOpen(ctx.owner.h, one.id, c);
    await saveOpen(ctx.owner.h, two.id, { ...c, assets: [...c.assets].reverse() });
    const [h1, h2] = await Promise.all([contentHash(db, one.openVersion.id), contentHash(db, two.openVersion.id)]);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2); // same content; the two baskets differ only by id, which is not hashed
    await saveOpen(ctx.owner.h, one.id, { thesis: "Changed" });
    expect(await contentHash(db, one.openVersion.id)).not.toBe(h1);
    await saveOpen(ctx.owner.h, two.id, { assets: [{ instrumentId: a, targetWeightBps: 5999 }, { instrumentId: b, targetWeightBps: 4001 }] });
    expect(await contentHash(db, two.openVersion.id)).not.toBe(h2);
  });
});

describe("versions", () => {
  it("refuses a next version without a published one, or while one is open", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    expect((await post(ctx.owner.h, `/v1/baskets/${id}/versions`)).status).toBe(409);
    const vid = await forceStatus(id, "published");
    const next = await post(ctx.owner.h, `/v1/baskets/${id}/versions`);
    expect(next.status).toBe(201);
    expect(next.body.openVersion.id).not.toBe(vid);
    expect((await post(ctx.owner.h, `/v1/baskets/${id}/versions`)).status).toBe(409);
  });

  it("clones the published content and allocation into the next draft; diff and history follow", async () => {
    const { id } = await createBasket(ctx.owner.h, ctx.owner.id);
    await saveOpen(ctx.owner.h, id, { ...validContent(a, b), fees: { ...FULL_FEES, entry: { type: "percent", bps: 10 } }, tags: ["defi"], minimumIncrementUsdc: "10" });
    const first = await forceStatus(id, "published");
    const next = (await post(ctx.owner.h, `/v1/baskets/${id}/versions`)).body;
    expect(next.openVersion).toMatchObject({
      versionNumber: 2, status: "draft", rationale: null, thesis: "Thesis", tags: ["defi"], minimumInvestmentUsdc: "100", minimumIncrementUsdc: "10",
      fees: { entry: { type: "percent", bps: 10 } },
    });
    expect(next.openVersion.assets.map((x: { instrumentId: string; targetWeightBps: number }) => [x.instrumentId, x.targetWeightBps]).sort()).toEqual([[a, 6000], [b, 4000]].sort());
    expect(next.publishedVersion.id).toBe(first);
    expect(next.validation.issues.map((i: { code: string }) => i.code)).toEqual(["REBALANCE_RATIONALE_REQUIRED"]);

    const changed = await saveOpen(ctx.owner.h, id, { rationale: "Rotate", assets: [{ instrumentId: a, targetWeightBps: 7000 }, { instrumentId: b, targetWeightBps: 3000 }] });
    const diff = await request(app).get(`/v1/baskets/${id}/versions/${changed.openVersion.id}/diff`).set(ctx.members.VIEWER.h);
    expect(diff.body).toMatchObject({ added: [], removed: [], fees: false });
    const byId = (x: { instrumentId: string }, y: { instrumentId: string }) => x.instrumentId.localeCompare(y.instrumentId);
    expect(diff.body.changed.sort(byId)).toEqual([{ instrumentId: a, fromBps: 6000, toBps: 7000 }, { instrumentId: b, fromBps: 4000, toBps: 3000 }].sort(byId));
    const list = await request(app).get(`/v1/baskets/${id}/versions`).set(ctx.members.VIEWER.h);
    expect(list.body.versions.map((v: { versionNumber: number; status: string }) => [v.versionNumber, v.status])).toEqual([[2, "draft"], [1, "published"]]);
    expect((await request(app).get(`/v1/baskets/${id}/versions/${ZERO}/diff`).set(ctx.owner.h)).status).toBe(404);
    expect((await basketRow(id)).status).toBe("ACTIVE");
  });
});

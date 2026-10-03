import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { redis } from "../../src/middleware/rate-limit";
import * as basketsService from "../../src/services/baskets";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { opsUser } from "../managers/helpers";
import { resetOrgDb } from "../organizations/helpers";
import {
  activeInstrument, approvedBasket, basketOrg, basketRow, decideBasket, decision, eventKinds, getBasket, post, publishBasket, publishedBasket, saveOpen, submitBasket,
} from "./helpers";

let ctx: Awaited<ReturnType<typeof basketOrg>>;
let admin: { userId: string; h: Record<string, string> };
let a: string;
let b: string;

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  admin = await opsUser(app, "ops_admin");
  [a, b] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
});
beforeEach(() => redis.flushdb());

const versionRow = async (vid: string) => (await adminSql`SELECT * FROM app.basket_versions WHERE id = ${vid}`)[0]!;

describe("publish", () => {
  it("publishes the approved version: basket ACTIVE, version published, event and email; repeating changes nothing", async () => {
    const r = await approvedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    expect((await versionRow(r.vid)).status).toBe("approved");
    const res = await publishBasket(ctx.owner.h, r.id);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ACTIVE", openVersion: null, publishedVersion: { id: r.vid, status: "published", versionNumber: 1 } });
    const row = await versionRow(r.vid);
    expect(row).toMatchObject({ status: "published", published_by_user_id: ctx.owner.userId });
    expect(row.content_hash).toBe(row.approved_hash);
    expect(row.published_at).toBeTruthy();
    expect((await basketRow(r.id)).current_version_id).toBe(r.vid);
    expect(fakes.email.basket.filter((e) => e.kind === "published")).toHaveLength(1);
    expect(fakes.queue.jobs.filter((j) => j.name === "notifications" && j.data.basketId === r.id)).toEqual([]); // the first publish has no holders
    const events = await eventKinds(r.id);
    const again = await publishBasket(ctx.owner.h, r.id);
    expect(again.status).toBe(200);
    expect(await eventKinds(r.id)).toEqual(events);
    expect(fakes.email.basket.filter((e) => e.kind === "published")).toHaveLength(1);
  });

  it("refuses when nothing is approved, or the basket is paused", async () => {
    const fresh = await approvedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    await adminSql`UPDATE app.basket_versions SET status = 'in_review' WHERE id = ${fresh.vid}`;
    expect((await publishBasket(ctx.owner.h, fresh.id)).status).toBe(409);
    await adminSql`UPDATE app.basket_versions SET status = 'approved' WHERE id = ${fresh.vid}`;
    await adminSql`UPDATE app.baskets SET status = 'ACTIVE' WHERE id = ${fresh.id}`;
    await adminSql`UPDATE app.baskets SET status = 'PAUSED' WHERE id = ${fresh.id}`;
    expect((await publishBasket(ctx.owner.h, fresh.id)).status).toBe(409);
  });

  it("refuses when the content changed after approval", async () => {
    const r = await approvedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    await adminSql`UPDATE app.basket_versions SET strategy_risks = 'edited after approval' WHERE id = ${r.vid}`;
    const res = await publishBasket(ctx.owner.h, r.id);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "INVALID_TRANSITION", message: "This version changed after approval." });
    expect((await versionRow(r.vid)).status).toBe("approved");
    expect((await basketRow(r.id)).status).toBe("DRAFT");
  });

  it("refuses when the allocation changed after approval", async () => {
    const r = await approvedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    await adminSql`UPDATE app.basket_version_assets SET rationale = 'edited after approval' WHERE version_id = ${r.vid} AND target_weight_bps = 6000`;
    expect((await publishBasket(ctx.owner.h, r.id)).status).toBe(409);
  });

  it("re-pins when a disclosure template was replaced between submit and publish, records it, and still publishes", async () => {
    const r = await approvedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    const before = (await getBasket(ctx.owner.h, r.id)).body.openVersion.disclosures.find((d: { key: string }) => d.key === "no_guarantee");
    const created = await post(admin.h, "/v1/ops/disclosure-templates", { key: "no_guarantee", title: "No guarantee (v2)", body: "New wording.", condition: "always" });
    expect(created.status).toBe(201);
    const res = await publishBasket(ctx.owner.h, r.id);
    expect(res.status).toBe(200);
    const after = res.body.publishedVersion.disclosures.find((d: { key: string }) => d.key === "no_guarantee");
    expect(after).toMatchObject({ title: "No guarantee (v2)", body: "New wording." });
    expect(after.templateId).not.toBe(before.templateId);
    expect(await eventKinds(r.id)).toContain("disclosures_repinned");
    const row = await versionRow(r.vid);
    expect(row.disclosures_revision).toBe(2);
    expect(row.content_hash).not.toBe(row.approved_hash);
    const pins = await adminSql<{ revision: number }[]>`SELECT revision FROM app.basket_version_disclosures WHERE version_id = ${r.vid}`;
    expect(new Set(pins.map((p) => p.revision))).toEqual(new Set([1, 2]));
  });
});

describe("next versions", () => {
  it("publishing version 2 supersedes version 1; rationale is required; a rejected version 2 leaves the basket live", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    const next = await post(ctx.owner.h, `/v1/baskets/${r.id}/versions`);
    const v2 = next.body.openVersion.id as string;
    await saveOpen(ctx.owner.h, r.id, { assets: [{ instrumentId: a, targetWeightBps: 7000 }, { instrumentId: b, targetWeightBps: 3000 }] });
    const missing = await submitBasket(ctx.owner.h, r.id);
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.issues.map((i: { code: string }) => i.code)).toEqual(["REBALANCE_RATIONALE_REQUIRED"]);
    await saveOpen(ctx.owner.h, r.id, { rationale: "Rotate towards the first asset" });
    expect((await submitBasket(ctx.owner.h, r.id)).status).toBe(200);
    expect((await decideBasket(admin.h, r.id, v2, decision("rejected", { messageToManager: "No" }))).status).toBe(200);
    expect(await basketRow(r.id)).toMatchObject({ status: "ACTIVE", current_version_id: r.vid });
    expect((await versionRow(r.vid)).status).toBe("published");

    const v3 = (await post(ctx.owner.h, `/v1/baskets/${r.id}/versions`)).body.openVersion;
    expect(v3.versionNumber).toBe(3);
    await saveOpen(ctx.owner.h, r.id, { rationale: "Second attempt", assets: [{ instrumentId: a, targetWeightBps: 5000 }, { instrumentId: b, targetWeightBps: 5000 }] });
    await submitBasket(ctx.owner.h, r.id);
    expect((await decideBasket(admin.h, r.id, v3.id, decision("approved"))).status).toBe(200);
    const published = await publishBasket(ctx.owner.h, r.id);
    expect(published.status).toBe(200);
    expect(published.body.publishedVersion).toMatchObject({ id: v3.id, versionNumber: 3 });
    expect((await versionRow(r.vid)).status).toBe("superseded");
    expect((await versionRow(v3.id)).status).toBe("published");
    expect((await basketRow(r.id)).current_version_id).toBe(v3.id);
    // A version that replaced a current one tells the holders (the worker cancels open plans and fans out the notices).
    expect(fakes.queue.jobs.filter((j) => j.name === "notifications" && j.data.basketId === r.id)).toEqual([{ name: "notifications", data: { job: "version-published", basketId: r.id, versionId: v3.id } }]);
  });

  it("gives a renamed version a new slug and keeps the old one as an alias", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Alpha Basket");
    const oldSlug = (await basketRow(r.id)).slug as string;
    expect(oldSlug).toMatch(/^alpha-basket-/);
    const v2 = (await post(ctx.owner.h, `/v1/baskets/${r.id}/versions`)).body.openVersion.id as string;
    await saveOpen(ctx.owner.h, r.id, { name: "Income Plus", rationale: "New direction" });
    await submitBasket(ctx.owner.h, r.id);
    await decideBasket(admin.h, r.id, v2, decision("approved"));
    expect((await publishBasket(ctx.owner.h, r.id)).status).toBe(200);
    const row = await basketRow(r.id);
    expect(row.slug).toMatch(/^income-plus-[a-z0-9]{6}$/);
    const aliases = await adminSql<{ slug: string; basket_id: string }[]>`SELECT slug, basket_id FROM app.basket_slug_aliases WHERE basket_id = ${r.id}`;
    expect(aliases).toEqual([{ slug: oldSlug, basket_id: r.id }]);
    expect((await request(app).get(`/v1/public/baskets/${oldSlug}`)).body).toEqual({ redirectTo: row.slug });
  });

  it("a slug collision on publish is retried with a fresh suffix (up to 3 attempts), then fails", async () => {
    const other = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Rival Basket");
    const taken = (await basketRow(other.id)).slug as string;
    const rename = async (name: string) => {
      const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, name);
      const v2 = (await post(ctx.owner.h, `/v1/baskets/${r.id}/versions`)).body.openVersion.id as string;
      await saveOpen(ctx.owner.h, r.id, { name: `${name} Renamed`, rationale: "New direction" });
      await submitBasket(ctx.owner.h, r.id);
      await decideBasket(admin.h, r.id, v2, decision("approved"));
      return r;
    };
    const first = await rename("Retry Basket");
    const slugs = vi.spyOn(basketsService, "newSlug").mockReturnValueOnce(taken).mockReturnValueOnce(taken);
    expect((await publishBasket(ctx.owner.h, first.id)).status).toBe(200); // collides twice, the third attempt draws a fresh slug
    expect(slugs).toHaveBeenCalledTimes(3);
    expect((await basketRow(first.id)).slug).toMatch(/^retry-basket-renamed-[a-z0-9]{6}$/);
    const second = await rename("Doomed Basket");
    slugs.mockReset().mockReturnValue(taken);
    expect((await publishBasket(ctx.owner.h, second.id)).status).toBe(500); // three collisions in a row
    expect(slugs).toHaveBeenCalledTimes(3);
    slugs.mockRestore();
  });

  it("keeps the slug when the name is unchanged", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    const slug = (await basketRow(r.id)).slug;
    const v2 = (await post(ctx.owner.h, `/v1/baskets/${r.id}/versions`)).body.openVersion.id as string;
    await saveOpen(ctx.owner.h, r.id, { rationale: "Same name" });
    await submitBasket(ctx.owner.h, r.id);
    await decideBasket(admin.h, r.id, v2, decision("approved"));
    await publishBasket(ctx.owner.h, r.id);
    expect((await basketRow(r.id)).slug).toBe(slug);
    expect(await adminSql`SELECT 1 FROM app.basket_slug_aliases WHERE basket_id = ${r.id}`).toHaveLength(0);
  });
});

describe("publish re-validates", () => {
  it("refuses with 422 when the lead left after approval", async () => {
    const r = await approvedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    await adminSql`UPDATE app.basket_assignments SET status = 'ENDED', ended_at = now() WHERE basket_id = ${r.id} AND role = 'lead'`;
    const res = await publishBasket(ctx.owner.h, r.id);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "BASKET_VALIDATION_FAILED" });
    expect((await versionRow(r.vid)).status).toBe("approved");
    expect((await basketRow(r.id)).status).toBe("DRAFT");
  });

  it("refuses with 422 when an asset was paused after approval", async () => {
    const paused = await activeInstrument(ctx.owner.userId);
    const r = await approvedBasket(ctx.owner, ctx.owner.id, admin, paused, b);
    await adminSql`UPDATE app.instruments SET status = 'PAUSED' WHERE id = ${paused}`;
    const res = await publishBasket(ctx.owner.h, r.id);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("ASSET_UNSUPPORTED");
    expect((await basketRow(r.id)).status).toBe("DRAFT");
  });
});

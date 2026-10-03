import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { embedBasket, refreshSearchIndex, sweepEmbeddings } from "@/services/search-index";
import { structuredSearch } from "@/services/discovery";
import { activeInstrument, basketOrg, basketRow, decideBasket, decision, post, publishBasket, publishedBasket, saveOpen, submitBasket } from "../baskets/helpers";
import { setPublishedAt } from "./helpers";
import { adminSql } from "../helpers/db";
import { fakes, unitVector } from "../helpers/fakes";
import { opsUser } from "../managers/helpers";
import { resetOrgDb } from "../organizations/helpers";

let ctx: Awaited<ReturnType<typeof basketOrg>>;
let admin: { userId: string; h: Record<string, string> };
let a: string;
let b: string;

beforeAll(async () => {
  await resetOrgDb();
  ctx = await basketOrg();
  admin = await opsUser(app, "ops_admin");
  [a, b] = [await activeInstrument(ctx.owner.userId, { name: "Alpha Coin" }), await activeInstrument(ctx.owner.userId, { name: "Beta Coin", assetType: "STABLECOIN" })];
  await adminSql`UPDATE app.instruments SET sector = 'defi' WHERE id = ${a}`;
  await adminSql`UPDATE app.instruments SET sector = 'stablecoin' WHERE id = ${b}`;
});
beforeEach(() => {
  fakes.queue.jobs = [];
});

const row = async (bid: string) => (await adminSql`SELECT * FROM app.basket_search_index WHERE basket_id = ${bid}`)[0];
const refreshJobs = (bid: string) => fakes.queue.jobs.filter((j) => j.name === "search-index-refresh" && j.data.basketId === bid);

describe("refreshSearchIndex", () => {
  it("builds exposures, effective fee bps, tags and manager fields from the published version", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Indexed Basket");
    const fees = { entry: { type: "fixed", amountUsdc: "10" }, management: { type: "percent", bps: 50 }, rebalance: { type: "percent", bps: 25 }, subscription: { amountUsdc: "5", period: "monthly" } };
    await adminSql`UPDATE app.basket_versions SET fees = ${adminSql.json(fees)}, minimum_investment_usdc = 1000 WHERE id = ${r.vid}`;
    const [tag] = await adminSql<{ id: string }[]>`INSERT INTO app.asset_tags (id, key, label, created_by_user_id) VALUES (gen_random_uuid(), 'blue-chip', 'Blue chip', ${admin.userId}) RETURNING id`;
    await adminSql`INSERT INTO app.instrument_tags (id, instrument_id, tag_id, added_by_user_id) VALUES (gen_random_uuid(), ${a}, ${tag!.id}, ${admin.userId})`;
    await adminSql`INSERT INTO app.manager_profiles (id, user_id, handle, display_name, status, experience_years) VALUES (gen_random_uuid(), ${ctx.owner.userId}, 'lead-one', 'Lead One', 'published', 12)`;

    await refreshSearchIndex(r.id);
    const idx = (await row(r.id))!;
    expect(idx).toMatchObject({
      status: "ACTIVE", name: "Indexed Basket", max_weight_bps: 6000, fee_entry_bps: 100, fee_management_bps: 50, fee_rebalance_bps: 25, fee_subscription_bps: 50,
      tags: ["blue-chip"], manager_handles: ["lead-one"], manager_max_experience_years: 12, embedding_status: "pending", review_frequency: "none",
    });
    expect(idx.exposures.instruments).toEqual([{ id: a, symbol: expect.any(String), bps: 6000 }, { id: b, symbol: expect.any(String), bps: 4000 }]);
    expect(idx.exposures.assetTypes).toEqual(expect.arrayContaining([{ type: "CRYPTO", bps: 6000 }, { type: "STABLECOIN", bps: 4000 }]));
    expect(idx.exposures.sectors).toEqual(expect.arrayContaining([{ sector: "defi", bps: 6000 }, { sector: "stablecoin", bps: 4000 }]));
    expect(idx.metrics).toMatchObject({ available: false, dataDays: 0 });
    expect(fakes.queue.jobs.filter((j) => j.name === "embed-basket")).toEqual([{ name: "embed-basket", data: { basketId: r.id, versionId: r.vid } }]);
    expect((await structuredSearch({ q: "indexed" })).items.map((i) => i.name)).toEqual(["Indexed Basket"]);
  });

  it("indexes the first publish date, not the current version's", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Aged Basket");
    await setPublishedAt(r.vid, "2026-01-01T10:00:00Z");
    await post(ctx.owner.h, `/v1/baskets/${r.id}/versions`);
    const v2 = (await adminSql<{ id: string }[]>`SELECT id FROM app.basket_versions WHERE basket_id = ${r.id} AND status = 'draft'`)[0]!.id;
    await saveOpen(ctx.owner.h, r.id, { rationale: "Rotate", assets: [{ instrumentId: a, targetWeightBps: 7000 }, { instrumentId: b, targetWeightBps: 3000 }] });
    await submitBasket(ctx.owner.h, r.id);
    await decideBasket(admin.h, r.id, v2, decision("approved"));
    expect((await publishBasket(ctx.owner.h, r.id)).status).toBe(200);
    await refreshSearchIndex(r.id);
    const idx = (await row(r.id))!;
    expect(idx.current_version_id).toBe(v2);
    expect(new Date(idx.published_at).toISOString()).toBe("2026-01-01T10:00:00.000Z");
  });

  it("updates the status when paused and delists a retired basket", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Lifecycle Basket");
    await refreshSearchIndex(r.id);
    await adminSql`UPDATE app.baskets SET status = 'PAUSED' WHERE id = ${r.id}`;
    await refreshSearchIndex(r.id);
    expect((await row(r.id))!.status).toBe("PAUSED");
    expect((await structuredSearch({ q: "lifecycle" })).items.map((i) => i.status)).toEqual(["PAUSED"]);
    await adminSql`UPDATE app.baskets SET status = 'RETIRED' WHERE id = ${r.id}`;
    await refreshSearchIndex(r.id);
    expect((await row(r.id))!.status).toBe("RETIRED");
    expect((await structuredSearch({ q: "lifecycle" })).items).toEqual([]);
  });

  it("has no row for a basket that was never published", async () => {
    const draft = (await post(ctx.owner.h, `/v1/organizations/${ctx.owner.id}/baskets`, { name: "Never Published", category: "thematic" })).body.id as string;
    await refreshSearchIndex(draft);
    expect(await row(draft)).toBeUndefined();
  });

  it("keeps a ready embedding for the same version", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Stable Embedding");
    await refreshSearchIndex(r.id);
    await adminSql`UPDATE app.basket_search_index SET embedding_status = 'ready' WHERE basket_id = ${r.id}`;
    fakes.queue.jobs = [];
    await refreshSearchIndex(r.id);
    expect((await row(r.id))!.embedding_status).toBe("ready");
    expect(fakes.queue.jobs.filter((j) => j.name === "embed-basket")).toEqual([]);
  });
});

describe("enqueued refreshes", () => {
  it("publish, pause, resume and retirement request each queue a refresh after commit", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Queued Basket");
    expect(refreshJobs(r.id).length).toBeGreaterThan(0);
    fakes.queue.jobs = [];
    expect((await post(ctx.owner.h, `/v1/baskets/${r.id}/pause`, { reason: "Reviewing" })).status).toBe(200);
    expect((await basketRow(r.id)).status).toBe("PAUSED");
    expect(refreshJobs(r.id)).toHaveLength(1);
    fakes.queue.jobs = [];
    await post(ctx.owner.h, `/v1/baskets/${r.id}/resume`);
    expect(refreshJobs(r.id)).toHaveLength(1);
    fakes.queue.jobs = [];
    await post(admin.h, `/v1/ops/baskets/${r.id}/pause`, { reason: "Platform check" });
    await post(admin.h, `/v1/ops/baskets/${r.id}/retire`, { reason: "Wound up" });
    expect(refreshJobs(r.id)).toHaveLength(2);
  });

  it("a sector or tag change queues a refresh for baskets holding the instrument, and nothing for others", async () => {
    const held = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Holds Alpha");
    const other = await activeInstrument(ctx.owner.userId);
    fakes.queue.jobs = [];
    const res = await request(app).patch(`/v1/ops/assets/${a}`).set(admin.h).send({ sector: "layer2" });
    expect(res.status).toBe(200);
    expect(res.body.sector).toBe("layer2");
    expect(refreshJobs(held.id)).toHaveLength(1);
    fakes.queue.jobs = [];
    expect((await request(app).patch(`/v1/ops/assets/${other}`).set(admin.h).send({ sector: "meme" })).status).toBe(200);
    expect(fakes.queue.jobs.filter((j) => j.name === "search-index-refresh")).toEqual([]);
    const tag = (await post(admin.h, "/v1/ops/asset-tags", { key: "layer-two", label: "Layer two" })).body as { id: string };
    const tagged = await request(app).patch(`/v1/ops/assets/${a}`).set(admin.h).send({ tagIds: [tag.id] });
    expect(tagged.body.tags).toEqual([{ id: tag.id, key: "layer-two", label: "Layer two" }]);
    expect(refreshJobs(held.id)).toHaveLength(1);
    await post(admin.h, `/v1/ops/asset-tags/${tag.id}/retire`);
    expect(refreshJobs(held.id)).toHaveLength(2); // retiring the tag refreshes the baskets holding tagged instruments
    await request(app).patch(`/v1/ops/assets/${a}`).set(admin.h).send({ name: "Renamed Alpha" });
    expect(refreshJobs(held.id)).toHaveLength(3);
    expect((await request(app).patch(`/v1/ops/assets/${other}`).set(admin.h).send({ tagIds: [tag.id] })).status).toBe(404);
    expect((await request(app).patch(`/v1/ops/assets/${a}`).set(admin.h).send({ tagIds: [] })).body.tags).toEqual([]);
  });
});

describe("embeddings", () => {
  it("embedBasket stores the vector and marks ready; a failure marks failed, counts the attempt and rethrows", async () => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Embed Me");
    await refreshSearchIndex(r.id);
    fakes.gemini.vector = unitVector(3);
    await embedBasket(r.id);
    expect(await row(r.id)).toMatchObject({ embedding_status: "ready", embedding_attempts: 0 });
    expect(fakes.gemini.embedCalls[0]).toContain("Embed Me");
    fakes.gemini.embedFails = true;
    await expect(embedBasket(r.id)).rejects.toThrow("embedding down");
    expect(await row(r.id)).toMatchObject({ embedding_status: "failed", embedding_attempts: 1 });
  });

  it("the sweep queues pending and failed rows with fewer than 5 attempts only", async () => {
    const [p, f, done, exhausted] = [
      await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Sweep Pending"), await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Sweep Failed"),
      await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Sweep Ready"), await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Sweep Exhausted"),
    ];
    for (const x of [p, f, done, exhausted]) await refreshSearchIndex(x.id);
    await adminSql`UPDATE app.basket_search_index SET embedding_status = 'failed', embedding_attempts = 2 WHERE basket_id = ${f.id}`;
    await adminSql`UPDATE app.basket_search_index SET embedding_status = 'ready' WHERE basket_id = ${done.id}`;
    await adminSql`UPDATE app.basket_search_index SET embedding_status = 'failed', embedding_attempts = 5 WHERE basket_id = ${exhausted.id}`;
    fakes.queue.jobs = [];
    await sweepEmbeddings();
    const queued = fakes.queue.jobs.filter((j) => j.name === "embed-basket").map((j) => j.data);
    expect(queued).toEqual(expect.arrayContaining([{ basketId: p.id, versionId: p.vid, attempt: 0 }, { basketId: f.id, versionId: f.vid, attempt: 2 }]));
    expect(queued.map((d) => d.basketId)).not.toContain(done.id);
    expect(queued.map((d) => d.basketId)).not.toContain(exhausted.id);
  });
});

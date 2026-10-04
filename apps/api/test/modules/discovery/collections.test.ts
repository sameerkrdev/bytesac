import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { discoveryCollectionsResponseSchema, suggestedBasketsResponseSchema } from "@repo/validator";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { refreshSearchIndex } from "@/modules/discovery/search-index.service";
import { TRENDING_MIN_INVESTORS } from "@/modules/discovery/collections.service";
import { activeInstrument, basketOrg, publishedBasket } from "../baskets/helpers";
import { webHeaders } from "../../helpers/auth";
import { adminSql } from "../../helpers/db";
import { seedUser } from "../../helpers/execution";
import { opsUser } from "../manager-applications/helpers";
import { resetOrgDb } from "../organizations/helpers";

type Basket = { id: string; versionId: string };
let alpha: Basket, beta: Basket, gamma: Basket;
let reviewer: { userId: string; h: Record<string, string> };

const collections = async () => discoveryCollectionsResponseSchema.parse((await request(app).get("/v1/public/discovery/collections").set(webHeaders()).expect(200)).body);
const feature = (h: Record<string, string>, bid: string, rank: number | null) => request(app).put(`/v1/ops/baskets/${bid}/featured`).set(h).send({ rank });
const names = (items: Array<{ name: string }>) => items.map((i) => i.name);
const currentVersion = async (bid: string) => (await adminSql<{ id: string }[]>`SELECT current_version_id AS id FROM app.baskets WHERE id = ${bid}`)[0]!.id;
const openPositions = async (bid: string, n: number, openedDaysAgo = 1) => {
  const versionId = await currentVersion(bid);
  for (let i = 0; i < n; i++) {
    // Inserted directly: signing in this many wallets would trip the auth rate limits.
    const [u] = await adminSql<{ id: string }[]>`INSERT INTO app.users (id, status) VALUES (gen_random_uuid(), 'active') RETURNING id`;
    await adminSql`INSERT INTO app.basket_positions (id, user_id, basket_id, status, applied_version_id, opened_at)
      VALUES (gen_random_uuid(), ${u!.id}, ${bid}, 'OPEN', ${versionId}, now() - make_interval(days => ${openedDaysAgo}))`;
  }
};

beforeAll(async () => {
  await resetOrgDb();
  const ctx = await basketOrg();
  const admin = await opsUser(app, "ops_admin");
  reviewer = await opsUser(app, "ops_reviewer");
  const [a, b] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
  const made = [];
  for (const name of ["Alpha", "Beta", "Gamma"]) {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, name);
    await refreshSearchIndex(r.id);
    made.push({ id: r.id, versionId: await currentVersion(r.id) });
  }
  [alpha, beta, gamma] = made as [Basket, Basket, Basket];
  // Distinct categories so suggestions can be checked: Alpha and Gamma share one.
  await adminSql`UPDATE app.basket_search_index SET category = 'index' WHERE basket_id IN (${alpha.id}, ${gamma.id})`;
  await adminSql`UPDATE app.basket_search_index SET category = 'yield' WHERE basket_id = ${beta.id}`;
});
beforeEach(async () => {
  await redis.flushdb();
});

describe("featured rail", () => {
  it("is empty until ops feature a basket, then follows rank", async () => {
    expect((await collections()).featured).toEqual([]);
    await feature(reviewer.h, gamma.id, 2).expect(200, { basketId: gamma.id, rank: 2 });
    await feature(reviewer.h, beta.id, 1).expect(200);
    expect(names((await collections()).featured)).toEqual(["Beta", "Gamma"]);
    const [audit] = await adminSql<{ action: string; metadata: { from: number | null; to: number } }[]>`SELECT action, metadata FROM app.audit_events WHERE entity_id = ${gamma.id} AND action LIKE 'basket.%featured'`;
    expect(audit).toMatchObject({ action: "basket.featured", metadata: { from: null, to: 2 } });
  });

  it("clears a basket, and never lists one that stops being active", async () => {
    await feature(reviewer.h, gamma.id, null).expect(200, { basketId: gamma.id, rank: null });
    expect(names((await collections()).featured)).toEqual(["Beta"]);
    await adminSql`UPDATE app.basket_search_index SET status = 'PAUSED' WHERE basket_id = ${beta.id}`;
    expect((await collections()).featured).toEqual([]);
    await adminSql`UPDATE app.basket_search_index SET status = 'ACTIVE' WHERE basket_id = ${beta.id}`;
  });

  it("refuses to feature an inactive basket, validates the rank, and is ops-only", async () => {
    await adminSql`UPDATE app.baskets SET status = 'PAUSED', previous_status = 'ACTIVE', pause_kind = 'platform', pause_reason = 'test' WHERE id = ${gamma.id}`;
    expect((await feature(reviewer.h, gamma.id, 3)).body.error.code).toBe("INVALID_TRANSITION");
    await adminSql`UPDATE app.baskets SET status = 'ACTIVE', previous_status = NULL, pause_kind = NULL, pause_reason = NULL WHERE id = ${gamma.id}`;
    expect((await feature(reviewer.h, gamma.id, 0)).status).toBe(400);
    expect((await feature(reviewer.h, "0192f1c2-7a4b-7c3d-8e9f-000000000000", 1)).status).toBe(404);
    const investor = await seedUser();
    expect((await feature(investor.h, gamma.id, 1)).status).toBe(403);
  });
});

describe("trending rail", () => {
  it(`needs at least ${TRENDING_MIN_INVESTORS} distinct new investors in 30 days, and ranks by them`, async () => {
    await openPositions(alpha.id, TRENDING_MIN_INVESTORS - 1);
    await openPositions(gamma.id, TRENDING_MIN_INVESTORS + 10, 45); // too old
    expect((await collections()).trending).toEqual([]);
    await openPositions(alpha.id, 1);
    await openPositions(beta.id, TRENDING_MIN_INVESTORS + 1);
    const body = await collections();
    expect(names(body.trending)).toEqual(["Beta", "Alpha"]);
    expect(JSON.stringify(body)).not.toMatch(/investors|count/i);
  });
});

describe("suggested rail", () => {
  it("suggests baskets in the user's categories that they do not hold, else the newest", async () => {
    const u = await seedUser();
    const get = async () => suggestedBasketsResponseSchema.parse((await request(app).get("/v1/me/discovery/suggested").set(u.h).expect(200)).body);
    const before = await get();
    expect(before.basis).toBe("newest");
    expect(names(before.items).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
    await adminSql`INSERT INTO app.basket_positions (id, user_id, basket_id, status, applied_version_id) VALUES (gen_random_uuid(), ${u.userId}, ${alpha.id}, 'OPEN', ${alpha.versionId})`;
    expect(await get()).toMatchObject({ basis: "your_categories", items: [{ name: "Gamma" }] });
  });

  it("requires a session", async () => {
    expect((await request(app).get("/v1/me/discovery/suggested").set(webHeaders())).status).toBe(401);
  });
});

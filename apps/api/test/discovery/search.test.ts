import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { redis } from "../../src/middleware/rate-limit";
import { structuredSearch } from "../../src/services/discovery";
import { refreshSearchIndex } from "../../src/services/search-index";
import { activeInstrument, basketOrg, publishedBasket } from "../baskets/helpers";
import { adminSql } from "../helpers/db";
import { webHeaders } from "../helpers/auth";
import { opsUser } from "../managers/helpers";
import { resetOrgDb } from "../organizations/helpers";
import type { DiscoveryFilters } from "@repo/validator";

const ID = { btc: randomUUID(), eth: randomUUID(), usdc: randomUUID(), tbill: randomUUID(), uni: randomUUID() };
const AVAILABLE = (y1: string | null, vol: string | null, dd: string | null, since = "0.5") => ({
  available: true, dataDays: 400, net: { sinceLaunch: since, d30: null, d90: null, y1 }, gross: { sinceLaunch: null, d30: null, d90: null, y1: null }, volatility: vol, maxDrawdown: dd,
});
let ids: { alpha: string; beta: string; gamma: string; retired: string };
let filler: { baseVersionId: string; baseId: string };

/** Overwrites the derived row of a real published basket with known values (the refresh logic itself is covered in index.test.ts). */
async function shape(bid: string, v: {
  name: string; description?: string; instruments: Array<[string, string, number]>; types: Array<[string, number]>; sectors: Array<[string, number]>; tags: string[]; min: string; mgmt: number; sub?: number;
  review: string; published: string; metrics: object; handles: string[]; exp: number | null; status?: string; category?: string;
}) {
  const exposures = { instruments: v.instruments.map(([id, symbol, bps]) => ({ id, symbol, bps })), assetTypes: v.types.map(([type, bps]) => ({ type, bps })), sectors: v.sectors.map(([sector, bps]) => ({ sector, bps })) };
  await adminSql`UPDATE app.basket_search_index SET name = ${v.name}, short_description = ${v.description ?? null}, exposures = ${adminSql.json(exposures)}, tags = ${v.tags}, max_weight_bps = ${Math.max(...v.instruments.map((i) => i[2]))},
    minimum_investment_usdc = ${v.min}, fee_management_bps = ${v.mgmt}, fee_subscription_bps = ${v.sub ?? null}, review_frequency = ${v.review}, published_at = ${v.published}, metrics = ${adminSql.json(v.metrics as Parameters<typeof adminSql.json>[0])},
    manager_handles = ${v.handles}, manager_max_experience_years = ${v.exp}, status = ${v.status ?? "ACTIVE"}, category = ${v.category ?? "thematic"},
    search_text = to_tsvector('english', ${v.name} || ' ' || ${v.description ?? ""}) WHERE basket_id = ${bid}`;
}

beforeAll(async () => {
  await resetOrgDb();
  const ctx = await basketOrg();
  const admin = await opsUser(app, "ops_admin");
  const [a, b] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
  const make = async (name: string) => {
    const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, name);
    await refreshSearchIndex(r.id);
    return r;
  };
  const [alpha, beta, gamma, retired] = [await make("Alpha"), await make("Beta"), await make("Gamma"), await make("Retired")];
  ids = { alpha: alpha.id, beta: beta.id, gamma: gamma.id, retired: retired.id };
  await shape(alpha.id, {
    name: "Alpha Bitcoin", description: "Bitcoin and ether core", instruments: [[ID.btc, "BTC", 7000], [ID.eth, "ETH", 3000]], types: [["CRYPTO", 10_000]], sectors: [["store_of_value", 7000], ["smart_contract_platform", 3000]],
    tags: ["l1"], min: "100", mgmt: 50, review: "none", published: "2026-01-01T00:00:00Z", metrics: AVAILABLE("0.30", "0.50", "0.20"), handles: ["ada-l"], exp: 10,
  });
  await shape(beta.id, {
    name: "Beta Stable", description: "Treasury yield", instruments: [[ID.usdc, "USDC", 5000], [ID.tbill, "TBILL", 5000]], types: [["STABLECOIN", 5000], ["TOKENIZED_TREASURY", 5000]], sectors: [["stablecoin", 5000], ["rwa_treasury", 5000]],
    tags: ["yield", "l1"], min: "1000", mgmt: 100, sub: 20, review: "quarterly", published: "2026-02-01T00:00:00Z", metrics: AVAILABLE("0.05", "0.10", "0.02", "0.1"), handles: ["bob-b"], exp: 3, category: "yield",
  });
  await shape(gamma.id, {
    name: "Gamma Defi", description: "Single token", instruments: [[ID.uni, "UNI", 10_000]], types: [["CRYPTO", 10_000]], sectors: [["defi", 10_000]], tags: [], min: "50", mgmt: 0, review: "monthly",
    published: "2026-03-01T00:00:00Z", metrics: { ...AVAILABLE("0.90", "0.01", "0.00"), available: false }, handles: [], exp: null,
  });
  await shape(retired.id, {
    name: "Retired Bitcoin", instruments: [[ID.btc, "BTC", 10_000]], types: [["CRYPTO", 10_000]], sectors: [["store_of_value", 10_000]], tags: ["l1"], min: "10", mgmt: 0, review: "none",
    published: "2026-04-01T00:00:00Z", metrics: AVAILABLE("0.99", "0.01", "0.00"), handles: ["ada-l"], exp: 10, status: "RETIRED",
  });
  filler = { baseVersionId: alpha.vid, baseId: alpha.id };
});

const names = async (f: DiscoveryFilters) => (await structuredSearch(f)).items.map((i) => i.name);

describe("structuredSearch filters", () => {
  it("never returns an unlisted basket", async () => {
    expect(await names({})).toEqual(["Gamma Defi", "Beta Stable", "Alpha Bitcoin"]);
    expect(await names({ assets: [{ symbol: "BTC", minBps: 1 }] })).toEqual(["Alpha Bitcoin"]);
  });

  it("asset weights by symbol or id: minimum, maximum, and an absent asset counts as 0", async () => {
    expect(await names({ assets: [{ symbol: "BTC", minBps: 5000 }] })).toEqual(["Alpha Bitcoin"]);
    expect(await names({ assets: [{ instrumentId: ID.btc, minBps: 8000 }] })).toEqual([]);
    expect(await names({ assets: [{ symbol: "BTC", maxBps: 0 }] })).toEqual(["Gamma Defi", "Beta Stable"]);
    expect(await names({ assets: [{ symbol: "BTC", maxBps: 7000 }] })).toEqual(["Gamma Defi", "Beta Stable", "Alpha Bitcoin"]);
    expect(await names({ assets: [{ symbol: "BTC", minBps: 1 }, { symbol: "ETH", minBps: 1 }] })).toEqual(["Alpha Bitcoin"]);
  });

  it("asset type and sector weights", async () => {
    expect(await names({ assetTypes: [{ type: "TOKENIZED_TREASURY", minBps: 1 }] })).toEqual(["Beta Stable"]);
    expect(await names({ assetTypes: [{ type: "CRYPTO", maxBps: 0 }] })).toEqual(["Beta Stable"]);
    expect(await names({ sectors: [{ sector: "defi", minBps: 10_000 }] })).toEqual(["Gamma Defi"]);
    expect(await names({ sectors: [{ sector: "store_of_value", minBps: 5000 }, { sector: "smart_contract_platform", maxBps: 4000 }] })).toEqual(["Alpha Bitcoin"]);
  });

  it("tags (any), categories, organization and manager handle", async () => {
    expect(await names({ tags: ["yield"] })).toEqual(["Beta Stable"]);
    expect(await names({ tags: ["l1"] })).toEqual(["Beta Stable", "Alpha Bitcoin"]);
    expect(await names({ tags: ["yield", "nope"] })).toEqual(["Beta Stable"]);
    expect(await names({ categories: ["yield"] })).toEqual(["Beta Stable"]);
    expect(await names({ managerHandle: "ada-l" })).toEqual(["Alpha Bitcoin"]);
    const [org] = await adminSql<{ organization_id: string }[]>`SELECT organization_id FROM app.basket_search_index LIMIT 1`;
    expect(await names({ organizationId: org!.organization_id })).toHaveLength(3);
    expect(await names({ organizationId: randomUUID() })).toEqual([]);
  });

  it("single-asset weight, minimum investment, fee ceilings, review frequency and age", async () => {
    expect(await names({ maxSingleWeightBps: 5000 })).toEqual(["Beta Stable"]);
    expect(await names({ maxMinimumInvestmentUsdc: "100" })).toEqual(["Gamma Defi", "Alpha Bitcoin"]);
    expect(await names({ maxFeeBps: { management: 50 } })).toEqual(["Gamma Defi", "Alpha Bitcoin"]);
    expect(await names({ maxFeeBps: { subscription: 10 } })).toEqual(["Gamma Defi", "Alpha Bitcoin"]);
    expect(await names({ maxFeeBps: { entry: 0, rebalance: 0 } })).toHaveLength(3);
    expect(await names({ reviewFrequencies: ["monthly", "quarterly"] })).toEqual(["Gamma Defi", "Beta Stable"]);
    expect(await names({ minBasketAgeDays: 100_000 })).toEqual([]);
    expect(await names({ minBasketAgeDays: 0 })).toHaveLength(3);
  });

  it("performance filters only match baskets with available performance", async () => {
    expect(await names({ performance: { minNetReturn1y: "0.10" } })).toEqual(["Alpha Bitcoin"]);
    expect(await names({ performance: { minNetReturn1y: "0" } })).toEqual(["Beta Stable", "Alpha Bitcoin"]); // Gamma (0.90) is unavailable
    expect(await names({ performance: { maxVolatility: "0.2" } })).toEqual(["Beta Stable"]);
    expect(await names({ performance: { maxDrawdown: "0.2" } })).toEqual(["Beta Stable", "Alpha Bitcoin"]);
    expect(await names({ performance: { minNetReturnSinceLaunch: "0.5" } })).toEqual(["Alpha Bitcoin"]);
  });

  it("manager experience and text search", async () => {
    expect(await names({ minManagerExperienceYears: 5 })).toEqual(["Alpha Bitcoin"]);
    expect(await names({ minManagerExperienceYears: 1 })).toEqual(["Beta Stable", "Alpha Bitcoin"]);
    expect(await names({ q: "bitcoin" })).toEqual(["Alpha Bitcoin"]);
    expect(await names({ q: "treasury yield" })).toEqual(["Beta Stable"]);
    expect(await names({ q: "bitcoin OR token", sort: "newest" })).toEqual(["Gamma Defi", "Alpha Bitcoin"]);
    expect(await names({ q: "'; drop table app.baskets; --" })).toEqual([]);
  });

  it("each sort", async () => {
    expect(await names({ sort: "newest" })).toEqual(["Gamma Defi", "Beta Stable", "Alpha Bitcoin"]);
    expect(await names({ sort: "return_1y" })).toEqual(["Alpha Bitcoin", "Beta Stable", "Gamma Defi"]);
    expect(await names({ sort: "return_since_launch" })).toEqual(["Alpha Bitcoin", "Beta Stable", "Gamma Defi"]);
    expect(await names({ sort: "minimum_asc" })).toEqual(["Gamma Defi", "Alpha Bitcoin", "Beta Stable"]);
    expect(await names({ sort: "management_fee_asc" })).toEqual(["Gamma Defi", "Alpha Bitcoin", "Beta Stable"]);
    expect(await names({ sort: "relevance", q: "bitcoin ether" })).toEqual(["Alpha Bitcoin"]);
    expect(await names({ sort: "relevance" })).toEqual(["Gamma Defi", "Beta Stable", "Alpha Bitcoin"]); // no query: newest
  });

  it("result items carry the card fields only", async () => {
    const [alpha] = (await structuredSearch({ q: "bitcoin" })).items;
    expect(alpha).toEqual({
      slug: expect.any(String), name: "Alpha Bitcoin", shortDescription: "Bitcoin and ether core", organizationName: expect.any(String), category: "thematic", status: "ACTIVE",
      topAssets: [{ symbol: "BTC", bps: 7000 }, { symbol: "ETH", bps: 3000 }], minimumInvestmentUsdc: "100", managementFeeBps: 50, netReturn1y: "0.30", available: true,
    });
    const gamma = (await structuredSearch({ q: "token" })).items[0]!;
    expect(gamma).toMatchObject({ netReturn1y: null, available: false });
  });
});

describe("pagination", () => {
  it("pages of 20 with a stable keyset cursor for every sort", async () => {
    // 22 extra listed baskets cloned from Alpha: distinct id, name, minimum and publish time.
    for (let k = 0; k < 22; k++) {
      const id = randomUUID();
      const vid = randomUUID();
      await adminSql`INSERT INTO app.baskets (id, organization_id, slug, status, created_by_user_id) SELECT ${id}, organization_id, ${"clone-" + k}, 'ACTIVE', created_by_user_id FROM app.baskets WHERE id = ${filler.baseId}`;
      await adminSql`INSERT INTO app.basket_versions (id, basket_id, version_number, status, name, category, fees, created_by_user_id, published_at)
        SELECT ${vid}, ${id}, 1, 'published', ${"Clone " + k}, category, fees, created_by_user_id, now() FROM app.basket_versions WHERE id = ${filler.baseVersionId}`;
      await adminSql`UPDATE app.baskets SET current_version_id = ${vid} WHERE id = ${id}`;
      await adminSql`INSERT INTO app.basket_search_index (basket_id, organization_id, organization_name, slug, status, category, name, exposures, max_weight_bps, minimum_investment_usdc, fee_entry_bps, fee_management_bps,
        fee_rebalance_bps, review_frequency, published_at, current_version_id, metrics, search_text)
        SELECT ${id}, organization_id, organization_name, ${"clone-" + k}, 'ACTIVE', category, ${"Clone " + k}, exposures, max_weight_bps, ${200 + k}, 0, ${k % 5}, 0, 'none', published_at - make_interval(mins => ${k + 1}), ${vid}, metrics,
          to_tsvector('english', 'clone') FROM app.basket_search_index WHERE basket_id = ${filler.baseId}`;
    }
    for (const sort of ["newest", "return_1y", "minimum_asc", "management_fee_asc", "relevance"] as const) {
      const filters: DiscoveryFilters = { sort, ...(sort === "relevance" ? { q: "clone" } : {}) };
      const first = await structuredSearch(filters);
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).not.toBeNull();
      const all = [...first.items];
      let cursor = first.nextCursor;
      while (cursor) {
        const page = await structuredSearch({ ...filters, cursor });
        all.push(...page.items);
        cursor = page.nextCursor;
      }
      const slugs = all.map((i) => i.slug);
      expect(new Set(slugs).size, sort).toBe(slugs.length);
      expect(slugs.length, sort).toBe(sort === "relevance" ? 22 : 25);
    }
    await expect(structuredSearch({ cursor: "bm90LWEtY3Vyc29y" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("GET /v1/public/discovery/baskets", () => {
  const encode = (f: object) => Buffer.from(JSON.stringify(f)).toString("base64url");

  it("takes the filters as one base64url JSON param, drops unknown keys and rejects garbage", async () => {
    const res = await request(app).get("/v1/public/discovery/baskets").query({ f: encode({ tags: ["yield"], bogus: 1 }) });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(["Beta Stable"]);
    expect(JSON.stringify(res.body)).not.toMatch(/organizationId|userId|email/);
    expect((await request(app).get("/v1/public/discovery/baskets").query({ f: "!!!" })).status).toBe(400);
    expect((await request(app).get("/v1/public/discovery/baskets").query({ f: encode({ maxSingleWeightBps: 99_999 }) })).status).toBe(400);
    expect((await request(app).get("/v1/public/discovery/baskets")).status).toBe(200);
  });

  it("is rate limited per IP", async () => {
    await redis.flushdb();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await request(app).get("/v1/public/discovery/baskets").set(webHeaders())).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
    await redis.flushdb();
  });
});

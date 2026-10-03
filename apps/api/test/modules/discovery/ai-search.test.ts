import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@repo/logger";
import { discoveryFiltersSchema } from "@repo/validator";
import { app } from "@/app";
import { limits, redis } from "@/middlewares/rate-limit.middleware";
import { embedBasket, refreshSearchIndex, sweepEmbeddings } from "@/modules/discovery/search-index.service";
import { activeInstrument, basketOrg, publishedBasket } from "../baskets/helpers";
import { webHeaders } from "../../helpers/auth";
import { adminSql } from "../../helpers/db";
import { fakes, unitVector } from "../../helpers/fakes";
import { opsUser } from "../manager-applications/helpers";
import { resetOrgDb } from "../organizations/helpers";

// The key is read through `env`, which is frozen: the tests flip it here.
const gemini = vi.hoisted(() => ({ key: "test-gemini-key" }));
vi.mock("@/config/dotenv", async (importOriginal) => {
  const { env } = await importOriginal<typeof import("@/config/dotenv")>();
  return { env: { ...env, get GEMINI_API_KEY() { return gemini.key; } } };
});

const post = (query: string) => request(app).post("/v1/public/discovery/ai-search").set(webHeaders()).send({ query });
const toolFilters = discoveryFiltersSchema.omit({ cursor: true });
const SECRET = "zebra-secret-query-text";
let ids: Record<"alpha" | "beta" | "retired", string>;

beforeAll(async () => {
  await resetOrgDb();
  const ctx = await basketOrg();
  const admin = await opsUser(app, "ops_admin");
  const [a, b] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
  const [alpha, beta, retired] = [await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Alpha"), await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Beta"), await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b, "Retired")];
  ids = { alpha: alpha.id, beta: beta.id, retired: retired.id };
  for (const [bid, name, axis, status] of [[alpha.id, "Alpha Bitcoin", 0, "ACTIVE"], [beta.id, "Beta Stable", 1, "ACTIVE"], [retired.id, "Retired Bitcoin", 0, "RETIRED"]] as const) {
    await refreshSearchIndex(bid);
    await adminSql`UPDATE app.basket_search_index SET name = ${name}, status = ${status}, embedding = ${JSON.stringify(unitVector(axis))}::vector, embedding_status = 'ready',
      tags = ${name.startsWith("Beta") ? ["yield"] : []}, search_text = to_tsvector('english', ${name}) WHERE basket_id = ${bid}`;
  }
});
beforeEach(async () => {
  gemini.key = "test-gemini-key";
  fakes.gemini.search = async () => null;
  fakes.gemini.embedFails = false;
  fakes.gemini.vector = unitVector(0);
  fakes.gemini.searchCalls = [];
  fakes.gemini.embedCalls = [];
  await redis.flushdb();
});

const names = (body: { results: Array<{ name: string }> }) => body.results.map((r) => r.name);

describe("AI search modes", () => {
  it("tool mode returns the filters Gemini used and only database results", async () => {
    let toolResult: unknown;
    fakes.gemini.search = async (_q, runTool) => {
      const args = { tags: ["yield"], sort: "newest" };
      toolResult = await runTool(args);
      return toolFilters.parse(args);
    };
    const res = await post("stable yield baskets");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ mode: "tool", filters: { tags: ["yield"], sort: "newest" } });
    expect(names(res.body)).toEqual(["Beta Stable"]);
    expect(toolResult).toMatchObject({ count: 1, items: [{ name: "Beta Stable" }] });
    expect(fakes.gemini.embedCalls).toEqual([]);
  });

  it("tool arguments with unknown keys are stripped, wrong types are refused and an SQL-looking string stays a plain value", async () => {
    const results: unknown[] = [];
    fakes.gemini.search = async (_q, runTool) => {
      results.push(await runTool({ tags: ["yield"], hack: "x", __proto__: { admin: true } }));
      results.push(await runTool({ maxSingleWeightBps: "lots" }));
      results.push(await runTool({ tags: ["x'; DROP TABLE app.basket_search_index; --"] }));
      results.push(await runTool({ q: "x'); DROP TABLE app.basket_search_index; --" }));
      return null;
    };
    const res = await post("anything");
    expect(results).toMatchObject([{ count: 1 }, { error: "invalid arguments" }, { error: "invalid arguments" }, { count: 0, items: [] }]);
    expect(res.status).toBe(200);
    expect((await adminSql`SELECT count(*)::int AS n FROM app.basket_search_index`)[0]!.n).toBe(3);
    expect(JSON.stringify(res.body)).not.toMatch(/hack|admin/);
  });

  it("falls back to semantic ranking when the tool finds nothing, never returning unlisted baskets", async () => {
    fakes.gemini.search = async (_q, runTool) => {
      await runTool({ q: "nothing matches this" });
      return toolFilters.parse({ q: "nothing matches this" });
    };
    const res = await post("closest in meaning");
    expect(res.body).toMatchObject({ mode: "semantic", filters: null });
    expect(names(res.body)).toEqual(["Alpha Bitcoin", "Beta Stable"]);
    expect(fakes.gemini.embedCalls).toEqual(["closest in meaning"]);
  });

  it("falls back to semantic ranking when Gemini fails", async () => {
    fakes.gemini.search = async () => { throw new Error("gemini 503"); };
    fakes.gemini.vector = unitVector(1);
    const res = await post("stable");
    expect(res.body.mode).toBe("semantic");
    expect(names(res.body)[0]).toBe("Beta Stable");
  });

  it("falls back to keyword search when embedding fails too", async () => {
    fakes.gemini.search = async () => { throw new Error("gemini 503"); };
    fakes.gemini.embedFails = true;
    const res = await post("bitcoin");
    expect(res.body).toMatchObject({ mode: "keyword", filters: null });
    expect(names(res.body)).toEqual(["Alpha Bitcoin"]);
  });

  it("without a key it goes straight to keyword search and calls no provider", async () => {
    gemini.key = "";
    const res = await post("stable");
    expect(res.body.mode).toBe("keyword");
    expect(names(res.body)).toEqual(["Beta Stable"]);
    expect(fakes.gemini.searchCalls).toEqual([]);
    expect(fakes.gemini.embedCalls).toEqual([]);
  });

  it("validates the request body", async () => {
    expect((await post("")).status).toBe(400);
    expect((await post("x".repeat(501))).status).toBe(400);
    expect((await request(app).post("/v1/public/discovery/ai-search").set(webHeaders()).send({ query: "ok", extra: 1 })).status).toBe(400);
  });
});

describe("AI search limits and privacy", () => {
  it("allows 10 requests a minute per IP, then 429", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await post("stable")).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("stops at the global daily cap before calling Gemini", async () => {
    await limits.aiSearchGlobalDay.block("global", 3600);
    const res = await post("stable");
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect(fakes.gemini.searchCalls).toEqual([]);
  });

  it("never logs the query text", async () => {
    const spies = (["info", "warn", "error", "debug", "http"] as const).map((level) => vi.spyOn(logger, level));
    fakes.gemini.search = async () => { throw new Error("gemini 503"); };
    fakes.gemini.embedFails = true;
    await post(SECRET);
    expect(spies.flatMap((s) => s.mock.calls).length).toBeGreaterThan(0);
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain(SECRET);
    spies.forEach((s) => s.mockRestore());
  });
});

describe("embeddings without a key", () => {
  it("embedBasket and the sweep call nothing and leave rows pending", async () => {
    gemini.key = "";
    await adminSql`UPDATE app.basket_search_index SET embedding_status = 'pending' WHERE basket_id = ${ids.alpha}`;
    fakes.queue.jobs = [];
    await embedBasket(ids.alpha);
    await sweepEmbeddings();
    expect(fakes.gemini.embedCalls).toEqual([]);
    expect(fakes.queue.jobs).toEqual([]);
    expect((await adminSql`SELECT embedding_status FROM app.basket_search_index WHERE basket_id = ${ids.alpha}`)[0]!.embedding_status).toBe("pending");
  });
});

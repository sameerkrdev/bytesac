import { beforeEach, describe, expect, it, vi } from "vitest";

const cfg = vi.hoisted(() => ({ key: "test-cmc-key" }));
// The key is read from env at call time; let a test switch it off.
vi.mock("@/config/dotenv", async (importOriginal) => {
  const { env } = await importOriginal<typeof import("@/config/dotenv")>();
  return { env: { ...env, get COINMARKETCAP_API_KEY() { return cfg.key; } } };
});

const { redis } = await import("@/middlewares/rate-limit.middleware");
const { getPrices } = await import("@/services/pricing");
const { resetDb } = await import("../helpers/db");
const { fakes } = await import("../helpers/fakes");
const { get, mkAsset, post, putRef, reviewer } = await import("./helpers");

beforeEach(async () => {
  cfg.key = "test-cmc-key";
  await resetDb();
});

/** Building fixtures renders asset details (which price them): forget those lookups. */
const quiet = async () => { fakes.cmc.calls = []; await redis.flushdb(); };
const quote = (value: string, ageMs = 0) => ({ value, observedAt: new Date(Date.now() - ageMs).toISOString() });
async function withMarket(h: Record<string, string>, cmcId: string, name = `Asset ${cmcId}`) {
  const id = await mkAsset(h, { name, symbol: `S${cmcId}` });
  await putRef(h, id, "market", { externalId: cmcId });
  return id;
}

describe("market prices", () => {
  it("a cache miss makes one batched call for all ids; the next read is served from Redis for 60 s", async () => {
    const r = await reviewer();
    const a = await withMarket(r.h, "1");
    const b = await withMarket(r.h, "1027");
    await quiet();
    fakes.cmc.quotes.set("1", quote("60000.5"));
    fakes.cmc.quotes.set("1027", quote("2500"));
    const first = await getPrices([a, b]);
    expect(fakes.cmc.calls).toEqual([["1", "1027"]]);
    expect(first).toEqual([
      { instrumentId: a, kind: "market", status: "ok", value: "60000.5", currency: "USD", source: "coinmarketcap", observedAt: expect.any(String), stale: false },
      { instrumentId: b, kind: "market", status: "ok", value: "2500", currency: "USD", source: "coinmarketcap", observedAt: expect.any(String), stale: false },
    ]);
    const ttl = await redis.ttl("price:cmc:1");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    expect(await getPrices([a, b])).toEqual(first);
    expect(fakes.cmc.calls).toHaveLength(1);
  });

  it("only uncached ids are requested, and two instruments sharing an id cost one lookup", async () => {
    const r = await reviewer();
    const a = await withMarket(r.h, "1");
    const b = await withMarket(r.h, "1", "Twin");
    const c = await withMarket(r.h, "52");
    await quiet();
    fakes.cmc.quotes.set("1", quote("1"));
    fakes.cmc.quotes.set("52", quote("0.5"));
    await getPrices([a]);
    await getPrices([a, b, c]);
    expect(fakes.cmc.calls).toEqual([["1"], ["52"]]);
  });

  it("without an API key the price is unavailable and no call is made (Review Focus 3)", async () => {
    const r = await reviewer();
    const id = await withMarket(r.h, "1");
    await quiet();
    cfg.key = "";
    fakes.cmc.quotes.set("1", quote("1"));
    expect(await getPrices([id])).toEqual([{ instrumentId: id, kind: "market", status: "unavailable", value: null, currency: "USD", source: "coinmarketcap", observedAt: null, stale: false }]);
    expect(fakes.cmc.calls).toEqual([]);
  });

  it("a provider failure is unavailable, never an error, and is not cached", async () => {
    const r = await reviewer();
    const id = await withMarket(r.h, "1");
    await quiet();
    fakes.cmc.fail = true;
    expect((await getPrices([id]))[0]).toMatchObject({ status: "unavailable", value: null });
    fakes.cmc.fail = false;
    fakes.cmc.quotes.set("1", quote("3"));
    expect((await getPrices([id]))[0]).toMatchObject({ status: "ok", value: "3" });
    // The asset detail (ops) keeps rendering while the provider is down.
    await redis.flushdb();
    fakes.cmc.fail = true;
    const detail = await get(r.h, `/v1/ops/assets/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.prices[0].status).toBe("unavailable");
  });

  it("a Redis read failure is a cache miss, not an error", async () => {
    const r = await reviewer();
    const id = await withMarket(r.h, "1");
    fakes.cmc.quotes.set("1", quote("7"));
    vi.spyOn(redis, "mget").mockRejectedValueOnce(new Error("redis down"));
    expect((await getPrices([id]))[0]).toMatchObject({ status: "ok", value: "7" });
  });

  it("an id the provider does not return is unavailable for that instrument only", async () => {
    const r = await reviewer();
    const a = await withMarket(r.h, "1");
    const b = await withMarket(r.h, "999");
    await quiet();
    fakes.cmc.quotes.set("1", quote("1"));
    expect((await getPrices([a, b])).map((p) => p.status)).toEqual(["ok", "unavailable"]);
  });

  it("an id answered without a usable price is cached as unavailable; the others stay ok and cached", async () => {
    const r = await reviewer();
    const a = await withMarket(r.h, "1");
    const b = await withMarket(r.h, "999");
    await quiet();
    fakes.cmc.quotes.set("1", quote("1"));
    expect((await getPrices([a, b])).map((p) => p.status)).toEqual(["ok", "unavailable"]);
    expect(await redis.get("price:cmc:999")).toBe("null");
    expect((await redis.ttl("price:cmc:1"))).toBeGreaterThan(0);
    expect((await getPrices([a, b])).map((p) => p.status)).toEqual(["ok", "unavailable"]);
    expect(fakes.cmc.calls).toEqual([["1", "999"]]);
  });

  it("a quote observed more than 5 minutes ago is stale", async () => {
    const r = await reviewer();
    const a = await withMarket(r.h, "1");
    const b = await withMarket(r.h, "2");
    await quiet();
    fakes.cmc.quotes.set("1", quote("1", 6 * 60_000));
    fakes.cmc.quotes.set("2", quote("2", 60_000));
    expect((await getPrices([a, b])).map((p) => p.stale)).toEqual([true, false]);
  });

  it("only ACTIVE references are priced; no ids means no work", async () => {
    const r = await reviewer();
    const id = await withMarket(r.h, "1");
    await putRef(r.h, id, "market", { externalId: "2" });
    await quiet();
    fakes.cmc.quotes.set("1", quote("1"));
    fakes.cmc.quotes.set("2", quote("2"));
    expect(await getPrices([id])).toHaveLength(1);
    expect(fakes.cmc.calls).toEqual([["2"]]);
    expect(await getPrices([])).toEqual([]);
  });
});

describe("NAV", () => {
  const nav = (asOf: string, value: string) => ({ value, asOf, sourceUrl: "https://issuer.example/nav" });

  it("the latest as-of date wins regardless of entry order, and NAV sits beside the market price", async () => {
    const r = await reviewer();
    const id = await withMarket(r.h, "1");
    await putRef(r.h, id, "nav");
    await post(r.h, `/v1/ops/assets/${id}/nav`, nav("2026-09-29", "101.50"));
    await post(r.h, `/v1/ops/assets/${id}/nav`, nav("2026-09-28", "100.25"));
    await quiet();
    fakes.cmc.quotes.set("1", quote("99"));
    const prices = await getPrices([id]);
    expect(prices).toHaveLength(2);
    expect(prices.find((p) => p.kind === "market")).toMatchObject({ status: "ok", value: "99", source: "coinmarketcap" });
    expect(prices.find((p) => p.kind === "nav")).toEqual({ instrumentId: id, kind: "nav", status: "ok", value: "101.50", currency: "USD", source: "issuer", observedAt: "2026-09-29", stale: false });
  });

  it("the same as-of date takes the latest entry; a NAV reference without entries is unavailable", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { name: "Fund", symbol: "FND", assetType: "TOKENIZED_FUND" });
    await putRef(r.h, id, "nav");
    await quiet();
    expect((await getPrices([id]))[0]).toMatchObject({ kind: "nav", status: "unavailable", value: null, observedAt: null });
    await post(r.h, `/v1/ops/assets/${id}/nav`, nav("2026-09-29", "10"));
    await post(r.h, `/v1/ops/assets/${id}/nav`, nav("2026-09-29", "11"));
    expect((await getPrices([id]))[0]).toMatchObject({ status: "ok", value: "11" });
    expect(fakes.cmc.calls).toEqual([]);
  });

  it("an old reference's observations are not shown after it is replaced", async () => {
    const r = await reviewer();
    const id = await mkAsset(r.h, { name: "Fund", symbol: "FND", assetType: "TOKENIZED_FUND" });
    await putRef(r.h, id, "nav");
    await post(r.h, `/v1/ops/assets/${id}/nav`, nav("2026-09-29", "10"));
    await putRef(r.h, id, "nav");
    expect((await getPrices([id]))[0]).toMatchObject({ status: "unavailable" });
  });

  it("the ops prices route returns the same view", async () => {
    const r = await reviewer();
    const id = await withMarket(r.h, "1");
    await quiet();
    fakes.cmc.quotes.set("1", quote("5"));
    const res = await get(r.h, `/v1/ops/assets/${id}/prices`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({ instrumentId: id, kind: "market", status: "ok", value: "5" })]);
    expect((await get(r.h, `/v1/ops/assets/${crypto.randomUUID()}/prices`)).status).toBe(404);
  });
});

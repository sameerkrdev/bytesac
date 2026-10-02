import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { activeInstrument, basketOrg, publishedBasket } from "../baskets/helpers";
import { opsUser } from "../managers/helpers";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { orgWithOwner } from "../members/helpers";

const bull = vi.hoisted(() => ({ workers: [] as Array<{ name: string }>, schedulers: new Map<string, unknown>() }));
vi.mock("bullmq", () => ({
  Worker: class {
    name: string;
    constructor(name: string) { this.name = name; bull.workers.push(this); }
    on() { return this; }
    close = async () => undefined;
  },
}));
vi.mock("../../src/queues", () => ({
  queues: Object.fromEntries(["price-snapshot", "embed-basket", "track-leg", "reconcile-positions", "gas-wallet-check", "revenue-reconcile"].map((name) => [name, { upsertJobScheduler: async (id: string, repeat: unknown, template: unknown) => { bull.schedulers.set(id, { repeat, template }); }, close: async () => undefined }])),
  enqueue: async (name: string, data: Record<string, unknown>) => { fakes.queue.jobs.push({ name, data }); },
}));

const { startWorker } = await import("../../src/worker");
const { runPriceSnapshot } = await import("../../src/services/performance");

beforeEach(async () => {
  bull.workers.length = 0;
  bull.schedulers.clear();
  await resetDb();
});

describe("worker start", () => {
  it("registers the repeatable job under one fixed id, even when started twice", async () => {
    await startWorker();
    await startWorker();
    expect([...bull.schedulers.keys()].sort()).toEqual(["embed-sweep", "gas-wallet-check-15m", "price-snapshot-daily", "reconcile-positions-nightly", "revenue-reconcile-daily", "track-claims-sweep"]);
    expect(bull.schedulers.get("price-snapshot-daily")).toMatchObject({ repeat: { pattern: "5 0 * * *", tz: "UTC" } });
    expect(bull.schedulers.get("embed-sweep")).toMatchObject({ repeat: { every: 900_000 }, template: { name: "sweep" } });
    expect(bull.schedulers.get("reconcile-positions-nightly")).toMatchObject({ repeat: { pattern: "30 2 * * *", tz: "UTC" } });
    expect(bull.schedulers.get("gas-wallet-check-15m")).toMatchObject({ repeat: { every: 900_000 } });
    expect(bull.schedulers.get("revenue-reconcile-daily")).toMatchObject({ repeat: { pattern: "0 4 * * *", tz: "UTC" } });
    expect(bull.workers.map((w) => w.name).slice(0, 7)).toEqual(["price-snapshot", "basket-performance", "search-index-refresh", "embed-basket", "track-leg", "reconcile-positions", "gas-wallet-check"]);
  });
});

describe("runPriceSnapshot", () => {
  async function market(cmcId: string) {
    const owner = await orgWithOwner(app);
    const id = await activeInstrument(owner.userId);
    await adminSql`INSERT INTO app.price_references (id, instrument_id, kind, provider, external_id) VALUES (gen_random_uuid(), ${id}, 'market', 'coinmarketcap', ${cmcId})`;
    return id;
  }
  const today = new Date().toISOString().slice(0, 10);

  it("stores one price per instrument and day, idempotently, then asks for performance", async () => {
    const id = await market("1");
    fakes.cmc.quotes.set("1", { value: "65000.5", observedAt: new Date().toISOString() });
    await runPriceSnapshot();
    fakes.cmc.quotes.set("1", { value: "70000", observedAt: new Date().toISOString() });
    await runPriceSnapshot();
    const rows = await adminSql`SELECT day::text, price_usd::text, source FROM app.instrument_price_snapshots WHERE instrument_id = ${id}`;
    expect(rows).toEqual([{ day: today, price_usd: "65000.5", source: "coinmarketcap" }]);
    expect(fakes.queue.jobs.filter((j) => j.name === "basket-performance")).toHaveLength(2);
  });

  it("also prices a PAUSED instrument held by a published basket, but not an unheld one", async () => {
    const ctx = await basketOrg();
    const admin = await opsUser(app, "ops_admin");
    const [held, other, pausedUnheld] = [await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId), await activeInstrument(ctx.owner.userId)];
    await publishedBasket(ctx.owner, ctx.owner.id, admin, held, other);
    for (const [k, id] of [held, other, pausedUnheld].entries()) {
      await adminSql`INSERT INTO app.price_references (id, instrument_id, kind, provider, external_id) VALUES (gen_random_uuid(), ${id}, 'market', 'coinmarketcap', ${String(10 + k)})`;
      fakes.cmc.quotes.set(String(10 + k), { value: "1", observedAt: new Date().toISOString() });
    }
    await adminSql`UPDATE app.instruments SET status = 'PAUSED' WHERE id IN (${held}, ${pausedUnheld})`;
    await runPriceSnapshot();
    const rows = await adminSql<{ instrument_id: string }[]>`SELECT instrument_id FROM app.instrument_price_snapshots`;
    expect(rows.map((r) => r.instrument_id).sort()).toEqual([held, other].sort());
  });

  it("skips instruments the provider returned nothing for", async () => {
    await market("2");
    await runPriceSnapshot();
    expect(await adminSql`SELECT 1 FROM app.instrument_price_snapshots`).toHaveLength(0);
  });

  it("writes nothing and throws when the provider fails, so BullMQ retries", async () => {
    await market("3");
    fakes.cmc.fail = true;
    await expect(runPriceSnapshot()).rejects.toThrow("coinmarketcap down");
    expect(await adminSql`SELECT 1 FROM app.instrument_price_snapshots`).toHaveLength(0);
    expect(fakes.queue.jobs).toEqual([]);
  });
});

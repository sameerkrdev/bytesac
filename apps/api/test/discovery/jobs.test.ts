import { beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { activeInstrument } from "../baskets/helpers";
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
  queues: { "price-snapshot": { upsertJobScheduler: async (id: string, repeat: unknown, template: unknown) => { bull.schedulers.set(id, { repeat, template }); }, close: async () => undefined } },
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
    expect([...bull.schedulers.keys()]).toEqual(["price-snapshot-daily"]);
    expect(bull.schedulers.get("price-snapshot-daily")).toMatchObject({ repeat: { pattern: "5 0 * * *", tz: "UTC" } });
    expect(bull.workers.map((w) => w.name)).toEqual(["price-snapshot", "basket-performance", "price-snapshot", "basket-performance"]);
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

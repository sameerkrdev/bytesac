import request from "supertest";
import { PERFORMANCE_LABEL } from "@repo/validator";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app";
import { runBasketPerformance } from "../../src/services/performance";
import { activeInstrument, approvedBasket, basketOrg, decideBasket, decision, post, publishBasket, publishedBasket, saveOpen, submitBasket } from "../baskets/helpers";
import { adminSql } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { opsUser } from "../managers/helpers";
import { resetOrgDb } from "../organizations/helpers";
import { performanceRows, setPublishedAt, snapshots } from "./helpers";

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
beforeEach(async () => {
  await adminSql`TRUNCATE app.basket_performance_days, app.instrument_price_snapshots`;
  fakes.queue.jobs = [];
});

/** A published 60/40 basket whose version 1 went live on 2026-03-01. */
async function live() {
  const r = await publishedBasket(ctx.owner, ctx.owner.id, admin, a, b);
  await setPublishedAt(r.vid, "2026-03-01T10:00:00Z");
  fakes.queue.jobs = [];
  return r;
}
const prices = async (pa: Array<string | null>, pb: Array<string | null>) => { await snapshots(a, "2026-03-01", pa); await snapshots(b, "2026-03-01", pb); };

describe("runBasketPerformance", () => {
  it("computes each snapshot day from launch, then only the new days on a rerun", async () => {
    const r = await live();
    await prices(["10", "20", "20"], ["5", "5", "5"]);
    await runBasketPerformance();
    const rows = await performanceRows(r.id);
    expect(rows.map((x) => x.day)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(rows.map((x) => x.index_gross)).toEqual(["100.000000000000000000", "160.000000000000000000", "160.000000000000000000"]);
    expect(fakes.queue.jobs).toEqual([{ name: "search-index-refresh", data: { basketId: r.id } }]);

    await runBasketPerformance();
    expect(await performanceRows(r.id)).toHaveLength(3);
    await snapshots(a, "2026-03-04", ["40"]);
    await snapshots(b, "2026-03-04", ["5"]);
    await runBasketPerformance(r.id);
    const after = await performanceRows(r.id);
    expect(after).toHaveLength(4);
    expect(after[3]!.index_gross).toBe("280.000000000000000000"); // 120 * 2 + 40
  });

  it("resets to the new weights on the day version 2 is published", async () => {
    const r = await live();
    await post(ctx.owner.h, `/v1/baskets/${r.id}/versions`);
    const v2 = (await adminSql<{ id: string }[]>`SELECT id FROM app.basket_versions WHERE basket_id = ${r.id} AND status = 'draft'`)[0]!.id;
    await saveOpen(ctx.owner.h, r.id, { rationale: "Rotate", assets: [{ instrumentId: a, targetWeightBps: 7000 }, { instrumentId: b, targetWeightBps: 3000 }] });
    await submitBasket(ctx.owner.h, r.id);
    await decideBasket(admin.h, r.id, v2, decision("approved"));
    expect((await publishBasket(ctx.owner.h, r.id)).status).toBe(200);
    await setPublishedAt(v2, "2026-03-03T10:00:00Z");
    await prices(["10", "20", "20"], ["5", "5", "5"]);
    await runBasketPerformance();
    const rows = await performanceRows(r.id);
    expect(rows[1]!.version_id).toBe(r.vid);
    expect(rows[2]!.version_id).toBe(v2);
    expect(rows[2]!.index_gross).toBe("160.000000000000000000");
    expect(rows[2]!.holdings.gross).toEqual({ [a]: "112.000000000000000000", [b]: "48.000000000000000000" });
  });

  it("stops at the retirement day of an approved retirement request", async () => {
    const r = await live();
    expect((await post(ctx.owner.h, `/v1/baskets/${r.id}/retirement-request`, { reason: "Winding down" })).status).toBe(200);
    expect((await post(admin.h, `/v1/ops/baskets/${r.id}/retirement/decision`, { decision: "approved" })).status).toBe(200);
    await adminSql`UPDATE app.basket_events SET created_at = '2026-03-02T12:00:00Z' WHERE basket_id = ${r.id} AND to_status = 'RETIRED'`;
    await prices(["10", "20", "20"], ["5", "5", "5"]);
    await runBasketPerformance();
    expect((await performanceRows(r.id)).map((x) => x.day)).toEqual(["2026-03-01", "2026-03-02"]);
  });

  it("re-queues the search index of every listed basket, even one without new rows", async () => {
    const r = await live();
    await runBasketPerformance();
    expect(fakes.queue.jobs).toContainEqual({ name: "search-index-refresh", data: { basketId: r.id } }); // no snapshots at all yet
    await prices(["10"], ["5"]);
    fakes.queue.jobs = [];
    await runBasketPerformance();
    await runBasketPerformance();
    expect(fakes.queue.jobs.filter((j) => j.data.basketId === r.id)).toHaveLength(2); // the second run computes nothing new, still refreshes
  });

  it("ignores baskets that were never published and does nothing without snapshots", async () => {
    const draft = await approvedBasket(ctx.owner, ctx.owner.id, admin, a, b);
    await runBasketPerformance();
    await prices(["10"], ["5"]);
    await runBasketPerformance();
    expect(await performanceRows(draft.id)).toEqual([]);
  });

  it("flags a day without a price and keeps the last one", async () => {
    const r = await live();
    await prices(["10", null, "20"], ["5", "5", "5"]);
    await runBasketPerformance();
    const rows = await performanceRows(r.id);
    expect(rows.map((x) => x.gap)).toEqual([false, true, false]);
    expect(rows[1]!.index_gross).toBe("100.000000000000000000");
    expect(rows[2]!.index_gross).toBe("160.000000000000000000");
  });

  it("the public basket page carries the series, metrics, sectors and the simulated-performance label", async () => {
    const r = await live();
    await prices(["10", "20", "20"], ["5", "5", "5"]);
    await runBasketPerformance();
    const slug = (await adminSql<{ slug: string }[]>`SELECT slug FROM app.baskets WHERE id = ${r.id}`)[0]!.slug;
    const res = await request(app).get(`/v1/public/baskets/${slug}`);
    expect(res.status).toBe(200);
    expect(res.body.label).toBe(PERFORMANCE_LABEL);
    expect(res.body.performance.series.map((p: { day: string; net: string; gross: string }) => p.day)).toEqual(["2026-03-01", "2026-03-02", "2026-03-03"]);
    expect(res.body.performance).toMatchObject({ available: false, dataDays: 3 }); // the series ends long before today
    expect(res.body.metrics.net.sinceLaunch).toBe("0.600000");
    expect(res.body.sectors.reduce((sum: number, x: { bps: number }) => sum + x.bps, 0)).toBe(10_000);
    expect(res.body.tags).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/holdings|gapRun/);
  });
});

import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { adminSql, resetDb } from "../../helpers/db";
import { admin, plainUser, reviewer } from "../assets/helpers";
import { seedBasket } from "../../helpers/execution";

type H = Record<string, string>;
const save = (h: H, body: object) => request(app).post("/v1/ops/fees").set(h).send({ operationKind: "invest", bps: 25, reason: "launch rate", ...body });
const override = (h: H, body: object) => request(app).post("/v1/ops/fees/overrides").set(h).send({ operationKind: "invest", bps: 10, reason: "partner deal", ...body });
const active = () => adminSql<{ id: string; scope: string; bps: number }[]>`SELECT id, scope, bps FROM app.platform_fee_schedules WHERE superseded_at IS NULL ORDER BY created_at`;
const publicRate = async (slug: string) => {
  const res = await request(app).get(`/v1/public/baskets/${slug}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.platformFee.find((r: { operationKind: string }) => r.operationKind === "invest");
};
const future = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

beforeEach(resetDb);

describe("platform fee schedules (ops)", () => {
  it("ops_admin saves a default: the previous row is superseded in the same step and the change is audited with its reason", async () => {
    const ops = await admin();
    const first = await save(ops.h, {});
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ scope: "default", scopeId: null, operationKind: "invest", bps: 25, reason: "launch rate", supersededAt: null });
    const second = await save(ops.h, { bps: 40, minUsdc: "0.1", maxUsdc: "50", reason: "raised" });
    expect(second.body).toMatchObject({ bps: 40, minUsdc: "0.1", maxUsdc: "50" });
    expect(await active()).toEqual([expect.objectContaining({ id: second.body.id, bps: 40 })]);
    expect(await adminSql`SELECT 1 FROM app.platform_fee_schedules WHERE superseded_at IS NOT NULL`).toHaveLength(1);
    const audit = await adminSql<{ metadata: { reason: string; supersededId: string | null } }[]>`SELECT metadata FROM app.audit_events WHERE action = 'platform_fee.updated' ORDER BY created_at`;
    expect(audit.map((a) => [a.metadata.reason, a.metadata.supersededId])).toEqual([["launch rate", null], ["raised", first.body.id]]);
    const list = await request(app).get("/v1/ops/fees").set(ops.h);
    expect(list.body.items.map((r: { bps: number }) => r.bps)).toEqual([40, 25]);
  });

  it("ops_reviewer reads but cannot save; a plain user gets 403", async () => {
    const rev = await reviewer();
    expect((await save(rev.h, {})).status).toBe(403);
    expect((await request(app).get("/v1/ops/fees").set(rev.h)).status).toBe(200);
    expect((await request(app).get("/v1/ops/fees/overrides").set(rev.h)).status).toBe(200);
    expect((await override(rev.h, { scope: "basket", scopeId: "0198a1b2-0000-7000-8000-000000000001" })).status).toBe(403);
    expect((await save((await plainUser()).h, {})).status).toBe(403);
    expect(await active()).toHaveLength(0);
  });

  it("rejects a minimum above the maximum, a missing reason and a past end date", async () => {
    const ops = await admin();
    expect((await save(ops.h, { minUsdc: "10", maxUsdc: "1" })).body.error.code).toBe("VALIDATION_FAILED");
    expect((await save(ops.h, { reason: "" })).body.error.code).toBe("VALIDATION_FAILED");
    expect((await save(ops.h, { bps: 101 })).body.error.code).toBe("VALIDATION_FAILED");
    const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10_000 }] });
    const past = await override(ops.h, { scope: "basket", scopeId: basket.basketId, endsAt: "2020-01-01T00:00:00Z" });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe("VALIDATION_FAILED");
    expect((await override(ops.h, { scope: "basket", scopeId: "0198a1b2-0000-7000-8000-000000000001" })).status).toBe(404);
    expect(await active()).toHaveLength(0);
  });

  it("resolution order is visible on the public basket: basket override, then organization override, then the default", async () => {
    const ops = await admin();
    const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10_000 }] });
    await save(ops.h, {});
    expect(await publicRate(basket.slug)).toEqual({ operationKind: "invest", bps: 25, minUsdc: null, maxUsdc: null });
    const org = await override(ops.h, { scope: "organization", scopeId: basket.owner.id, bps: 10, endsAt: future() });
    expect((await publicRate(basket.slug)).bps).toBe(10);
    const own = await override(ops.h, { scope: "basket", scopeId: basket.basketId, bps: 5 });
    expect((await publicRate(basket.slug)).bps).toBe(5);

    const ended = await request(app).post(`/v1/ops/fees/overrides/${own.body.id}/end`).set(ops.h);
    expect(ended.status).toBe(200);
    expect(ended.body.supersededAt).not.toBeNull();
    expect((await publicRate(basket.slug)).bps).toBe(10);
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'platform_fee.override_ended' AND entity_id = ${own.body.id}`).toHaveLength(1);
    expect((await request(app).post(`/v1/ops/fees/overrides/${own.body.id}/end`).set(ops.h)).status).toBe(409);
    await request(app).post(`/v1/ops/fees/overrides/${org.body.id}/end`).set(ops.h);
    expect((await publicRate(basket.slug)).bps).toBe(25);
    const defaultRow = (await active()).find((r) => r.scope === "default")!;
    expect((await request(app).post(`/v1/ops/fees/overrides/${defaultRow.id}/end`).set(ops.h)).body.error.code).toBe("VALIDATION_FAILED");
    expect((await request(app).get("/v1/ops/fees/overrides").set(ops.h)).body.items).toHaveLength(2);
  });

  it("an expired override stops applying", async () => {
    const ops = await admin();
    const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10_000 }] });
    await save(ops.h, {});
    await override(ops.h, { scope: "basket", scopeId: basket.basketId, bps: 5, endsAt: future() });
    await adminSql`UPDATE app.platform_fee_schedules SET ends_at = now() - interval '1 minute' WHERE scope = 'basket'`;
    expect((await publicRate(basket.slug)).bps).toBe(25);
  });

  it("concurrent saves for one key leave exactly one active row", async () => {
    const ops = await admin();
    const results = await Promise.all([1, 2, 3, 4, 5].map((bps) => save(ops.h, { bps })));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await active()).toHaveLength(1);
    expect(await adminSql`SELECT 1 FROM app.platform_fee_schedules`).toHaveLength(5);
  });

  it("GET /v1/public/fees returns the active defaults only, with no reasons and no overrides", async () => {
    const ops = await admin();
    const basket = await seedBasket({ assets: [{ symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10_000 }] });
    await save(ops.h, {});
    await save(ops.h, { bps: 30 });
    await save(ops.h, { operationKind: "repair", bps: 0, reason: "free" });
    await override(ops.h, { scope: "basket", scopeId: basket.basketId, bps: 1 });
    const res = await request(app).get("/v1/public/fees");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ platform: [{ operationKind: "invest", bps: 30, minUsdc: null, maxUsdc: null }, { operationKind: "repair", bps: 0, minUsdc: null, maxUsdc: null }] });
    expect(JSON.stringify(res.body)).not.toMatch(/reason|launch|free/);
  });
});

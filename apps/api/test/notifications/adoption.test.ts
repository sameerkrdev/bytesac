import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import { adminSql, resetDb } from "../helpers/db";
import { mockChains, solanaTestWallet } from "../execution/chain-mocks";
import { seedBasket, seedPosition, seedUser, seedVersion } from "../execution/helpers";
import { user as plainUser } from "../modules/organizations/helpers";

const SOL = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 } as const;
const TKN = { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 5000, decimals: 6 } as const;

beforeEach(async () => { await resetDb(); mockChains(); });

/** `total` open positions on version 1: `applied` of them applied version 2, `skipped` skipped it, `planned` have a rebalance to it open; the rest have not responded. */
async function adoptionOf(counts: { total: number; applied: number; skipped: number; planned: number }) {
  const basket = await seedBasket({ assets: [SOL, TKN] });
  const v2 = await seedVersion(basket, 2, [3000, 7000]);
  const hold = [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 1_000_000_000n }];
  for (let i = 0; i < counts.total; i++) {
    const u = await seedUser({ wallet: solanaTestWallet() });
    const positionId = await seedPosition(u.userId, basket, hold);
    if (i < counts.applied) await adminSql`UPDATE app.basket_positions SET applied_version_id = ${v2} WHERE id = ${positionId}`;
    else if (i < counts.applied + counts.skipped) await adminSql`INSERT INTO app.position_decisions (id, position_id, kind, version_id, data, actor_user_id) VALUES (gen_random_uuid(), ${positionId}, 'skip', ${v2}, '{}'::jsonb, ${u.userId})`;
    else if (i < counts.applied + counts.skipped + counts.planned) {
      await adminSql`INSERT INTO app.operations (id, user_id, basket_id, position_id, kind, status, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
        VALUES (gen_random_uuid(), ${u.userId}, ${basket.basketId}, ${positionId}, 'rebalance', 'IN_PROGRESS', 100, 10000, ${v2}, ${"k-" + i}, now() + interval '30 minutes')`;
    }
  }
  return { basket, v2 };
}

describe("GET /v1/baskets/:id/adoption", () => {
  it("counts per published version; 1 to 4 show as '<5', zero stays 0, and nothing identifies a holder", async () => {
    const { basket, v2 } = await adoptionOf({ total: 12, applied: 5, skipped: 3, planned: 1 });
    const res = await request(app).get(`/v1/baskets/${basket.basketId}/adoption`).set(basket.owner.h);
    expect(res.status).toBe(200);
    // Version 2: the 12 open positions hold it or something older; 5 applied it, 3 skipped it, 1 is mid-rebalance, 3 have not responded.
    expect(res.body.versions.find((v: { versionId: string }) => v.versionId === v2)).toMatchObject({ versionNumber: 2, openPositions: 12, applied: 5, skipped: "<5", inProgress: "<5", notResponded: "<5" });
    // Version 1: the 7 positions still on it.
    expect(res.body.versions.find((v: { versionNumber: number }) => v.versionNumber === 1)).toMatchObject({ openPositions: 7, applied: 7, skipped: 0, inProgress: 0, notResponded: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/userId|user_id|wallet|address/i);
  });

  it("a non-member is refused", async () => {
    const { basket } = await adoptionOf({ total: 1, applied: 0, skipped: 0, planned: 0 });
    const stranger = await plainUser(app, false);
    const res = await request(app).get(`/v1/baskets/${basket.basketId}/adoption`).set(stranger.h);
    expect([403, 404]).toContain(res.status);
  });
});

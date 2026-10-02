import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { reconcilePositions } from "../../src/services/positions";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet } from "./chain-mocks";
import { USDC_MINT, seedBasket, seedCash, seedPosition, seedPrices, seedUser, type SeedAsset } from "./helpers";

// One ERC-20 held by two baskets of one user: A records 10, B records 15, the wallet holds 10 (shortfall 6 and 9).
const ERC20 = { symbol: "TKN", chain: "ethereum", tokenStandard: "erc20", decimals: 6, bps: 10_000 } as const;
type H = Record<string, string>;
const sync = (h: H, body: object) => request(app).post("/v1/portfolio/sync").set(h).send({ idempotencyKey: "sync-aaaaaaaa", ...body });

async function arrange() {
  const chain = mockChains();
  const [basketA, basketB] = [await seedBasket({ assets: [ERC20] }), await seedBasket({ assets: [ERC20] })];
  const user = await seedUser({ wallet: solanaTestWallet() });
  const shared = basketA.deployments[0]!;
  const pA = await seedPosition(user.userId, basketA, [{ deploymentId: shared.deploymentId, quantity: 10n }]);
  const pB = await seedPosition(user.userId, basketB, [{ deploymentId: shared.deploymentId, quantity: 15n }]);
  const setWallet = (n: bigint) => fakes.evm.balances.set(`ethereum:${user.evmAddress}:${shared.address}`, n);
  setWallet(10n);
  await reconcilePositions(user.userId); // what the portfolio showed when the user opened the form
  return { chain, user, shared, pA, pB, setWallet, basketA, basketB };
}
const latest = async (positionId: string) => (await adminSql<{ status: string; ledger_quantity: string }[]>`SELECT status, ledger_quantity FROM app.position_reconciliations WHERE position_id = ${positionId} AND deployment_id IS NOT NULL ORDER BY checked_at DESC, id DESC LIMIT 1`)[0]!;
const decisions = (kind: string) => adminSql<{ position_id: string; data: Record<string, unknown> }[]>`SELECT position_id, data FROM app.position_decisions WHERE kind = ${kind} ORDER BY created_at, id`;

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("sync", () => {
  it("an exact split writes negative sync ledger entries, decisions and audit; the latest reconciliation then shows OK", async () => {
    const { user, shared, pA, pB } = await arrange();
    const res = await sync(user.h, { asset: { deploymentId: shared.deploymentId }, split: [{ positionId: pA, quantity: "10" }, { positionId: pB, quantity: "5" }] }); // the user's own split, not pro-rata
    expect(res.status).toBe(200);
    expect(res.body.synced).toEqual(expect.arrayContaining([{ positionId: pA, quantity: "10" }, { positionId: pB, quantity: "5" }]));
    const entries = await adminSql<{ position_id: string; quantity_delta: string; decision_id: string | null; leg_id: string | null }[]>`SELECT * FROM app.position_ledger_entries WHERE reason = 'sync' ORDER BY quantity_delta`;
    expect(entries.map((e) => [e.position_id, e.quantity_delta, e.leg_id, e.decision_id !== null])).toEqual([[pA, "-10", null, true], [pB, "-5", null, true]]);
    expect(await decisions("sync")).toHaveLength(2);
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'position.synced'`).toHaveLength(2);
    expect(await latest(pA)).toMatchObject({ status: "OK", ledger_quantity: "0" });
    expect(await latest(pB)).toMatchObject({ status: "OK", ledger_quantity: "10" });
  });

  it("the same key returns the earlier result without writing again", async () => {
    const { user, shared, pA, pB } = await arrange();
    const body = { asset: { deploymentId: shared.deploymentId }, split: [{ positionId: pA, quantity: "6" }, { positionId: pB, quantity: "9" }] };
    const first = await sync(user.h, body);
    const again = await sync(user.h, body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await decisions("sync")).toHaveLength(2);
    expect((await sync(user.h, { ...body, split: [{ positionId: pA, quantity: "7" }, { positionId: pB, quantity: "8" }] })).status).toBe(400);
  });

  it("a quantity above what the basket records, or a basket listed twice, is VALIDATION_FAILED against unchanged figures", async () => {
    const { user, shared, pA, pB } = await arrange();
    const asset = { deploymentId: shared.deploymentId };
    const bad = [
      [{ positionId: pA, quantity: "11" }, { positionId: pB, quantity: "4" }], // more than A records
      [{ positionId: pA, quantity: "6" }, { positionId: pA, quantity: "9" }],
    ];
    for (const split of bad) {
      const res = await sync(user.h, { asset, split });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
    }
    expect(await decisions("sync")).toHaveLength(0);
  });

  it("a split that does not match the shortfall (another total, an omitted or a foreign position) is SHORTFALL_CHANGED with the figures", async () => {
    const { user, shared, pA, pB } = await arrange();
    const asset = { deploymentId: shared.deploymentId };
    const bad = [
      [{ positionId: pA, quantity: "6" }, { positionId: pB, quantity: "8" }],
      [{ positionId: pA, quantity: "10" }],
      [{ positionId: pA, quantity: "6" }, { positionId: "0190f3a0-0000-7000-8000-000000000001", quantity: "9" }],
    ];
    for (const split of bad) {
      const res = await sync(user.h, { asset, split });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SHORTFALL_CHANGED");
      expect(res.body.error.details.totalShortfall).toBe("15");
    }
    expect(await decisions("sync")).toHaveLength(0);
  });

  it("the shortfall changed since the form: SHORTFALL_CHANGED with the fresh figures, nothing written (Review Focus 5)", async () => {
    const { user, shared, pA, pB, setWallet } = await arrange();
    setWallet(5n); // more left the wallet after the form was opened: 20 short, not 15
    const res = await sync(user.h, { asset: { deploymentId: shared.deploymentId }, split: [{ positionId: pA, quantity: "6" }, { positionId: pB, quantity: "9" }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SHORTFALL_CHANGED");
    expect(res.body.error.details.totalShortfall).toBe("20");
    expect(res.body.error.details.positions).toEqual(expect.arrayContaining([{ positionId: pA, ledger: "10", shortfall: "8" }, { positionId: pB, ledger: "15", shortfall: "12" }]));
    expect(await decisions("sync")).toHaveLength(0);
    expect(await adminSql`SELECT 1 FROM app.position_ledger_entries WHERE reason = 'sync'`).toHaveLength(0);
  });

  it("a reconciliation between opening the form and saving (a portfolio read) does not hide the change: still SHORTFALL_CHANGED", async () => {
    const { user, shared, pA, pB, setWallet } = await arrange();
    setWallet(5n);
    await reconcilePositions(user.userId); // what a portfolio refetch does: the stored rows now hold the new figures
    const res = await sync(user.h, { asset: { deploymentId: shared.deploymentId }, split: [{ positionId: pA, quantity: "6" }, { positionId: pB, quantity: "9" }] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SHORTFALL_CHANGED");
    expect(res.body.error.details.totalShortfall).toBe("20");
    expect(await decisions("sync")).toHaveLength(0);
  });

  it("basket cash that left the wallet is synced with negative cash entries", async () => {
    const { chain, user, shared, pA, pB, basketA, basketB } = await arrange();
    await seedCash(user.userId, basketA, pA, 100_000_000n);
    await seedCash(user.userId, basketB, pB, 50_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 60_000_000n); // 60 USDC left of the 150 the baskets record: 90 short, 60 and 30 pro-rata
    await reconcilePositions(user.userId); // what the portfolio showed when the user opened the form
    const res = await sync(user.h, { asset: "cash", split: [{ positionId: pA, quantity: "60000000" }, { positionId: pB, quantity: "30000000" }] });
    expect(res.status).toBe(200);
    const rows = await adminSql<{ position_id: string; amount_micro: string; reason: string }[]>`SELECT position_id, amount_micro, reason FROM app.position_cash_entries WHERE reason = 'sync' ORDER BY amount_micro`;
    expect(rows.map((r) => [r.position_id, r.amount_micro])).toEqual([[pA, "-60000000"], [pB, "-30000000"]]);
    void shared;
  });

  it("another user's wallet shortfall is not reachable: a split naming only foreign positions is refused", async () => {
    const { shared, pA } = await arrange();
    const stranger = await seedUser({ wallet: solanaTestWallet() });
    const res = await sync(stranger.h, { asset: { deploymentId: shared.deploymentId }, split: [{ positionId: pA, quantity: "6" }] });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ totalShortfall: "0", positions: [] }); // nothing of another user's is shown
    expect(await decisions("sync")).toHaveLength(0);
  });
});

describe("skip, keep custom, revert", () => {
  const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 };
  const TKN: SeedAsset = { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 5000, decimals: 6 };

  async function holder() {
    const chain = mockChains();
    const basket = await seedBasket({ assets: [SOL, TKN] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    await seedPrices(basket.deployments, ["100", "1"]);
    const [sol, tkn] = basket.deployments;
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: sol!.deploymentId, quantity: 10_000_000_000n }, { deploymentId: tkn!.deploymentId, quantity: 1_000_000_000n }]);
    chain.balances.set(balanceKey(user.solanaAddress, null), 10_000_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, tkn!.address), 1_000_000_000n);
    return { chain, basket, user, positionId, sol: sol! };
  }
  const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);

  it("skip refuses the applied version and a version that is not the current one", async () => {
    const { user, positionId, basket } = await holder();
    const applied = await post(user.h, `/v1/positions/${positionId}/skip`, { versionId: basket.versionId });
    expect(applied.status).toBe(409);
    expect(applied.body.error.code).toBe("VERSION_NOT_CURRENT");
    const unknown = await post(user.h, `/v1/positions/${positionId}/skip`, { versionId: "0190f3a0-0000-7000-8000-000000000001" });
    expect(unknown.body.error.code).toBe("VERSION_NOT_CURRENT");
    expect(await decisions("skip")).toHaveLength(0);
  });

  it("keep custom stores the current weights; revert writes revert_custom; both need an own open position", async () => {
    const { user, positionId, sol } = await holder();
    expect((await post(user.h, `/v1/positions/${positionId}/custom`)).status).toBe(204);
    const [kept] = await decisions("keep_custom");
    expect(kept!.data.weights).toMatchObject({ [sol.instrumentId]: 5000 });
    expect((await adminSql`SELECT allocation_status FROM app.basket_positions WHERE id = ${positionId}`)[0]).toEqual({ allocation_status: "CUSTOMIZED" });
    expect((await post(user.h, `/v1/positions/${positionId}/custom/revert`)).status).toBe(204);
    expect((await decisions("revert_custom")).map((d) => d.data)).toEqual([{ reason: "user" }]);
    expect((await adminSql`SELECT allocation_status FROM app.basket_positions WHERE id = ${positionId}`)[0]).toEqual({ allocation_status: "ALIGNED" });
    expect((await post(user.h, `/v1/positions/${positionId}/custom/revert`)).status).toBe(204); // nothing to revert: no second decision
    expect(await decisions("revert_custom")).toHaveLength(1);
    const stranger = await seedUser({ wallet: solanaTestWallet() });
    expect((await post(stranger.h, `/v1/positions/${positionId}/custom`)).status).toBe(404);
  });

  it("keep custom is refused while a deployment is SHORT", async () => {
    const { user, positionId, chain } = await holder();
    chain.balances.set(balanceKey(user.solanaAddress, null), 5_000_000_000n);
    const res = await post(user.h, `/v1/positions/${positionId}/custom`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("REPAIR_REQUIRED");
  });
});

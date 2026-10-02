import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { redis } from "../../src/middleware/rate-limit";
import { reconcilePositions } from "../../src/services/positions";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet } from "./chain-mocks";
import { USDC_MINT, seedBasket, seedCash, seedPosition, seedPrices, seedUser, seedVersion, type SeedAsset } from "./helpers";

// SOL at $100 (9 decimals), TKN at $1 (6 decimals); version 1 targets 50/50 and the drift threshold is the default 500 bps.
const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 };
const TKN: SeedAsset = { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 5000, decimals: 6 };

/** One holder; `solUnits` x $100 against `tkn` x $1 decides the weights (10 SOL + 1000 TKN is exactly 50/50). */
async function holder(over: { solUnits?: number; tkn?: bigint; prices?: (string | null)[]; walletSol?: bigint } = {}) {
  const chain = mockChains();
  const basket = await seedBasket({ assets: [SOL, TKN] });
  const user = await seedUser({ wallet: solanaTestWallet() });
  await seedPrices(basket.deployments, over.prices ?? ["100", "1"]);
  const [sol, tkn] = basket.deployments;
  const solQty = BigInt(Math.round((over.solUnits ?? 10) * 1e9));
  const tknQty = over.tkn ?? 1_000_000_000n;
  const positionId = await seedPosition(user.userId, basket, [{ deploymentId: sol!.deploymentId, quantity: solQty }, { deploymentId: tkn!.deploymentId, quantity: tknQty }]);
  chain.balances.set(balanceKey(user.solanaAddress, null), over.walletSol ?? solQty);
  chain.balances.set(balanceKey(user.solanaAddress, tkn!.address), tknQty);
  return { chain, basket, user, positionId, sol: sol!, tkn: tkn! };
}
const alloc = async (id: string) => (await adminSql<{ allocation_status: string }[]>`SELECT allocation_status FROM app.basket_positions WHERE id = ${id}`)[0]!.allocation_status;
const inbox = (kind: string) => adminSql<{ id: string; position_id: string; dedupe_key: string }[]>`SELECT id, position_id, dedupe_key FROM app.notifications WHERE kind = ${kind} ORDER BY created_at, id`;
const decisions = (positionId: string) => adminSql<{ kind: string; data: Record<string, unknown> }[]>`SELECT kind, data FROM app.position_decisions WHERE position_id = ${positionId} ORDER BY created_at, id`;
const deliverJobs = () => fakes.queue.jobs.filter((j) => j.name === "notifications" && j.data.job === "deliver");

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("basket cash reconciliation", () => {
  it("wallet USDC below the cash of two baskets is a pro-rata shortfall with the remainder on the larger one, and one notice each", async () => {
    const a = await holder();
    // Two positions of one user: A records 100 and B 50 micro-USDC of cash, the wallet holds 100 (shortfall 50 = 33 + 16, the remainder 1 to A).
    const basketB = await seedBasket({ assets: [SOL] });
    const user = a.user;
    const pB = await seedPosition(user.userId, basketB, [{ deploymentId: basketB.deployments[0]!.deploymentId, quantity: 1_000_000_000n }]);
    a.chain.balances.set(balanceKey(user.solanaAddress, null), 11_000_000_000n);
    await seedCash(user.userId, a.basket, a.positionId, 100n);
    await seedCash(user.userId, basketB, pB, 50n);
    a.chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 100n);
    await reconcilePositions(user.userId);
    const rows = await adminSql<{ position_id: string; allocated_quantity: string; ledger_quantity: string; status: string }[]>`SELECT position_id, ledger_quantity, allocated_quantity, status FROM app.position_reconciliations WHERE deployment_id IS NULL`;
    expect(Object.fromEntries(rows.map((r) => [r.position_id, [r.ledger_quantity, r.allocated_quantity, r.status]]))).toEqual({ [a.positionId]: ["100", "66", "SHORT"], [pB]: ["50", "34", "SHORT"] });
    expect(await inbox("repair_required")).toHaveLength(2);
    expect(deliverJobs()).toHaveLength(2);
    await reconcilePositions(user.userId); // still short: no second notice
    expect(await inbox("repair_required")).toHaveLength(2);
  });

  it("a new deployment shortfall raises one repair_required notice", async () => {
    const { user, chain, positionId } = await holder();
    chain.balances.set(balanceKey(user.solanaAddress, null), 5_000_000_000n);
    await reconcilePositions(user.userId);
    await reconcilePositions(user.userId);
    expect(await inbox("repair_required")).toHaveLength(1);
    expect((await inbox("repair_required"))[0]).toMatchObject({ position_id: positionId });
  });
});

describe("a leg in flight", () => {
  const post = (h: Record<string, string>, path: string, body: object) => request(app).post(path).set(h).send(body);

  it("its deployments and the basket cash are not reconciled (no SHORT row, no notice) while the user's other deployments are; sync and repair wait; the leg settling resumes it", async () => {
    const { chain, user, positionId, basket, sol, tkn } = await holder();
    await seedCash(user.userId, basket, positionId, 100_000_000n);
    // A sell of all the SOL has landed (the wallet is debited) but is not settled (the ledger is not).
    const [op] = await adminSql<{ id: string }[]>`INSERT INTO app.operations (id, user_id, basket_id, position_id, kind, status, sell_percent, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
      VALUES (gen_random_uuid(), ${user.userId}, ${basket.basketId}, ${positionId}, 'sell_to_usdc', 'IN_PROGRESS', 100, 100, 10000, ${basket.versionId}, 'k-flight-12345', now() + interval '30 minutes') RETURNING id`;
    const [leg] = await adminSql<{ id: string }[]>`INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, from_deployment_id, amount_in, provider, status, source_tx, submitted_at)
      VALUES (gen_random_uuid(), ${op!.id}, 1, 'swap', 'solana', 'solana', ${sol.deploymentId}, 10000000000, 'lifi', 'PENDING_CHAIN', 'sig-flight', now()) RETURNING id`;
    chain.balances.set(balanceKey(user.solanaAddress, null), 0n);
    chain.balances.set(balanceKey(user.solanaAddress, tkn.address), 500_000_000n); // an unrelated loss of half the TKN
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 0n); // the USDC would also look short
    await reconcilePositions(user.userId);
    const rows = await adminSql<{ deployment_id: string | null; status: string }[]>`SELECT deployment_id, status FROM app.position_reconciliations`;
    expect(rows.map((r) => [r.deployment_id, r.status])).toEqual([[tkn.deploymentId, "SHORT"]]); // SOL (on the leg) and cash are skipped, TKN is not
    expect(await inbox("repair_required")).toHaveLength(1);
    expect(deliverJobs()).toHaveLength(1);

    const asset = (a: object) => ({ asset: a, split: [{ positionId, quantity: "1" }], idempotencyKey: "sync-flight-1" });
    for (const res of [
      await post(user.h, "/v1/portfolio/sync", asset({ deploymentId: sol.deploymentId })),
      await post(user.h, "/v1/portfolio/sync", { ...asset({}), asset: "cash" }),
      await post(user.h, "/v1/operations/repair", { deploymentId: sol.deploymentId, slippageBps: 100, idempotencyKey: "rep-flight-1" }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("OPERATION_IN_PROGRESS");
    }
    expect(await adminSql`SELECT 1 FROM app.position_decisions WHERE kind = 'sync'`).toHaveLength(0);

    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${leg!.id}`;
    await reconcilePositions(user.userId);
    const after = await adminSql<{ deployment_id: string | null }[]>`SELECT deployment_id FROM app.position_reconciliations WHERE deployment_id IS NULL OR deployment_id = ${sol.deploymentId}`;
    expect(after.map((r) => r.deployment_id).sort()).toEqual([null, sol.deploymentId].sort());
  });
});

describe("weight drift", () => {
  it("600 bps off the target with the default threshold: WEIGHT_DRIFT and one drifted notice per day", async () => {
    const { user, positionId } = await holder({ solUnits: 11.2, tkn: 880_000_000n }); // 56% / 44% against 50 / 50
    await reconcilePositions(user.userId);
    expect(await alloc(positionId)).toBe("WEIGHT_DRIFT");
    expect(await inbox("drifted")).toHaveLength(1);
    await reconcilePositions(user.userId);
    expect(await inbox("drifted")).toHaveLength(1);
    // 8 days later it is still drifted: a new notice (the earlier one and its day key are now a week old)
    await adminSql`UPDATE app.notifications SET created_at = now() - interval '8 days', dedupe_key = 'drifted:old:2000-01-01' WHERE kind = 'drifted'`;
    await reconcilePositions(user.userId);
    expect(await inbox("drifted")).toHaveLength(2);
  });

  it("within the version's own threshold is ALIGNED; a gap under the default but over a smaller threshold drifts", async () => {
    const aligned = await holder({ solUnits: 10.4, tkn: 960_000_000n }); // 52 / 48: 200 bps
    await reconcilePositions(aligned.user.userId);
    expect(await alloc(aligned.positionId)).toBe("ALIGNED");
    expect(await inbox("drifted")).toHaveLength(0);
    const tight = await holder({ solUnits: 10.4, tkn: 960_000_000n });
    await adminSql`UPDATE app.basket_versions SET rebalance = ${adminSql.json({ reviewFrequency: "none", driftThresholdBps: 100 })} WHERE id = ${tight.basket.versionId}`;
    await reconcilePositions(tight.user.userId);
    expect(await alloc(tight.positionId)).toBe("WEIGHT_DRIFT");
  });

  it("a missing price leaves the allocation untouched", async () => {
    const { user, positionId } = await holder({ solUnits: 11.2, tkn: 880_000_000n, prices: ["100", null] });
    await reconcilePositions(user.userId);
    expect(await alloc(positionId)).toBe("ALIGNED");
    expect(await inbox("drifted")).toHaveLength(0);
  });

  it("keep custom suppresses the prompt while the weights stay at the snapshot", async () => {
    const { user, positionId, sol, tkn } = await holder({ solUnits: 11.2, tkn: 880_000_000n });
    await adminSql`INSERT INTO app.position_decisions (id, position_id, kind, data, actor_user_id) VALUES (gen_random_uuid(), ${positionId}, 'keep_custom', ${adminSql.json({ weights: { [sol.instrumentId]: 5600, [tkn.instrumentId]: 4400 } })}, ${user.userId})`;
    await adminSql`UPDATE app.basket_positions SET allocation_status = 'CUSTOMIZED' WHERE id = ${positionId}`;
    await reconcilePositions(user.userId);
    expect(await alloc(positionId)).toBe("CUSTOMIZED");
    expect(await inbox("drifted")).toHaveLength(0);
  });

  it("a weight that moved a threshold away from the snapshot ends the keep-custom: WEIGHT_DRIFT, revert_custom 'moved' and a notice", async () => {
    const { user, positionId, sol, tkn } = await holder({ solUnits: 11.2, tkn: 880_000_000n });
    await adminSql`INSERT INTO app.position_decisions (id, position_id, kind, data, actor_user_id) VALUES (gen_random_uuid(), ${positionId}, 'keep_custom', ${adminSql.json({ weights: { [sol.instrumentId]: 5000, [tkn.instrumentId]: 5000 } })}, ${user.userId})`;
    await adminSql`UPDATE app.basket_positions SET allocation_status = 'CUSTOMIZED' WHERE id = ${positionId}`;
    await reconcilePositions(user.userId);
    expect(await alloc(positionId)).toBe("WEIGHT_DRIFT");
    expect((await decisions(positionId)).at(-1)).toEqual({ kind: "revert_custom", data: { reason: "moved" } });
    expect(await inbox("drifted")).toHaveLength(1);
  });
});

describe("portfolio states", () => {
  const get = (h: Record<string, string>) => request(app).get("/v1/portfolio").set(h);
  /** Reconciles now and keeps the portfolio read from reconciling again, so the stored rows are what is shown. */
  async function view(h: ReturnType<typeof holder> extends Promise<infer T> ? T : never, reconcile = true) {
    if (reconcile) await reconcilePositions(h.user.userId);
    await redis.set(`reconcile:user:${h.user.userId}`, "1", "EX", 60);
    const res = await get(h.user.h);
    expect(res.status).toBe(200);
    return res.body.positions[0] as { headline: string; states: Record<string, string>; cashMicro: string; latestVersion: { number: number; diff: unknown } | null; appliedVersionNumber: number; driftThresholdBps: number };
  }

  it("ALIGNED, and the version, backing, allocation and execution states are shown separately", async () => {
    const h = await holder();
    const p = await view(h);
    expect(p).toMatchObject({ headline: "ALIGNED", states: { version: "CURRENT", backing: "VERIFIED", allocation: "ALIGNED", execution: "NONE" }, cashMicro: "0", latestVersion: null, appliedVersionNumber: 1, driftThresholdBps: 500 });
  });

  it("DRIFTED and CUSTOMIZED", async () => {
    const drifted = await holder({ solUnits: 11.2, tkn: 880_000_000n });
    expect((await view(drifted)).headline).toBe("DRIFTED");
    await adminSql`INSERT INTO app.position_decisions (id, position_id, kind, data, actor_user_id) VALUES (gen_random_uuid(), ${drifted.positionId}, 'keep_custom', ${adminSql.json({ weights: { [drifted.sol.instrumentId]: 5600, [drifted.tkn.instrumentId]: 4400 } })}, ${drifted.user.userId})`;
    expect((await view(drifted)).headline).toBe("CUSTOMIZED");
  });

  it("REBALANCE_AVAILABLE with the latest version and its diff; a skipped version no longer raises the headline", async () => {
    const h = await holder();
    const v2 = await seedVersion(h.basket, 2, [3000, 7000]);
    const p = await view(h);
    expect(p).toMatchObject({ headline: "REBALANCE_AVAILABLE", states: { version: "OUT_OF_DATE" }, latestVersion: { number: 2 } });
    expect(p.latestVersion!.diff).toMatchObject({ changed: expect.any(Array) });
    expect((await request(app).post(`/v1/positions/${h.positionId}/skip`).set(h.user.h).send({ versionId: v2 })).status).toBe(204);
    expect(await view(h, false)).toMatchObject({ headline: "ALIGNED", states: { version: "SKIPPED" } });
  });

  it("EXECUTION_INCOMPLETE after a PARTIAL rebalance, EXECUTION_PENDING while one is open, REPAIR_REQUIRED above both", async () => {
    const h = await holder();
    const op = async (status: string) => adminSql`INSERT INTO app.operations (id, user_id, basket_id, position_id, kind, status, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
      VALUES (gen_random_uuid(), ${h.user.userId}, ${h.basket.basketId}, ${h.positionId}, 'rebalance', ${status}, 100, 10000, ${h.basket.versionId}, ${"k-" + status + "-12345"}, now() + interval '30 minutes')`;
    await op("PARTIAL");
    expect((await view(h)).headline).toBe("EXECUTION_INCOMPLETE");
    await op("IN_PROGRESS");
    expect((await view(h, false)).headline).toBe("EXECUTION_PENDING");
    await adminSql`UPDATE app.operations SET status = 'FAILED' WHERE status = 'IN_PROGRESS'`;
    h.chain.balances.set(balanceKey(h.user.solanaAddress, null), 5_000_000_000n);
    const short = await view(h);
    expect(short).toMatchObject({ headline: "REPAIR_REQUIRED", states: { backing: "REPAIR_REQUIRED" } });
    const repairs = (await get(h.user.h)).body.repairs as { asset: string; symbol: string; totalShortfall: string; positions: { positionId: string; shortfall: string }[] }[];
    expect(repairs).toEqual([{ asset: h.sol.deploymentId, symbol: "SOL", totalShortfall: "5000000000", positions: [{ positionId: h.positionId, basketSlug: h.basket.slug, ledger: "10000000000", shortfall: "5000000000" }] }]);
  });

  it("DATA_STALE when the newest reconciliation is 27 hours old; the headline is unchanged", async () => {
    const h = await holder();
    await reconcilePositions(h.user.userId);
    await adminSql`UPDATE app.position_reconciliations SET checked_at = now() - interval '27 hours'`;
    const p = await view(h, false);
    expect(p.states.backing).toBe("DATA_STALE");
    expect(p.headline).toBe("ALIGNED");
  });
});

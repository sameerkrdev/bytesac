import { db } from "@repo/db";
import createHttpError from "http-errors";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { lifi } from "../../src/providers/routes/lifi";
import { connection } from "../../src/providers/solana-tx";
import { seedPlatformWallets } from "../../src/services/gas";
import { closeIfEmpty } from "../../src/services/operations";
import { reconcilePositions, trackLeg } from "../../src/services/positions";
import { opsUser } from "../managers/helpers";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet } from "../execution/chain-mocks";
import { USDC_MINT, seedBasket, seedCash, seedPosition, seedPrices, seedUser, seedVersion, type SeedAsset } from "../execution/helpers";

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 5000, decimals: 18 };
const TKN: SeedAsset = { symbol: "TKN", chain: "ethereum", tokenStandard: "erc20", decimals: 6, bps: 10_000 };
const BOND: SeedAsset = { symbol: "BOND", chain: "solana", tokenStandard: "spl", decimals: 6, bps: 5000, assetType: "TOKENIZED_TREASURY", permissioned: true };
type H = Record<string, string>;

const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
const rebalance = (h: H, positionId: string, over: object = {}) => post(h, "/v1/operations/rebalance", { positionId, target: "latest", slippageBps: 100, idempotencyKey: "reb-aaaaaaaa", ...over });
const posRow = async (id: string) => (await adminSql<{ status: string; closed_at: Date | null }[]>`SELECT status, closed_at FROM app.basket_positions WHERE id = ${id}`)[0]!;
const audits = (action: string) => adminSql`SELECT 1 FROM app.audit_events WHERE action = ${action}`;

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------------------------------------------------
// Auto-close (Review Focus 3)
// ---------------------------------------------------------------------------------------------------------------------

/** A 100% sell of everything the position holds: an IN_PROGRESS sell_to_usdc operation with a settled fee and one sell leg per holding, each sent and final on-chain. */
async function sellAll(over: { holdings?: number; feeLast?: boolean; percent?: number } = {}) {
  const chain = mockChains();
  const basket = await seedBasket({ assets: [SOL, ETH] });
  const user = await seedUser({ wallet: solanaTestWallet() });
  const [sol, eth] = basket.deployments;
  const holdings = [sol!, eth!].slice(0, over.holdings ?? 1);
  const positionId = await seedPosition(user.userId, basket, holdings.map((h) => ({ deploymentId: h.deploymentId, quantity: 4_000_000_000n })));
  const [op] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operations (id, user_id, basket_id, position_id, kind, status, sell_percent, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
    VALUES (gen_random_uuid(), ${user.userId}, ${basket.basketId}, ${positionId}, 'sell_to_usdc', 'IN_PROGRESS', ${over.percent ?? 100}, 100, 182400, ${basket.versionId}, 'sell-aaaaaaaa', now() + interval '30 minutes') RETURNING id`;
  const fee = over.feeLast ? "PLANNED" : "SETTLED";
  await adminSql`INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, amount_in, status, source_tx) VALUES (gen_random_uuid(), ${op!.id}, 1, 'network_fee', 'solana', 'solana', 70000, ${fee}, ${fee === "SETTLED" ? "sig-fee" : null})`;
  const legs: string[] = [];
  for (const [n, h] of holdings.entries()) {
    const [leg] = await adminSql<{ id: string }[]>`
      INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, from_deployment_id, to_chain, amount_in, provider, status, source_tx, submitted_at)
      VALUES (gen_random_uuid(), ${op!.id}, ${n + 2}, 'swap', 'solana', ${h.deploymentId}, 'solana', ${(4_000_000_000n * BigInt(over.percent ?? 100) / 100n).toString()}, 'lifi', 'SUBMITTED', ${"sig-" + n}, now()) RETURNING id`;
    legs.push(leg!.id);
    chain.solanaFinality.set("sig-" + n, "finalized");
    chain.solanaReceived.set(`sig-${n}:${user.solanaAddress}`, 100_000_000n);
  }
  return { chain, basket, user, positionId, opId: op!.id, legs };
}

describe("auto-close of a fully sold position", () => {
  it("a 100% sell that settles closes the position (CLOSED, closed_at, audit) and ends an active keep-custom", async () => {
    const a = await sellAll();
    await adminSql`INSERT INTO app.position_decisions (id, position_id, kind, data, actor_user_id) VALUES (gen_random_uuid(), ${a.positionId}, 'keep_custom', '{"weights":{}}', ${a.user.userId})`;
    await trackLeg(a.legs[0]!);
    expect(await posRow(a.positionId)).toMatchObject({ status: "CLOSED", closed_at: expect.any(Date) });
    expect(await audits("position.auto_closed")).toHaveLength(1);
    expect((await adminSql`SELECT kind FROM app.position_decisions WHERE position_id = ${a.positionId} ORDER BY created_at DESC, id DESC LIMIT 1`)[0]).toEqual({ kind: "revert_custom" });
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${a.opId}`)[0]).toEqual({ status: "COMPLETED" });
  });

  it("is not closed while another leg is unsettled, the network fee is still to be paid, or a sale was partial", async () => {
    const two = await sellAll({ holdings: 2 });
    await trackLeg(two.legs[0]!);
    expect(await posRow(two.positionId)).toMatchObject({ status: "OPEN" }); // the second holding is still in the ledger
    await trackLeg(two.legs[1]!);
    expect(await posRow(two.positionId)).toMatchObject({ status: "CLOSED" });
  });

  it("stays open while the operation itself is still running (fee leg last), and closes once it completes", async () => {
    const a = await sellAll({ feeLast: true });
    await trackLeg(a.legs[0]!);
    expect(await posRow(a.positionId)).toMatchObject({ status: "OPEN" });
    expect((await adminSql`SELECT status FROM app.operations WHERE id = ${a.opId}`)[0]).toEqual({ status: "IN_PROGRESS" });
    await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = 'sig-feelast', submitted_at = now() WHERE operation_id = ${a.opId} AND kind = 'network_fee'`;
    a.chain.solanaFinality.set("sig-feelast", "finalized");
    await trackLeg((await adminSql<{ id: string }[]>`SELECT id FROM app.operation_legs WHERE operation_id = ${a.opId} AND kind = 'network_fee'`)[0]!.id);
    expect(await posRow(a.positionId)).toMatchObject({ status: "CLOSED" });
  });

  it("a partial sale leaves the position open", async () => {
    const a = await sellAll({ percent: 50 });
    await trackLeg(a.legs[0]!);
    expect(await posRow(a.positionId)).toMatchObject({ status: "OPEN" });
  });

  it("never closes with a non-zero basket cash, a non-zero ledger, or an operation still open", async () => {
    const a = await sellAll();
    await adminSql`UPDATE app.operations SET status = 'COMPLETED' WHERE id = ${a.opId}`;
    // The ledger still holds the SOL.
    expect(await db.transaction((tx) => closeIfEmpty(tx, null, a.positionId))).toBe(false);
    const [sync] = await adminSql<{ id: string }[]>`INSERT INTO app.position_decisions (id, position_id, kind, data, actor_user_id) VALUES (gen_random_uuid(), ${a.positionId}, 'sync', '{}', ${a.user.userId}) RETURNING id`;
    await adminSql`INSERT INTO app.position_ledger_entries (id, position_id, deployment_id, quantity_delta, reason, decision_id) SELECT gen_random_uuid(), position_id, deployment_id, -SUM(quantity_delta), 'sync', ${sync!.id} FROM app.position_ledger_entries WHERE position_id = ${a.positionId} GROUP BY position_id, deployment_id`;
    await seedCash(a.user.userId, a.basket, a.positionId, 5_000n);
    expect(await db.transaction((tx) => closeIfEmpty(tx, null, a.positionId))).toBe(false); // cash is not zero
    await adminSql`INSERT INTO app.position_cash_entries (id, position_id, amount_micro, reason, decision_id) VALUES (gen_random_uuid(), ${a.positionId}, -5000, 'sync', ${sync!.id})`;
    await adminSql`UPDATE app.operations SET status = 'PLANNED' WHERE id = ${a.opId}`;
    expect(await db.transaction((tx) => closeIfEmpty(tx, null, a.positionId))).toBe(false); // an operation is open
    await adminSql`UPDATE app.operations SET status = 'COMPLETED' WHERE id = ${a.opId}`;
    expect(await db.transaction((tx) => closeIfEmpty(tx, null, a.positionId))).toBe(true);
  });

  it("Sync to zero closes the position", async () => {
    mockChains();
    const basket = await seedBasket({ assets: [TKN] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    const d = basket.deployments[0]!;
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: d.deploymentId, quantity: 10n }]);
    await adminSql`INSERT INTO app.position_decisions (id, position_id, kind, data, actor_user_id) VALUES (gen_random_uuid(), ${positionId}, 'keep_custom', '{"weights":{}}', ${user.userId})`;
    fakes.evm.balances.set(`ethereum:${user.evmAddress}:${d.address}`, 0n);
    await reconcilePositions(user.userId);
    const res = await post(user.h, "/v1/portfolio/sync", { idempotencyKey: "sync-aaaaaaaa", asset: { deploymentId: d.deploymentId }, split: [{ positionId, quantity: "10" }] });
    expect(res.status).toBe(200);
    expect(await posRow(positionId)).toMatchObject({ status: "CLOSED" });
    expect(await audits("position.auto_closed")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Dust close
// ---------------------------------------------------------------------------------------------------------------------

describe("close position (dust)", () => {
  async function dust(qty: bigint, price: string | null = "1") {
    mockChains();
    const basket = await seedBasket({ assets: [SOL] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    await seedPrices(basket.deployments, [price]);
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: qty }]);
    return { user, positionId, basket };
  }

  it("allowed under $1: closes like Leave (no operation, audit position.closed)", async () => {
    const { user, positionId } = await dust(500_000_000n); // 0.5 SOL at $1
    const res = await post(user.h, `/v1/positions/${positionId}/close`);
    expect(res.status).toBe(204);
    expect(await posRow(positionId)).toMatchObject({ status: "CLOSED" });
    expect(await audits("position.closed")).toHaveLength(1);
    expect(await adminSql`SELECT 1 FROM app.operations WHERE position_id = ${positionId}`).toHaveLength(0);
    expect((await post(user.h, `/v1/positions/${positionId}/close`)).status).toBe(404); // not an OPEN position any more
  });

  it("refused at $1 or more, and by someone else (409; the position stays open)", async () => {
    const { user, positionId } = await dust(1_000_000_000n); // 1 SOL at $1 = exactly $1
    const res = await post(user.h, `/v1/positions/${positionId}/close`);
    expect(res.status).toBe(409);
    expect(await posRow(positionId)).toMatchObject({ status: "OPEN" });
    const stranger = await seedUser({ wallet: solanaTestWallet() });
    expect((await post(stranger.h, `/v1/positions/${positionId}/close`)).status).toBe(404);
  });

  it("basket cash counts toward the $1", async () => {
    const { user, positionId, basket } = await dust(1_000n);
    await seedCash(user.userId, basket, positionId, 1_500_000n);
    expect((await post(user.h, `/v1/positions/${positionId}/close`)).status).toBe(409);
  });

  it("without a price, dust below one display unit is allowed and a larger amount is refused", async () => {
    const small = await dust(999_999_999n, null);
    expect((await post(small.user.h, `/v1/positions/${small.positionId}/close`)).status).toBe(204);
    const big = await dust(1_000_000_000n, null);
    expect((await post(big.user.h, `/v1/positions/${big.positionId}/close`)).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Held assets that are not investable
// ---------------------------------------------------------------------------------------------------------------------

describe("rebalance with a held asset that is not investable", () => {
  /** SOL ($100) and a permissioned tokenized bond ($1), 50/50. The position holds `bond` BOND, `cash` basket cash. */
  async function arrange(over: { bond: bigint; cash: bigint; v2?: number[]; noBondPrice?: boolean }) {
    const chain = mockChains();
    await seedPlatformWallets();
    const basket = await seedBasket({ assets: [SOL, BOND] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    const [sol, bond] = basket.deployments;
    await seedPrices(basket.deployments, ["100", over.noBondPrice ? null : "1"]);
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: bond!.deploymentId, quantity: over.bond }]);
    if (over.cash > 0n) await seedCash(user.userId, basket, positionId, over.cash);
    chain.balances.set(balanceKey(user.solanaAddress, bond!.address), over.bond);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), over.cash + 50_000_000n);
    if (over.v2) await seedVersion(basket, 2, over.v2);
    return { chain, user, positionId, sol: sol!, bond: bond! };
  }

  it("a held permissioned RWA that is not bought no longer blocks the plan: SOL is bought, the RWA is left alone", async () => {
    const a = await arrange({ bond: 50_000_000n, cash: 50_000_000n }); // $50 of BOND, $50 cash: 50/50 target buys $50 of SOL
    const res = await rebalance(a.user.h, a.positionId, { target: "applied" });
    expect(res.status).toBe(201);
    const legs = await adminSql<{ kind: string; from_deployment_id: string | null; to_deployment_id: string | null }[]>`SELECT * FROM app.operation_legs WHERE operation_id = ${res.body.id} ORDER BY sequence`;
    expect(legs.some((l) => l.to_deployment_id === a.sol.deploymentId)).toBe(true);
    expect(legs.some((l) => l.to_deployment_id === a.bond.deploymentId || l.from_deployment_id === a.bond.deploymentId)).toBe(false);
  });

  it("buying the non-investable asset is refused, naming it (NOT_INVESTABLE)", async () => {
    const a = await arrange({ bond: 10_000_000n, cash: 90_000_000n }); // BOND is $10 of $100: the plan would buy $40 of it
    const res = await rebalance(a.user.h, a.positionId, { target: "applied" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "NOT_INVESTABLE", message: expect.stringContaining("BOND") });
  });

  it("selling it with no route is refused, naming it (NOT_INVESTABLE); a route available lets the plan through the route check", async () => {
    const a = await arrange({ bond: 50_000_000n, cash: 50_000_000n, v2: [8000, 2000] }); // BOND would drop to 20%: a sale of $30
    const quote = vi.mocked(lifi.quote).getMockImplementation()!;
    vi.mocked(lifi.quote).mockImplementation(async (i) => {
      if (i.fromToken === a.bond.address) throw createHttpError("No route is available for this trade.", { code: "ROUTE_UNAVAILABLE" });
      return quote(i);
    });
    const res = await rebalance(a.user.h, a.positionId);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "NOT_INVESTABLE", message: expect.stringContaining("BOND can't be sold") });
  });

  it("a sale refused for price impact keeps the price-impact message, not \"no route\"", async () => {
    const a = await arrange({ bond: 50_000_000n, cash: 50_000_000n, v2: [8000, 2000] });
    const quote = vi.mocked(lifi.quote).getMockImplementation()!;
    vi.mocked(lifi.quote).mockImplementation(async (i) => {
      if (i.fromToken === a.bond.address) throw createHttpError(503, "Price impact too high for this trade size.", { code: "ROUTE_UNAVAILABLE" });
      return quote(i);
    });
    const res = await rebalance(a.user.h, a.positionId);
    expect(res.status).toBe(503);
    expect(res.body.error.message).toBe("Price impact too high for this trade size.");
  });

  it("a held asset with no price refuses the plan, naming it", async () => {
    const a = await arrange({ bond: 50_000_000n, cash: 50_000_000n, noBondPrice: true });
    const res = await rebalance(a.user.h, a.positionId, { target: "applied" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "DATA_STALE", message: "No current price for BOND; the basket can't be valued right now." });
  });

  it("every leg of a rebalance records its gas reservation, the network-fee leg included, summing to what the operation reserved", async () => {
    const a = await arrange({ bond: 50_000_000n, cash: 50_000_000n });
    const res = await rebalance(a.user.h, a.positionId, { target: "applied" });
    expect(res.status).toBe(201);
    const legs = await adminSql<{ kind: string; expected_tx: { reservedNative?: string } | null }[]>`SELECT kind, expected_tx FROM app.operation_legs WHERE operation_id = ${res.body.id}`;
    const fee = legs.find((l) => l.kind === "network_fee")!;
    expect(BigInt(fee.expected_tx?.reservedNative ?? "0")).toBeGreaterThan(0n);
    const [op] = await adminSql<{ gas_reserved: { solana?: string } }[]>`SELECT gas_reserved FROM app.operations WHERE id = ${res.body.id}`;
    expect(legs.reduce((t, l) => t + BigInt(l.expected_tx?.reservedNative ?? "0"), 0n).toString()).toBe(op!.gas_reserved.solana);
  });

  it("a sale needs an ACTIVE or PAUSED deployment: a retired one is refused, a paused one is not", async () => {
    const a = await arrange({ bond: 50_000_000n, cash: 50_000_000n, v2: [8000, 2000] });
    await adminSql`UPDATE app.instrument_deployments SET status = 'RETIRED' WHERE id = ${a.bond.deploymentId}`;
    const res = await rebalance(a.user.h, a.positionId);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("BOND can't be sold");
    await adminSql`UPDATE app.instrument_deployments SET status = 'PAUSED' WHERE id = ${a.bond.deploymentId}`;
    expect((await rebalance(a.user.h, a.positionId)).body.error?.message ?? "").not.toContain("BOND can't be sold");
  });
});

describe("ops alert when an instrument becomes non-investable", () => {
  it("every ops_admin gets one notice per instrument per day listing the baskets that hold it", async () => {
    mockChains();
    const basket = await seedBasket({ assets: [SOL, ETH] });
    const a1 = await opsUser(app, "ops_admin");
    const a2 = await opsUser(app, "ops_admin");
    const [sol] = basket.deployments;
    const pause = (h: H) => post(h, `/v1/ops/assets/${sol!.instrumentId}/pause`);
    expect((await pause(a1.h)).status).toBe(200);
    const inbox = (userId: string) => adminSql<{ kind: string; data: { instrumentName: string; baskets: string[] } }[]>`SELECT kind, data FROM app.notifications WHERE user_id = ${userId}`;
    for (const u of [a1, a2]) expect(await inbox(u.userId)).toEqual([{ kind: "instrument_not_investable", data: expect.objectContaining({ instrumentId: sol!.instrumentId, instrumentName: "SOL", baskets: ["Test basket"] }) }]);
    // Resumed and paused again the same day: still one notice each.
    expect((await post(a1.h, `/v1/ops/assets/${sol!.instrumentId}/resume`)).status).toBe(200);
    expect((await pause(a1.h)).status).toBe(200);
    for (const u of [a1, a2]) expect(await inbox(u.userId)).toHaveLength(1);
  });

  it("setting a deployment of a tokenized asset permissioned alerts; an unrelated change does not", async () => {
    mockChains();
    const basket = await seedBasket({ assets: [SOL, { ...BOND, permissioned: false }] });
    const a1 = await opsUser(app, "ops_admin");
    const [sol, bond] = basket.deployments;
    const count = async () => (await adminSql`SELECT 1 FROM app.notifications WHERE kind = 'instrument_not_investable'`).length;
    const patch = (d: typeof sol, flag: string, body: object) => request(app).patch(`/v1/ops/assets/${d!.instrumentId}/deployments/${d!.deploymentId}/${flag}`).set(a1.h).send(body);
    expect((await patch(sol, "fee-on-transfer", { feeOnTransfer: true })).status).toBe(200);
    expect(await count()).toBe(0);
    expect((await patch(bond, "permissioned", { permissioned: true })).status).toBe(200);
    expect(await count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Revenue bucketing
// ---------------------------------------------------------------------------------------------------------------------

describe("fee block time", () => {
  it("the settled fee records the Solana block time of its transaction (settled_chain_at); an unreadable block time leaves it null", async () => {
    const chain = mockChains();
    const basket = await seedBasket({ assets: [SOL] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    const make = async (sig: string) => {
      const [op] = await adminSql<{ id: string }[]>`
        INSERT INTO app.operations (id, user_id, basket_id, kind, status, amount_usdc, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at)
        VALUES (gen_random_uuid(), ${user.userId}, ${basket.basketId}, 'invest', 'IN_PROGRESS', 1000000000, 100, 182400, ${basket.versionId}, ${"k-" + sig}, now() + interval '30 minutes') RETURNING id`;
      const [leg] = await adminSql<{ id: string }[]>`
        INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, amount_in, status, source_tx, submitted_at) VALUES (gen_random_uuid(), ${op!.id}, 1, 'network_fee', 'solana', 'solana', 70000, 'SUBMITTED', ${sig}, now()) RETURNING id`;
      await adminSql`INSERT INTO app.operation_fees (id, operation_id, leg_id, kind, base_micro, amount_micro) VALUES (gen_random_uuid(), ${op!.id}, ${leg!.id}, 'platform', 1, 70000)`;
      chain.solanaFinality.set(sig, "finalized");
      await trackLeg(leg!.id);
      await adminSql`UPDATE app.operations SET status = 'COMPLETED' WHERE id = ${op!.id}`; // free the user's one active-operation slot
      return (await adminSql<{ settled_at: Date | null; settled_chain_at: Date | null }[]>`SELECT settled_at, settled_chain_at FROM app.operation_fees WHERE leg_id = ${leg!.id}`)[0]!;
    };
    vi.spyOn(connection, "getParsedTransaction").mockResolvedValueOnce({ blockTime: Date.parse("2026-09-10T23:59:30Z") / 1000 } as never);
    const first = await make("sig-fee-1");
    expect(first.settled_at).toBeInstanceOf(Date);
    expect(first.settled_chain_at?.toISOString()).toBe("2026-09-10T23:59:30.000Z");
    vi.spyOn(connection, "getParsedTransaction").mockRejectedValueOnce(new Error("rpc down"));
    expect((await make("sig-fee-2")).settled_chain_at).toBeNull();
  });
});


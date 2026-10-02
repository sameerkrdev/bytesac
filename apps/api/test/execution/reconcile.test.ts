import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { logger } from "@repo/logger";
import * as evmRpc from "../../src/providers/evm-rpc";
import { checkGasWallets, reconcilePositions } from "../../src/services/positions";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { mockChains, solanaTestWallet } from "./chain-mocks";
import { seedBasket, seedPosition, seedUser } from "./helpers";

const TKN = { symbol: "TKN", chain: "ethereum", tokenStandard: "erc20", bps: 10_000 } as const;

/** One user holding the same ERC-20 deployment in two baskets (`a` and `b` recorded quantities). */
async function arrange(a: bigint, b: bigint) {
  mockChains();
  const [basketA, basketB] = [await seedBasket({ assets: [TKN] }), await seedBasket({ assets: [TKN] })];
  const user = await seedUser({ wallet: solanaTestWallet() });
  const shared = basketA.deployments[0]!;
  const [pA, pB] = [await seedPosition(user.userId, basketA, [{ deploymentId: shared.deploymentId, quantity: a }]), await seedPosition(user.userId, basketB, [{ deploymentId: shared.deploymentId, quantity: b }])];
  const wallet = (n: bigint) => fakes.evm.balances.set(`ethereum:${user.evmAddress}:${shared.address}`, n);
  return { user, shared, pA, pB, wallet, basketA };
}
const rows = () => adminSql<{ position_id: string; status: string; ledger_quantity: string; allocated_quantity: string; wallet_balance: string }[]>`SELECT * FROM app.position_reconciliations ORDER BY checked_at, id`;

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("reconcilePositions", () => {
  it("OK when the wallet holds what the ledger records", async () => {
    const { user, wallet, pA, pB } = await arrange(600n, 400n);
    wallet(1_000n);
    await reconcilePositions(user.userId);
    expect((await rows()).map((r) => [r.position_id, r.status, r.ledger_quantity, r.allocated_quantity, r.wallet_balance])).toEqual(
      expect.arrayContaining([[pA, "OK", "600", "600", "1000"], [pB, "OK", "400", "400", "1000"]]),
    );
  });

  it("SHORT: the shortfall is shared pro-rata across the positions holding the deployment", async () => {
    const { user, wallet, pA, pB } = await arrange(600n, 400n);
    wallet(500n); // 500 of 1000 left: 300 from A, 200 from B
    await reconcilePositions(user.userId);
    const byPosition = Object.fromEntries((await rows()).map((r) => [r.position_id, r]));
    expect(byPosition[pA]).toMatchObject({ status: "SHORT", ledger_quantity: "600", allocated_quantity: "300", wallet_balance: "500" });
    expect(byPosition[pB]).toMatchObject({ status: "SHORT", ledger_quantity: "400", allocated_quantity: "200" });
  });

  it("a rounding remainder goes to the largest position (the oldest on a tie)", async () => {
    const { user, wallet, pA, pB } = await arrange(3n, 3n);
    wallet(5n); // shortfall 1 cannot split evenly: floor(1 x 3 / 6) = 0 each, the remainder to the first
    await reconcilePositions(user.userId);
    const byPosition = Object.fromEntries((await rows()).map((r) => [r.position_id, r]));
    expect(byPosition[pA]).toMatchObject({ status: "SHORT", allocated_quantity: "2" });
    expect(byPosition[pB]).toMatchObject({ status: "OK", allocated_quantity: "3" });
    const total = BigInt(byPosition[pA]!.allocated_quantity) + BigInt(byPosition[pB]!.allocated_quantity);
    expect(total).toBe(5n);
  });

  it("SURPLUS: more in the wallet than recorded is outside baskets and changes no allocation", async () => {
    const { user, wallet, pA } = await arrange(600n, 400n);
    wallet(1_500n);
    await reconcilePositions(user.userId);
    expect((await rows()).find((r) => r.position_id === pA)).toMatchObject({ status: "SURPLUS", allocated_quantity: "600", wallet_balance: "1500" });
  });

  it("appends history rows on every run, ignores closed positions, and skips a deployment whose balance is unavailable", async () => {
    const { user, wallet, basketA, shared } = await arrange(600n, 400n);
    await seedPosition(user.userId, basketA, [{ deploymentId: shared.deploymentId, quantity: 50n }], "CLOSED");
    wallet(1_000n);
    await reconcilePositions(user.userId);
    wallet(100n);
    await reconcilePositions(user.userId);
    expect(await rows()).toHaveLength(4);
    expect((await rows()).map((r) => r.status)).toEqual(["OK", "OK", "SHORT", "SHORT"]);
    fakes.evm.balances.delete(`ethereum:${user.evmAddress}:${shared.address}`);
    vi.spyOn(evmRpc, "evmBalance").mockRejectedValue(new Error("down"));
    await reconcilePositions(user.userId);
    expect(await rows()).toHaveLength(4);
  });

  it("reconciles every user with an open position when no user is given", async () => {
    const { wallet } = await arrange(600n, 400n);
    wallet(1_000n);
    await reconcilePositions();
    expect(await rows()).toHaveLength(2);
  });
});

describe("portfolio", () => {
  it("lists open positions with holdings, reconciliation, open operations and former positions; reconciles at most once a minute", async () => {
    const { user, wallet, pA, pB, shared } = await arrange(600n, 400n);
    wallet(500n);
    const former = await seedPosition(user.userId, await seedBasket({ assets: [TKN] }), [{ deploymentId: shared.deploymentId, quantity: 7n }], "CLOSED");
    const res = await request(app).get("/v1/portfolio").set(user.h);
    expect(res.status).toBe(200);
    expect(res.body.positions.map((p: { id: string }) => p.id).sort()).toEqual([pA, pB].sort());
    const a = res.body.positions.find((p: { id: string }) => p.id === pA);
    expect(a.holdings).toEqual([expect.objectContaining({ deploymentId: shared.deploymentId, symbol: "TKN", chain: "ethereum", quantity: "600", decimals: 18, valueUsd: null, targetBps: 10_000, reconciliation: "SHORT" })]);
    expect(res.body.formerPositions.map((p: { id: string }) => p.id)).toEqual([former]);
    expect(res.body.openOperations).toEqual([]);
    const count = (await rows()).length;
    await request(app).get("/v1/portfolio").set(user.h);
    expect(await rows()).toHaveLength(count); // cached for 60 s
  });

  it("needs a session and shows nothing of other users", async () => {
    await arrange(600n, 400n);
    const stranger = await seedUser();
    const res = await request(app).get("/v1/portfolio").set(stranger.h);
    expect(res.body).toEqual({ positions: [], repairs: [], formerPositions: [], openOperations: [], history: [] });
    expect((await request(app).get("/v1/portfolio").set({ Origin: "http://localhost:3000", "X-Requested-With": "bytesac" })).status).toBe(401);
  });
});

describe("gas wallet check", () => {
  it("warns for every platform wallet below its floor and stays quiet when funded", async () => {
    const chain = mockChains();
    chain.balances.clear(); // the mocks fund the platform wallets by default: start from empty ones
    fakes.evm.balances.clear();
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const low = () => (warn.mock.calls as unknown as [string, { wallet: string }][]).filter(([m]) => m === "platform gas wallet is low");
    await checkGasWallets();
    expect(low().map(([, meta]) => meta.wallet).sort()).toEqual(
      ["evm_gas:arbitrum", "evm_gas:base", "evm_gas:bnb", "evm_gas:ethereum", "evm_gas:polygon", "solana_fee_payer"],
    );
    warn.mockClear();
    const { feePayer } = await import("../../src/providers/solana-tx");
    chain.balances.set(`${feePayer().publicKey.toBase58().toLowerCase()}:native`, 10n ** 10n);
    for (const c of ["ethereum", "base", "arbitrum", "bnb", "polygon"]) fakes.evm.balances.set(`${c}:${fakes.evm.gasWalletAddress()}`, 10n ** 22n);
    await checkGasWallets();
    expect(low()).toHaveLength(0);
  });
});

describe("grants", () => {
  it("the runtime role can never delete from the new tables, and ledger and reconciliation history are append-only", async () => {
    const tables = ["basket_positions", "operations", "operation_legs", "position_ledger_entries", "platform_wallets", "gas_drops", "sponsor_usage", "position_reconciliations"];
    for (const t of tables) {
      const [g] = await adminSql<{ del: boolean; upd: boolean }[]>`SELECT has_table_privilege('bytesac_api', ${"app." + t}, 'DELETE') AS del, has_table_privilege('bytesac_api', ${"app." + t}, 'UPDATE') AS upd`;
      expect(g!.del, `${t} DELETE`).toBe(false);
      if (["position_ledger_entries", "position_reconciliations"].includes(t)) expect(g!.upd, `${t} UPDATE`).toBe(false);
    }
  });
});

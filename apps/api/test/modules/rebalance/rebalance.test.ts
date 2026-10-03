import { VersionedTransaction } from "@solana/web3.js";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/app";
import { seedPlatformWallets } from "@/modules/operations/gas.service";
import { trackLeg } from "@/modules/portfolio/tracking.service";
import { adminSql, resetDb } from "../../helpers/db";
import { fakes } from "../../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet, type ChainState } from "../../helpers/chain-mocks";
import { USDC_MINT, seedBasket, seedCash, seedPosition, seedPrices, seedUser, seedVersion, type SeedAsset } from "../../helpers/execution";

// SOL at $100 (9 decimals) and TKN at $1 (6 decimals), both on Solana, 50/50 in version 1.
const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 };
const TKN: SeedAsset = { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 5000, decimals: 6 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 5000, decimals: 18 };
type H = Record<string, string>;

const post = (h: H, path: string, body?: object) => request(app).post(path).set(h).send(body);
const rebalance = (h: H, positionId: string, over: object = {}) => post(h, "/v1/operations/rebalance", { positionId, target: "latest", slippageBps: 100, idempotencyKey: "reb-aaaaaaaa", ...over });
const quote = (h: H, opId: string, legId: string) => post(h, `/v1/operations/${opId}/legs/${legId}/quote`);
const legsOf = (opId: string) => adminSql<{ id: string; sequence: number; kind: string; status: string; amount_in: string; min_out: string | null; route_summary: { fromCash?: boolean } | null }[]>`SELECT * FROM app.operation_legs WHERE operation_id = ${opId} ORDER BY sequence`;
const ledger = (positionId: string) => adminSql<{ quantity_delta: string; reason: string }[]>`SELECT quantity_delta, reason FROM app.position_ledger_entries WHERE position_id = ${positionId} AND reason <> 'invest' ORDER BY created_at, id`;
const cash = (positionId: string) => adminSql<{ amount_micro: string; reason: string }[]>`SELECT amount_micro, reason FROM app.position_cash_entries WHERE position_id = ${positionId} ORDER BY created_at, id`;
const position = async (id: string) => (await adminSql<{ applied_version_id: string }[]>`SELECT applied_version_id FROM app.basket_positions WHERE id = ${id}`)[0]!;
const operationRow = async (id: string) => (await adminSql<{ status: string; buy_scale: { num: string; den: string } | null }[]>`SELECT status, buy_scale FROM app.operations WHERE id = ${id}`)[0]!;

/** Moves a leg to SUBMITTED with a transaction the chain mock reports finalized, then lets the tracker settle it with `received`. */
async function settle(chain: ChainState, owner: string, opId: string, legId: string, received: bigint | null) {
  const sig = "sig-" + legId;
  await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${opId} AND status = 'PLANNED'`;
  await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = ${sig}, submitted_at = now() WHERE id = ${legId}`;
  chain.solanaFinality.set(sig, "finalized");
  if (received !== null) chain.solanaReceived.set(`${sig}:${owner}`, received);
  await trackLeg(legId);
}

async function arrange(over: { usdc?: bigint; sol?: bigint; walletSol?: bigint; v2?: number[] | null; assets?: SeedAsset[]; prices?: (string | null)[] } = {}) {
  const chain = mockChains();
  await seedPlatformWallets();
  const basket = await seedBasket({ assets: over.assets ?? [SOL, TKN] });
  const wallet = solanaTestWallet();
  const user = await seedUser({ wallet });
  const [first, second] = basket.deployments;
  await seedPrices(basket.deployments, over.prices ?? (over.assets ? ["100", "1000"] : ["100", "1"]));
  const firstQty = over.sol ?? 10_000_000_000n; // 10 SOL = $1,000
  const secondQty = over.assets ? 10n ** 18n : 1_000_000_000n; // 1 ETH = $1,000 or 1,000 TKN = $1,000
  const positionId = await seedPosition(user.userId, basket, [{ deploymentId: first!.deploymentId, quantity: firstQty }, { deploymentId: second!.deploymentId, quantity: secondQty }]);
  chain.balances.set(balanceKey(user.solanaAddress, null), over.walletSol ?? firstQty);
  if (over.assets) fakes.evm.balances.set(`ethereum:${user.evmAddress}`, secondQty);
  else chain.balances.set(balanceKey(user.solanaAddress, second!.address), secondQty);
  chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), over.usdc ?? 50_000_000n);
  const v2 = over.v2 === null ? undefined : await seedVersion(basket, 2, over.v2 ?? [3000, 7000]);
  return { chain, wallet, basket, user, positionId, v2: v2!, sol: first!, tkn: second! };
}

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());

describe("rebalance plan", () => {
  it("applies the latest version: sells first, then buys, the network fee first when free USDC covers it", async () => {
    const { user, positionId, v2 } = await arrange();
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "rebalance", status: "PLANNED", positionId, amountUsdc: null, sellPercent: null });
    const legs = await legsOf(res.body.id);
    expect(legs.map((l) => [l.kind, l.amount_in])).toEqual([["network_fee", res.body.networkFeeUsdc], ["swap", "4000000000"], ["swap", "400000000"]]); // sell 4 SOL ($400), buy $400 of TKN
    expect(legs[0]!.route_summary).toBeNull();
    expect(legs[2]!.route_summary).toMatchObject({ planned: true });
    expect((await adminSql`SELECT version_id FROM app.operations WHERE id = ${res.body.id}`)[0]).toEqual({ version_id: v2 });
  });

  it("Solana-only sells without free USDC: the fee goes between sells and buys, paid from basket cash and held back from the buys", async () => {
    const { user, positionId } = await arrange({ usdc: 0n });
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(201);
    const legs = await legsOf(res.body.id);
    expect(legs.map((l) => l.kind)).toEqual(["swap", "network_fee", "swap"]);
    expect(legs[1]!.route_summary).toEqual({ fromCash: true });
    expect(BigInt(legs[2]!.amount_in)).toBe(400_000_000n - BigInt(res.body.networkFeeUsdc));
  });

  it("an EVM sell without free USDC for the fee is INSUFFICIENT_BALANCE (D-071)", async () => {
    const { user, positionId } = await arrange({ assets: [SOL, ETH], v2: [7000, 3000], usdc: 0n });
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE");
    expect(res.body.error.message).toContain("Ethereum");
  });

  it("everything within thresholds: no operation, the version is recorded on the position and audited", async () => {
    const { user, positionId, v2 } = await arrange({ v2: [5000, 5000] });
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ aligned: true });
    expect((await position(positionId)).applied_version_id).toBe(v2);
    expect(await adminSql`SELECT 1 FROM app.operations WHERE kind = 'rebalance'`).toHaveLength(0);
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE action = 'position.version_applied' AND entity_id = ${positionId}`).toHaveLength(1);
  });

  it("target applied needs the applied version to still be current; a SHORT deployment blocks; a missing price is DATA_STALE", async () => {
    const a = await arrange();
    const notCurrent = await rebalance(a.user.h, a.positionId, { target: "applied" });
    expect(notCurrent.status).toBe(409);
    expect(notCurrent.body.error.code).toBe("VERSION_NOT_CURRENT");
    a.chain.balances.set(balanceKey(a.user.solanaAddress, null), 5_000_000_000n); // half of the SOL left the wallet
    const short = await rebalance(a.user.h, a.positionId, { idempotencyKey: "reb-bbbbbbbb" });
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe("REPAIR_REQUIRED");
  });

  it("a held asset without a fresh market price is DATA_STALE", async () => {
    const { user, positionId } = await arrange({ prices: ["100", null] });
    const res = await rebalance(user.h, positionId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DATA_STALE");
  });

  it("the same key replays the plan; the same key for another target is VALIDATION_FAILED", async () => {
    const { user, positionId } = await arrange();
    const first = await rebalance(user.h, positionId);
    const again = await rebalance(user.h, positionId);
    expect(again.body.id).toBe(first.body.id);
    const other = await rebalance(user.h, positionId, { target: "applied" });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("skip v2, then apply v4 after a manual extra buy: plans from allocated holdings only, the surplus is untouched", async () => {
    const { user, positionId, basket, chain, v2 } = await arrange({ walletSol: 15_000_000_000n }); // 5 SOL bought outside the basket
    expect((await post(user.h, `/v1/positions/${positionId}/skip`, { versionId: v2 })).status).toBe(204);
    expect((await post(user.h, `/v1/positions/${positionId}/skip`, { versionId: v2 })).status).toBe(204); // once
    expect(await adminSql`SELECT 1 FROM app.position_decisions WHERE kind = 'skip' AND position_id = ${positionId}`).toHaveLength(1);
    await seedVersion(basket, 3, [4000, 6000]);
    const v4 = await seedVersion(basket, 4, [3000, 7000]);
    void chain;
    const res = await rebalance(user.h, positionId);
    const legs = await legsOf(res.body.id);
    expect(legs[1]).toMatchObject({ kind: "swap", amount_in: "4000000000" }); // 4 of the allocated 10 SOL; the 5 extra SOL are not touched
    expect((await adminSql`SELECT version_id FROM app.operations WHERE id = ${res.body.id}`)[0]).toEqual({ version_id: v4 });
    expect((await position(positionId)).applied_version_id).not.toBe(v4);
  });

  describe("execution", () => {
    /** Plan, then settle the fee and the sell with `sellReceived`, leaving the buy to quote. */
    async function toBuy(sellReceived: bigint, over: Parameters<typeof arrange>[0] = {}) {
      const a = await arrange(over);
      const op = (await rebalance(a.user.h, a.positionId)).body;
      const [fee, sell, buy] = await legsOf(op.id);
      await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
      await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${fee!.id}`;
      await settle(a.chain, a.user.solanaAddress, op.id, sell!.id, sellReceived);
      a.chain.balances.set(balanceKey(a.user.solanaAddress, USDC_MINT), 50_000_000n + sellReceived);
      return { ...a, op, buy: buy!, sell: sell! };
    }

    it("sell settlement: the ledger drops by what was sold and the cash rises by what arrived", async () => {
      const { positionId } = await toBuy(400_000_000n);
      expect(await ledger(positionId)).toEqual([{ quantity_delta: "-4000000000", reason: "rebalance" }]);
      expect(await cash(positionId)).toEqual([{ amount_micro: "400000000", reason: "rebalance_sell" }]);
    });

    it("buy scaling down: sells settled 10% under the estimate, the buy is rescaled once at its first quote (Review Focus 2)", async () => {
      const { user, op, buy } = await toBuy(360_000_000n);
      const first = await quote(user.h, op.id, buy.id);
      expect(first.status).toBe(200);
      const [scaled] = (await legsOf(op.id)).filter((l) => l.id === buy.id);
      expect(scaled!.amount_in).toBe("360000000");
      expect(BigInt(scaled!.min_out!)).toBe((BigInt(buy.min_out!) * 360_000_000n) / 400_000_000n);
      expect((await operationRow(op.id)).buy_scale).toEqual({ num: "360000000", den: "400000000" });
      const again = await quote(user.h, op.id, buy.id);
      expect(again.status).toBe(200);
      expect((await legsOf(op.id)).find((l) => l.id === buy.id)!.amount_in).toBe("360000000"); // not rescaled by the second quote
      expect((await operationRow(op.id)).buy_scale).toEqual({ num: "360000000", den: "400000000" });
    });

    it("buy scaling up: sells settled above the estimate, the buy grows to the cash that arrived", async () => {
      const { user, op, buy } = await toBuy(440_000_000n);
      expect((await quote(user.h, op.id, buy.id)).status).toBe(200);
      expect((await legsOf(op.id)).find((l) => l.id === buy.id)!.amount_in).toBe("440000000");
    });

    it("COMPLETED: buy settlement, the applied version and the end of a keep-custom; the cash nets to zero", async () => {
      const { user, chain, op, buy, positionId, v2, basket } = await toBuy(400_000_000n);
      await adminSql`INSERT INTO app.position_decisions (id, position_id, kind, data, actor_user_id) VALUES (gen_random_uuid(), ${positionId}, 'keep_custom', '{}'::jsonb, ${user.userId})`;
      await quote(user.h, op.id, buy.id);
      await settle(chain, user.solanaAddress, op.id, buy.id, 400_000_000n);
      expect((await operationRow(op.id)).status).toBe("COMPLETED");
      expect((await position(positionId)).applied_version_id).toBe(v2);
      expect(await cash(positionId)).toEqual([
        { amount_micro: "400000000", reason: "rebalance_sell" }, { amount_micro: "-400000000", reason: "rebalance_buy" },
      ]);
      expect((await ledger(positionId)).map((l) => l.quantity_delta)).toEqual(["-4000000000", "400000000"]);
      const decisions = await adminSql<{ kind: string; data: { reason?: string } }[]>`SELECT kind, data FROM app.position_decisions WHERE position_id = ${positionId} ORDER BY created_at, id`;
      expect(decisions.at(-1)).toMatchObject({ kind: "revert_custom", data: { reason: "rebalanced" } });
      void basket;
    });

    it("PARTIAL keeps the old applied version", async () => {
      const { user, chain, op, buy, positionId, basket } = await toBuy(400_000_000n);
      await quote(user.h, op.id, buy.id);
      await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = 'sig-bad' WHERE id = ${buy.id}`;
      chain.solanaFinality.set("sig-bad", "failed");
      await trackLeg(buy.id);
      expect((await operationRow(op.id)).status).toBe("PARTIAL");
      expect((await position(positionId)).applied_version_id).toBe(basket.versionId);
    });

    it("a fee paid from cash is debited from the basket cash when it settles", async () => {
      const a = await arrange({ usdc: 0n });
      const op = (await rebalance(a.user.h, a.positionId)).body;
      const [sell, fee] = await legsOf(op.id);
      await settle(a.chain, a.user.solanaAddress, op.id, sell!.id, 400_000_000n);
      await settle(a.chain, a.user.solanaAddress, op.id, fee!.id, null);
      expect((await cash(a.positionId)).map((c) => [c.reason, c.amount_micro])).toEqual([["rebalance_sell", "400000000"], ["network_fee", String(-BigInt(op.networkFeeUsdc))]]);
    });
  });
});

describe("basket cash is not free USDC", () => {
  it("invest refuses to spend basket cash (Review Focus 1)", async () => {
    const { user, positionId, basket, chain } = await arrange({ v2: null });
    await seedCash(user.userId, basket, positionId, 300_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 300_000_000n); // the wallet holds exactly the basket's cash
    const other = await seedBasket({ assets: [SOL] });
    const res = await post(user.h, "/v1/operations/invest", { basketId: other.basketId, amountUsdc: "300", slippageBps: 100, idempotencyKey: "inv-aaaaaaaa" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_BALANCE");
  });

  async function sellHalf() {
    const a = await arrange({ v2: null, usdc: 500_000_000n });
    await seedCash(a.user.userId, a.basket, a.positionId, 200_000_000n);
    const op = (await post(a.user.h, "/v1/operations/sell", { positionId: a.positionId, percent: 50, slippageBps: 100, idempotencyKey: "sell-aaaaaaaa" })).body;
    return { ...a, op, legs: await legsOf(op.id) };
  }

  it("selling 50% to USDC releases 50% of the basket cash when the first sell leg settles, once", async () => {
    const { user, wallet, chain, positionId, op, legs } = await sellHalf();
    expect(await cash(positionId)).toHaveLength(1); // planning releases nothing
    const [fee, sellA, sellB] = legs;
    const q = await quote(user.h, op.id, fee!.id);
    const tx = VersionedTransaction.deserialize(Buffer.from(q.body.transaction.serializedBase64, "base64"));
    tx.sign([wallet.keypair]);
    const signedTx = Buffer.from(tx.serialize()).toString("base64");
    expect((await post(user.h, `/v1/operations/${op.id}/legs/${fee!.id}/submit`, { signedTx })).status).toBe(200);
    expect(await cash(positionId)).toHaveLength(1); // a claimed fee leg releases nothing
    await settle(chain, user.solanaAddress, op.id, sellA!.id, 100_000_000n);
    expect(await cash(positionId)).toEqual([{ amount_micro: "200000000", reason: "rebalance_sell" }, { amount_micro: "-100000000", reason: "sell" }]);
    await settle(chain, user.solanaAddress, op.id, sellB!.id, 50_000_000n);
    expect(await cash(positionId)).toHaveLength(2); // the second sell leg releases nothing more
  });

  it("a sell whose first leg fails, and a cancelled plan, release nothing", async () => {
    const { user, chain, positionId, op, legs } = await sellHalf();
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${op.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${legs[0]!.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SUBMITTED', source_tx = 'sig-bad', submitted_at = now() WHERE id = ${legs[1]!.id}`;
    chain.solanaFinality.set("sig-bad", "failed");
    await trackLeg(legs[1]!.id);
    expect((await operationRow(op.id)).status).toBe("FAILED");
    expect(await cash(positionId)).toHaveLength(1);
    void user;
  });

  it("a plan cancelled before any leg is sent releases nothing", async () => {
    const { user, positionId, op } = await sellHalf();
    expect((await post(user.h, `/v1/operations/${op.id}/cancel`)).status).toBe(200);
    expect(await cash(positionId)).toHaveLength(1);
  });
});

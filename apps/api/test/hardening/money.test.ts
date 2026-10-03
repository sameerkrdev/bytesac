import { db } from "@repo/db";
import { notificationText } from "@repo/validator";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app";
import { lifi } from "../../src/providers/routes/lifi";
import * as gas from "../../src/services/gas";
import { refreshOperationStatus } from "../../src/services/operations";
import * as positions from "../../src/services/positions";
import * as rebalance from "../../src/services/rebalance";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { mockChains, solanaTestWallet } from "../execution/chain-mocks";
import { USDC_MINT, seedBasket, seedPosition, seedUser, type SeedAsset } from "../execution/helpers";

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 5000 };

beforeEach(resetDb);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------------------------------------------------
// Fixtures: an operation with a gas reservation, inserted directly (nothing is sent anywhere)
// ---------------------------------------------------------------------------------------------------------------------

interface LegSpec { seq: number; kind?: string; status: string; fromChain?: string; payer?: string | null; sourceTx?: string | null; expected?: object | null; recoveryOf?: string; recoveryToken?: object; createdDaysAgo?: number }

async function seedOp(over: { status?: string; reserved?: Record<string, string>; usage?: Record<string, string>; legs: LegSpec[]; user?: Awaited<ReturnType<typeof seedUser>>; kind?: string }) {
  const basket = await seedBasket({ assets: [SOL, ETH] });
  const user = over.user ?? (await seedUser({ wallet: solanaTestWallet() }));
  const [op] = await adminSql<{ id: string }[]>`
    INSERT INTO app.operations (id, user_id, basket_id, kind, status, amount_usdc, slippage_bps, network_fee_usdc, version_id, idempotency_key, expires_at, gas_reserved)
    VALUES (gen_random_uuid(), ${user.userId}, ${basket.basketId}, ${over.kind ?? "invest"}, ${over.status ?? "IN_PROGRESS"}, 1000000000, 100, 182400, ${basket.versionId}, ${"key-" + Math.random().toString(16).slice(2, 10)},
      now() + interval '30 minutes', ${adminSql.json(over.reserved ?? {})}) RETURNING id`;
  for (const [chain, amount] of Object.entries(over.usage ?? over.reserved ?? {})) {
    await adminSql`INSERT INTO app.sponsor_usage (user_id, chain, day, amount_native) VALUES (${user.userId}, ${chain}, (now() at time zone 'utc')::date, ${amount}) ON CONFLICT (user_id, chain, day) DO UPDATE SET amount_native = excluded.amount_native`;
  }
  const ids: string[] = [];
  for (const l of over.legs) {
    const [leg] = await adminSql<{ id: string }[]>`
      INSERT INTO app.operation_legs (id, operation_id, sequence, kind, from_chain, to_chain, amount_in, provider, status, source_tx, gas_payer, expected_tx, recovery_of, recovery_token, created_at)
      VALUES (gen_random_uuid(), ${op!.id}, ${l.seq}, ${l.kind ?? "swap"}, ${l.fromChain ?? "solana"}, ${l.fromChain ?? "solana"}, 1000000, 'lifi', ${l.status}, ${l.sourceTx ? `${l.sourceTx}-${op!.id.slice(0, 8)}` : null}, ${l.payer ?? null},
        ${l.expected ? adminSql.json(l.expected as never) : null}, ${l.recoveryOf ?? null}, ${l.recoveryToken ? adminSql.json(l.recoveryToken as never) : null}, now() - ${(l.createdDaysAgo ?? 0) + " days"}::interval) RETURNING id`;
    ids.push(leg!.id);
  }
  return { opId: op!.id, user, basket, ids };
}

const usage = async (userId: string, chain: string) => BigInt((await adminSql<{ amount_native: string }[]>`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${userId} AND chain = ${chain}`)[0]?.amount_native ?? "0");
const opRow = async (id: string) => (await adminSql<{ status: string; gas_reserved: Record<string, string> }[]>`SELECT status, gas_reserved FROM app.operations WHERE id = ${id}`)[0]!;
const post = (h: Record<string, string>, path: string) => request(app).post(path).set(h).send({});
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------------------------------------------------------------
// Price-impact backstop (Review Focus 2)
// ---------------------------------------------------------------------------------------------------------------------

describe("price-impact backstop", () => {
  const SOLANA = 1151111081099710;
  const TOKEN = "0x1111111111111111111111111111111111111111";
  const USER_EVM = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
  const trade = { fromChain: "solana", fromToken: USDC_MINT, toChain: "ethereum", toToken: TOKEN, fromAmount: 10_000_000n, toAddress: USER_EVM, slippageBps: 100 } as const;
  const route = (fromUsd: string, toUsd: string, feeUsd: string) => ({
    fromChainId: SOLANA, toChainId: 1, fromToken: { address: USDC_MINT, chainId: SOLANA }, toToken: { address: TOKEN, chainId: 1 }, fromAmount: "10000000", toAmount: "5000000", toAmountMin: "4950000",
    fromAmountUSD: fromUsd, toAmountUSD: toUsd,
    steps: [{ tool: "jupiter", action: { fromChainId: SOLANA }, estimate: { gasCosts: [{ amountUSD: "0.05", amount: "5000" }], feeCosts: [{ name: "LI.FI Fixed Fee", amountUSD: feeUsd, included: true }] } }],
  });
  const stub = () => vi.stubGlobal("fetch", vi.fn());

  it("4% real impact plus 1% included fees passes (the fee is not impact)", async () => {
    stub();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ routes: [route("100", "95", "1")] }));
    expect((await lifi.estimate(trade)).priceImpact).toBeCloseTo(0.04);
  });

  it("6% real impact is refused whatever the fees (503 ROUTE_UNAVAILABLE)", async () => {
    stub();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ routes: [route("100", "93", "1")] }));
    await expect(lifi.estimate(trade)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE", status: 503, message: "Price impact too high for this trade size." });
  });

  it("a trade under $10 is never checked, and missing USD values are not checked", async () => {
    stub();
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ routes: [route("9", "5", "0")] })).mockResolvedValueOnce(jsonResponse({ routes: [{ ...route("100", "1", "0"), toAmountUSD: undefined }] }));
    expect((await lifi.estimate(trade)).priceImpact).toBeGreaterThan(0.4);
    expect((await lifi.estimate(trade)).priceImpact).toBeNull();
  });

  it("the quote path applies the same backstop", async () => {
    stub();
    const q = (toUsd: string) => ({
      tool: "mayan",
      action: { fromChainId: SOLANA, toChainId: 1, fromToken: { address: USDC_MINT, chainId: SOLANA }, toToken: { address: TOKEN, chainId: 1 }, fromAmount: "10000000", toAddress: USER_EVM.toLowerCase() },
      estimate: { toAmount: "5000000", toAmountMin: "4950000", gasCosts: [{ amountUSD: "0.05" }], feeCosts: [{ name: "LI.FI Fixed Fee", amountUSD: "1", included: true }], fromAmountUSD: "100", toAmountUSD: toUsd },
      transactionRequest: { data: "AQID" },
    });
    const input = { ...trade, fromAddress: "UserSo1111111111111111111111111111111111111", svmSponsor: "FeePayer11111111111111111111111111111111111" };
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(q("95"))).mockResolvedValueOnce(jsonResponse(q("93")));
    expect((await lifi.quote(input)).priceImpact).toBeCloseTo(0.04);
    await expect(lifi.quote(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE", message: "Price impact too high for this trade size." });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Gas reservations (Review Focus 1)
// ---------------------------------------------------------------------------------------------------------------------

describe("gas reservations", () => {
  it("reserveLegGas after a stop is refused: no top-up is reserved for a closed operation", async () => {
    mockChains();
    await gas.seedPlatformWallets();
    const a = await seedOp({ reserved: { solana: "1000" }, legs: [{ seq: 1, kind: "network_fee", status: "SETTLED", payer: "platform_fee_payer", sourceTx: "sig-fee" }, { seq: 2, status: "PLANNED", payer: "platform_fee_payer", expected: { reservedNative: "1000" } }] });
    // The stop lands while the quote is being fetched.
    const quote = vi.mocked(lifi.quote).getMockImplementation()!;
    vi.mocked(lifi.quote).mockImplementation(async (i) => {
      await adminSql`UPDATE app.operations SET status = 'PARTIAL' WHERE id = ${a.opId}`;
      return quote(i);
    });
    const res = await post(a.user.h, `/v1/operations/${a.opId}/legs/${a.ids[1]}/quote`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("This operation is no longer open.");
    expect(await usage(a.user.userId, "solana")).toBe(1000n); // nothing more reserved
    expect((await opRow(a.opId)).gas_reserved).toEqual({ solana: "1000" });
  });

  it("Stop releases the unsent reservation of every kind of leg, keeping what a submitted leg and a sent drop spent", async () => {
    mockChains();
    const a = await seedOp({
      reserved: { solana: "12000", ethereum: "900" },
      legs: [
        { seq: 1, kind: "network_fee", status: "SETTLED", payer: "platform_fee_payer", sourceTx: "sig-fee" },
        { seq: 2, status: "SETTLED", payer: "platform_fee_payer", sourceTx: "sig-1", expected: { reservedNative: "5000" } },
        { seq: 3, status: "PLANNED", payer: "platform_fee_payer", expected: { reservedNative: "7000" } },
        { seq: 4, status: "PLANNED", fromChain: "ethereum", payer: "platform_gas_drop", expected: { gasReserved: true, gasDropNative: "900" } },
      ],
    });
    const stopped = await post(a.user.h, `/v1/operations/${a.opId}/cancel`);
    expect(stopped.status).toBe(200);
    expect((await opRow(a.opId)).status).toBe("PARTIAL");
    expect(await usage(a.user.userId, "solana")).toBe(5000n); // the submitted leg's fee stays spent
    expect(await usage(a.user.userId, "ethereum")).toBe(0n); // the unsent drop is returned
    expect((await opRow(a.opId)).gas_reserved).toEqual({});
  });

  it("an unsent network-fee leg is returned on Stop exactly once", async () => {
    mockChains();
    const a = await seedOp({ reserved: { solana: "15000" }, legs: [{ seq: 1, kind: "network_fee", status: "PLANNED", payer: "platform_fee_payer", expected: { reservedNative: "15000" } }] });
    expect((await post(a.user.h, `/v1/operations/${a.opId}/cancel`)).status).toBe(200);
    expect(await usage(a.user.userId, "solana")).toBe(0n);
    await db.transaction((tx) => gas.releaseUnspentGas(tx, a.opId));
    expect(await usage(a.user.userId, "solana")).toBe(0n);
  });

  it("completion then a later release returns the reservation exactly once (Review Focus 1)", async () => {
    mockChains();
    // Two operations of one user reserved 900 each on Ethereum; the first completes with its drop never needed (the wallet already held gas).
    const first = await seedOp({ reserved: { ethereum: "900" }, usage: { ethereum: "1800" }, legs: [{ seq: 1, status: "SETTLED", fromChain: "ethereum", payer: "platform_gas_drop", sourceTx: "0xabc", expected: { gasReserved: true, gasDropNative: "900" } }] });
    await db.transaction((tx) => refreshOperationStatus(tx, null, first.opId));
    expect((await opRow(first.opId)).status).toBe("COMPLETED");
    expect(await usage(first.user.userId, "ethereum")).toBe(900n);
    expect((await opRow(first.opId)).gas_reserved).toEqual({});
    await db.transaction((tx) => gas.releaseUnspentGas(tx, first.opId)); // the sweep finds it terminal again
    await db.transaction((tx) => gas.releaseUnspentGas(tx, first.opId));
    expect(await usage(first.user.userId, "ethereum")).toBe(900n);
  });

  it("a drop the node refused returns its amount and is not counted toward the 5 a day", async () => {
    mockChains();
    const a = await seedOp({ reserved: { ethereum: "900" }, legs: [{ seq: 1, status: "PLANNED", fromChain: "ethereum", payer: "platform_gas_drop", expected: { gasReserved: true, gasDropNative: "900" } }] });
    fakes.evm.sendRefused = true;
    expect(await gas.sendGasDrop(a.ids[0]!, "ethereum", a.user.evmAddress, 900n)).toEqual({ status: "failed", txHash: null });
    expect(await usage(a.user.userId, "ethereum")).toBe(0n);
    expect((await opRow(a.opId)).gas_reserved).toEqual({ ethereum: "0" });
    // Five refused drops today do not use up the limit.
    for (let n = 0; n < 4; n++) {
      const x = await seedOp({ status: "CANCELLED", user: a.user, legs: [{ seq: 1, status: "FAILED", fromChain: "ethereum", payer: "platform_gas_drop" }] });
      await adminSql`INSERT INTO app.gas_drops (id, leg_id, chain, recipient, amount_native, status) VALUES (gen_random_uuid(), ${x.ids[0]!}, 'ethereum', ${a.user.evmAddress}, 1, 'failed')`;
    }
    fakes.evm.sendRefused = false;
    await adminSql`UPDATE app.operations SET status = 'CANCELLED' WHERE id = ${a.opId}`;
    const fresh = await seedOp({ reserved: {}, user: a.user, legs: [{ seq: 1, status: "PLANNED", fromChain: "ethereum", payer: "platform_gas_drop" }] });
    await expect(gas.sendGasDrop(fresh.ids[0]!, "ethereum", a.user.evmAddress, 900n)).resolves.toMatchObject({ status: "pending" });
  });

  it("a retried drop re-reads its receipt by the stored hash and never sends a confirmed or pending drop again", async () => {
    mockChains();
    const a = await seedOp({ reserved: { ethereum: "900" }, legs: [{ seq: 1, status: "PLANNED", fromChain: "ethereum", payer: "platform_gas_drop", expected: { gasReserved: true, gasDropNative: "900" } }] });
    expect(await gas.sendGasDrop(a.ids[0]!, "ethereum", a.user.evmAddress, 900n)).toEqual({ status: "pending", txHash: "0xdrop1" });
    expect(await gas.sendGasDrop(a.ids[0]!, "ethereum", a.user.evmAddress, 900n)).toEqual({ status: "pending", txHash: "0xdrop1" });
    fakes.evm.receipts.set("0xdrop1", { success: true, blockNumber: 1n, head: 2n, logs: [] });
    expect(await gas.sendGasDrop(a.ids[0]!, "ethereum", a.user.evmAddress, 900n)).toEqual({ status: "confirmed", txHash: "0xdrop1" });
    expect(await gas.sendGasDrop(a.ids[0]!, "ethereum", a.user.evmAddress, 900n)).toEqual({ status: "confirmed", txHash: "0xdrop1" });
    expect(fakes.evm.sentNative).toHaveLength(1);
    // The confirmed drop stays spent when the operation ends.
    await db.transaction((tx) => gas.releaseUnspentGas(tx, a.opId));
    expect(await usage(a.user.userId, "ethereum")).toBe(900n);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Sweep isolation
// ---------------------------------------------------------------------------------------------------------------------

describe("sweeps continue after one bad record", () => {
  it("expireStalePlans cancels the other plans when one throws", async () => {
    mockChains();
    const bad = await seedOp({ status: "PLANNED", legs: [{ seq: 1, status: "PLANNED" }] });
    const good = await seedOp({ status: "PLANNED", legs: [{ seq: 1, status: "PLANNED" }] });
    await adminSql`UPDATE app.operations SET expires_at = now() - interval '1 minute'`;
    const real = gas.releaseUnspentGas;
    vi.spyOn(gas, "releaseUnspentGas").mockImplementation(async (tx, id) => { if (id === bad.opId) throw new Error("boom"); return real(tx, id); });
    await positions.expireStalePlans();
    expect((await opRow(good.opId)).status).toBe("CANCELLED");
    expect((await opRow(bad.opId)).status).toBe("PLANNED");
  });

  it("trackStaleClaims hands the other claimed legs on when one cannot be", async () => {
    mockChains();
    const a = await seedOp({ legs: [{ seq: 1, status: "SUBMITTING", sourceTx: "s1" }, { seq: 2, status: "SUBMITTING", sourceTx: "s2" }] });
    await adminSql`UPDATE app.operation_legs SET updated_at = now() - interval '10 minutes' WHERE operation_id = ${a.opId}`;
    const queues = await import("../../src/queues");
    const spy = vi.spyOn(queues, "enqueue").mockRejectedValueOnce(new Error("redis down")).mockResolvedValue(undefined);
    await positions.trackStaleClaims();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reconcilePositions checks the other positions when one drift check throws", async () => {
    mockChains();
    const basket = await seedBasket({ assets: [SOL, ETH] });
    const u1 = await seedUser({ wallet: solanaTestWallet() });
    const u2 = await seedUser({ wallet: solanaTestWallet() });
    await seedPosition(u1.userId, basket, []);
    await seedPosition(u2.userId, basket, []);
    const real = rebalance.valuePosition;
    const spy = vi.spyOn(rebalance, "valuePosition").mockRejectedValueOnce(new Error("price lookup failed")).mockImplementation(real);
    await expect(positions.reconcilePositions()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Recovery auto-stop (Review Focus 4)
// ---------------------------------------------------------------------------------------------------------------------

describe("recovery auto-stop", () => {
  const recoveryLegs = (recovery: Partial<LegSpec>): LegSpec[] => [
    { seq: 1, kind: "network_fee", status: "SETTLED", payer: "platform_fee_payer", sourceTx: "sig-fee" },
    { seq: 2, kind: "cross_chain", status: "FAILED", payer: "platform_fee_payer", sourceTx: "sig-src", recoveryToken: { chain: "solana", address: null, decimals: 6, symbol: "USDC", amount: "5" } },
    { seq: 3, status: "PLANNED", payer: "platform_fee_payer", expected: { gasReserved: true, reservedNative: "10000" }, createdDaysAgo: 8, ...recovery },
  ];

  it("a PLANNED recovery older than 7 days stops the operation as PARTIAL, releases its reservation, is audited and tells the user", async () => {
    mockChains();
    const a = await seedOp({ reserved: { solana: "10000" }, legs: recoveryLegs({}) });
    const [origin] = await adminSql<{ id: string }[]>`SELECT id FROM app.operation_legs WHERE operation_id = ${a.opId} AND sequence = 2`;
    await adminSql`UPDATE app.operation_legs SET recovery_of = ${origin!.id} WHERE id = ${a.ids[2]!}`;
    await positions.stopStalledRecoveries();
    expect((await opRow(a.opId)).status).toBe("PARTIAL");
    expect(await usage(a.user.userId, "solana")).toBe(0n);
    expect(await adminSql`SELECT 1 FROM app.audit_events WHERE entity_id = ${a.opId} AND action = 'operation.auto_stopped'`).toHaveLength(1);
    const [n] = await adminSql<{ kind: string; data: { autoStopped?: boolean } }[]>`SELECT kind, data FROM app.notifications WHERE user_id = ${a.user.userId}`;
    expect(n).toMatchObject({ kind: "execution_incomplete", data: { autoStopped: true } });
    expect(notificationText("execution_incomplete", n!.data).body).toBe("We stopped your unfinished swap; the tokens that arrived are in your wallet.");
    await positions.stopStalledRecoveries(); // a second run is a no-op
    expect(await adminSql`SELECT 1 FROM app.notifications WHERE user_id = ${a.user.userId}`).toHaveLength(1);
  });

  it("a recovery that was submitted, or planned less than 7 days ago, is never stopped", async () => {
    mockChains();
    const sent = await seedOp({ reserved: { solana: "10000" }, legs: recoveryLegs({ status: "SUBMITTED", sourceTx: "sig-rec" }) });
    const fresh = await seedOp({ reserved: { solana: "10000" }, legs: recoveryLegs({ createdDaysAgo: 3 }) });
    for (const a of [sent, fresh]) {
      const [origin] = await adminSql<{ id: string }[]>`SELECT id FROM app.operation_legs WHERE operation_id = ${a.opId} AND sequence = 2`;
      await adminSql`UPDATE app.operation_legs SET recovery_of = ${origin!.id} WHERE id = ${a.ids[2]!}`;
    }
    await positions.stopStalledRecoveries();
    expect((await opRow(sent.opId)).status).toBe("IN_PROGRESS");
    expect((await opRow(fresh.opId)).status).toBe("IN_PROGRESS");
  });
});

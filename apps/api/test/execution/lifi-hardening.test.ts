import { PublicKey } from "@solana/web3.js";
import createHttpError from "http-errors";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "@/app";
import { redis } from "@/middlewares/rate-limit.middleware";
import { lifi } from "@/providers/routes/lifi";
import { ata } from "@/providers/solana-tx";
import { seedPlatformWallets } from "@/services/gas";
import { forgetRoutePolicy, routeDenyList } from "@/services/routing";
import { adminSql, resetDb } from "../helpers/db";
import { fakes } from "../helpers/fakes";
import { balanceKey, mockChains, solanaTestWallet } from "./chain-mocks";
import { USDC_MINT, seedBasket, seedPosition, seedPrices, seedUser, seedVersion, type SeedAsset } from "./helpers";

const SOLANA = 1151111081099710;
const USER_SOL = "UserSo1111111111111111111111111111111111111";
const USER_EVM = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const TOKEN = "0x1111111111111111111111111111111111111111";
const DENY = { bridges: ["across", "mayan", "mayanSwift"], exchanges: ["uniswap"] };

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => ({ url: new URL(c[0] as string), init: c[1] as RequestInit }));
const trade = { fromChain: "solana", fromToken: USDC_MINT, toChain: "ethereum", toToken: TOKEN, fromAmount: 10_000_000n, toAddress: USER_EVM, slippageBps: 100 } as const;

const route = (over: Record<string, unknown> = {}) => ({
  fromChainId: SOLANA, toChainId: 1, fromToken: { address: USDC_MINT, chainId: SOLANA }, toToken: { address: TOKEN, chainId: 1 }, fromAmount: "10000000", toAmount: "5000000", toAmountMin: "4950000",
  fromAmountUSD: "10.00", toAmountUSD: "9.70",
  steps: [
    { tool: "jupiter", action: { fromChainId: SOLANA }, estimate: { gasCosts: [{ amountUSD: "0.05", amount: "5000", token: { priceUSD: "150" } }], feeCosts: [{ name: "LI.FI Fixed Fee", amountUSD: "0.025", included: true }] } },
    { tool: "across", action: { fromChainId: 1 }, estimate: { gasCosts: [{ amountUSD: "9", amount: "999" }], feeCosts: [{ name: "Bridge fee", amountUSD: "0.10", included: false }] } },
  ],
  ...over,
});
const quoteBody = (over: Record<string, unknown> = {}) => ({
  tool: "mayan",
  action: { fromChainId: SOLANA, toChainId: 1, fromToken: { address: USDC_MINT, chainId: SOLANA }, toToken: { address: TOKEN, chainId: 1 }, fromAmount: "10000000", toAddress: USER_EVM.toLowerCase() },
  estimate: { toAmount: "5000000", toAmountMin: "4950000", gasCosts: [{ amountUSD: "0.05" }], feeCosts: [{ name: "LI.FI Fixed Fee", amountUSD: "0.025", included: true }], fromAmountUSD: "10", toAmountUSD: "9.5" },
  transactionRequest: { data: "AQID" },
  ...over,
});
const tools = { bridges: [{ key: "across", name: "Across" }, { key: "mayan", name: "Mayan" }, { key: "mayanSwift", name: "Mayan Swift" }, { key: "stargate", name: "Stargate" }], exchanges: [{ key: "uniswap", name: "Uniswap" }] };

beforeEach(async () => {
  await resetDb();
  await redis.flushdb();
  forgetRoutePolicy();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The adapter and routing tests talk to a stubbed fetch (no `mockChains`: the real `lifi` object is under test). */
const stubFetch = () => vi.stubGlobal("fetch", vi.fn());

describe("lifi estimate", () => {
  beforeEach(stubFetch);

  it("posts to /advanced/routes without fromAddress and maps the first route: amounts, own-chain gas, fees across steps, tools, price impact", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ routes: [route(), route({ toAmount: "1" })] }));
    const e = await lifi.estimate({ ...trade, deny: DENY });
    const { url, init } = calls()[0]!;
    expect(url.origin + url.pathname).toBe("https://li.quest/v1/advanced/routes");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ fromChainId: SOLANA, toChainId: 1, fromTokenAddress: USDC_MINT, toTokenAddress: TOKEN, fromAmount: "10000000", toAddress: USER_EVM });
    expect(body).not.toHaveProperty("fromAddress");
    expect(body.options).toEqual({ slippage: 0.01, integrator: "bytesac", maxPriceImpact: 0.05, bridges: { deny: DENY.bridges }, exchanges: { deny: DENY.exchanges } });
    expect(e).toMatchObject({ estimatedOut: 5_000_000n, minOut: 4_950_000n, toolSummary: "jupiter > across", transaction: null, gasNative: 5000n, nativePriceUsd: 150 });
    expect(e.gasEstimateUsd).toBeCloseTo(0.05);
    expect(e.routeFees).toEqual([{ name: "LI.FI Fixed Fee", amountUsd: 0.025, included: true }, { name: "Bridge fee", amountUsd: 0.1, included: false }]);
    expect(e.priceImpact).toBeCloseTo(0.0275);
  });

  it("priceImpact is null without USD values; a route for another trade is a provider error; no routes is ROUTE_UNAVAILABLE", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ routes: [route({ fromAmountUSD: undefined })] })).mockResolvedValueOnce(jsonResponse({ routes: [route({ fromAmount: "1" })] })).mockResolvedValueOnce(jsonResponse({ routes: [] }));
    expect((await lifi.estimate(trade)).priceImpact).toBeNull();
    await expect(lifi.estimate(trade)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
    await expect(lifi.estimate(trade)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE", message: "No route is available for this trade." });
  });

  it("routes hidden by the price-impact limit: ROUTE_UNAVAILABLE with the price-impact message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ routes: [], unavailableRoutes: { filteredOut: [{ reason: "Price impact too high" }], failed: [] } }));
    await expect(lifi.estimate(trade)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE", message: "Price impact too high for this trade size." });
  });
});

describe("lifi quote", () => {
  beforeEach(stubFetch);
  const input = { ...trade, fromAddress: USER_SOL, svmSponsor: "FeePayer11111111111111111111111111111111111" };

  it("sends maxPriceImpact and the deny lists (one param per tool), and reports route fees and price impact", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(quoteBody()));
    const q = await lifi.quote({ ...input, deny: DENY });
    const params = calls()[0]!.url.searchParams;
    expect(params.get("maxPriceImpact")).toBe("0.05");
    expect(params.getAll("denyBridges")).toEqual(DENY.bridges);
    expect(params.getAll("denyExchanges")).toEqual(DENY.exchanges);
    expect(q.routeFees).toEqual([{ name: "LI.FI Fixed Fee", amountUsd: 0.025, included: true }]);
    expect(q.priceImpact).toBeCloseTo(0.0475);
  });

  it("omits the deny params when nothing is denied", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(quoteBody()));
    await lifi.quote({ ...input, deny: { bridges: [], exchanges: [] } });
    const params = calls()[0]!.url.searchParams;
    expect(params.has("denyBridges") || params.has("denyExchanges")).toBe(false);
  });

  it("the no-SOL refusal is 409 SOL_REQUIRED; a price-impact refusal is 503 with its message; a 1001 keeps its code for the planner", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ message: "Your wallet needs SOL balance to cover the rent for the transaction", code: 1001 }, 400))
      .mockResolvedValueOnce(jsonResponse({ message: "No available quotes", code: 1002, errors: [{ reason: "price impact above the maximum" }] }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: "Failed to build transaction", code: 1001 }, 400));
    await expect(lifi.quote(input)).rejects.toMatchObject({ status: 409, code: "SOL_REQUIRED", message: "Add a small amount of SOL (~0.003) to your Solana wallet to continue." });
    await expect(lifi.quote(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE", message: "Price impact too high for this trade size." });
    await expect(lifi.quote(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE", lifiCode: 1001 });
  });
});

describe("lifi status", () => {
  beforeEach(stubFetch);
  const status = (body: unknown) => { vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body)); return lifi.status({ txHash: "0xabc", fromChain: "solana", toChain: "ethereum" }); };

  it("passes the substatus through; PARTIAL carries the token that arrived; a due refund keeps the leg pending", async () => {
    expect(await status({ status: "DONE", substatus: "COMPLETED", receiving: { txHash: "0xdest" } })).toEqual({ state: "DONE", destinationTx: "0xdest", substatus: "COMPLETED" });
    expect(await status({ status: "DONE", substatus: "PARTIAL", receiving: { txHash: "0xdest", token: { address: TOKEN, decimals: 6, symbol: "USDC" } } })).toMatchObject({
      state: "UNKNOWN", substatus: "PARTIAL", receiving: { txHash: "0xdest", token: { address: TOKEN, decimals: 6, symbol: "USDC" } },
    });
    expect(await status({ status: "DONE", substatus: "PARTIAL" })).toMatchObject({ state: "UNKNOWN", receiving: undefined });
    expect(await status({ status: "FAILED", substatus: "NOT_PROCESSABLE_REFUND_NEEDED" })).toEqual({ state: "PENDING", substatus: "NOT_PROCESSABLE_REFUND_NEEDED" });
    expect(await status({ status: "DONE", substatus: "REFUNDED" })).toMatchObject({ state: "FAILED", substatus: "REFUNDED" });
    expect(await status({ status: "PENDING", substatus: "WAIT_DESTINATION_TRANSACTION" })).toEqual({ state: "PENDING", substatus: "WAIT_DESTINATION_TRANSACTION" });
  });
});

describe("route deny list", () => {
  beforeEach(async () => {
    stubFetch();
    await seedUser(); // the policy rows need an author
  });
  const policy = (kind: "bridge" | "exchange", toolKey: string, removed = false) => adminSql`
    INSERT INTO app.route_policy_entries (id, kind, tool_key, reason, created_by, removed_at, removed_by)
    SELECT gen_random_uuid(), ${kind}::app.route_tool_kind, ${toolKey}, 'test', u.id, ${removed ? new Date() : null}, ${removed ? adminSql`u.id` : null} FROM app.users u LIMIT 1`;

  it("a contract destination adds every mayan* bridge to the policy keys; an EOA gets the policy keys only; removed rows are ignored", async () => {
    await policy("bridge", "stargate");
    await policy("exchange", "uniswap");
    await policy("bridge", "across", true);
    vi.mocked(fetch).mockResolvedValue(jsonResponse(tools));
    expect(await routeDenyList("ethereum", USER_EVM)).toEqual({ bridges: ["stargate"], exchanges: ["uniswap"] });
    expect(calls()).toHaveLength(0); // an EOA needs no tools list
    fakes.evm.contracts.add("0x2222222222222222222222222222222222222222");
    const deny = await routeDenyList("ethereum", "0x2222222222222222222222222222222222222222");
    expect([...deny.bridges].sort()).toEqual(["mayan", "mayanSwift", "stargate"]);
    expect(deny.exchanges).toEqual(["uniswap"]);
    await routeDenyList("base", "0x2222222222222222222222222222222222222222"); // the tools list is cached 1 h
    expect(calls()).toHaveLength(1);
  });

  it("a Solana destination is never checked for code; policy rows are cached 60 s in-process", async () => {
    expect(await routeDenyList("solana", USER_SOL)).toEqual({ bridges: [], exchanges: [] });
    await policy("bridge", "stargate");
    expect((await routeDenyList("solana", USER_SOL)).bridges).toEqual([]); // still the cached empty list
    forgetRoutePolicy();
    expect((await routeDenyList("solana", USER_SOL)).bridges).toEqual(["stargate"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Planners
// ---------------------------------------------------------------------------------------------------------------------

const SOL: SeedAsset = { symbol: "SOL", chain: "solana", tokenStandard: "native", bps: 5000, decimals: 9 };
const TKN: SeedAsset = { symbol: "TKN", chain: "solana", tokenStandard: "spl", bps: 5000, decimals: 6 };
const ETH: SeedAsset = { symbol: "ETH", chain: "ethereum", tokenStandard: "native", bps: 5000, decimals: 18 };
const post = (h: Record<string, string>, path: string, body: object) => request(app).post(path).set(h).send(body);
const invest = (h: Record<string, string>, basketId: string, key = "key-aaaaaaaa") => post(h, "/v1/operations/invest", { basketId, amountUsdc: "500", slippageBps: 100, idempotencyKey: key });

describe("planners", () => {
  it("a rebalance with zero free USDC and all value in assets plans: buys come from estimate (minOut = scaled toAmountMin), sells from quote, and the Solana gas reservation holds LI.FI's gas figure plus rent for the missing token account", async () => {
    const chain = mockChains();
    await seedPlatformWallets();
    const basket = await seedBasket({ assets: [SOL, TKN] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    await seedPrices(basket.deployments, ["100", "1"]);
    const [sol, tkn] = basket.deployments;
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: sol!.deploymentId, quantity: 10_000_000_000n }, { deploymentId: tkn!.deploymentId, quantity: 1_000_000_000n }]);
    await seedVersion(basket, 2, [3000, 7000]);
    chain.balances.set(balanceKey(user.solanaAddress, null), 10_000_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, tkn!.address), 1_000_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 0n);
    vi.mocked(lifi.estimate).mockImplementation(async (i) => ({
      estimatedOut: i.fromAmount * 2n, minOut: i.fromAmount * 2n - 7n, toolSummary: "est", transaction: null, gasEstimateUsd: 0.05, gasNative: 5_000n, nativePriceUsd: null, priceImpact: 0.01, routeFees: [{ name: "LI.FI Fixed Fee", amountUsd: 0.1, included: true }],
    }));

    const res = await post(user.h, "/v1/operations/rebalance", { positionId, target: "latest", slippageBps: 100, idempotencyKey: "reb-aaaaaaaa" });
    expect(res.status).toBe(201);
    expect(lifi.estimate).toHaveBeenCalledTimes(1); // the one buy
    expect(chain.quotes).toHaveLength(1); // the one sell
    expect(chain.quotes[0]!.fromAmount).toBe(4_000_000_000n);
    const legs = await adminSql<{ kind: string; amount_in: string; min_out: string | null; route_summary: { routeFees?: unknown; priceImpact?: number } | null; expected_tx: unknown }[]>`SELECT * FROM app.operation_legs WHERE operation_id = ${res.body.id} ORDER BY sequence`;
    const buy = legs[legs.length - 1]!;
    const planned = vi.mocked(lifi.estimate).mock.calls[0]![0].fromAmount; // the plan buy before the fee is held back from cash
    // minOut is toAmountMin scaled to the (fee-reduced) buy amount: (2 x planned - 7) x amount / planned
    expect(BigInt(buy.min_out!)).toBe(((planned * 2n - 7n) * BigInt(buy.amount_in)) / planned);
    expect(buy.route_summary).toMatchObject({ priceImpact: 0.01, routeFees: [{ name: "LI.FI Fixed Fee", amountUsd: 0.1, included: true }] });
    const [op] = await adminSql<{ gas_reserved: { solana: string } }[]>`SELECT gas_reserved FROM app.operations WHERE id = ${res.body.id}`;
    // the buy's estimate gas (5,000) + the missing token account's rent + the fee transfer and the sell; no priority-fee ceiling is assumed
    expect(BigInt(op!.gas_reserved.solana)).toBeGreaterThanOrEqual(5_000n + 2_039_280n + 10_000n);
    expect(BigInt(op!.gas_reserved.solana)).toBeLessThan(5_000n + 1_000_000n + 2_039_280n + 10_000n);
    expect(buy.expected_tx).toEqual({ reservedNative: String(5_000n + 2_039_280n) });
  });

  it("an invest whose plan quote LI.FI refuses with 1001 retries with estimate and plans; another failure still fails the plan", async () => {
    const chain = mockChains();
    await seedPlatformWallets();
    const basket = await seedBasket({ assets: [SOL, TKN] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 1_000_000_000n);
    vi.mocked(lifi.quote).mockRejectedValue(createHttpError("LI.FI responded 400", { code: "ROUTE_UNAVAILABLE", lifiCode: 1001 }));
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(201);
    expect(chain.estimates).toHaveLength(2);
    expect(res.body.legs.filter((l: { kind: string }) => l.kind !== "network_fee")).toHaveLength(2);
    vi.mocked(lifi.quote).mockRejectedValue(createHttpError("LI.FI responded 500", { code: "ROUTE_UNAVAILABLE" }));
    expect((await invest(user.h, basket.basketId, "key-bbbbbbbb")).status).toBe(409); // the first plan is still the user's active operation
    await adminSql`UPDATE app.operations SET status = 'CANCELLED'`;
    expect((await invest(user.h, basket.basketId, "key-cccccccc")).status).toBe(503);
  });

  it("the plan quote and the execution quote both carry the deny list; a contract destination adds the mayan bridges", async () => {
    const chain = mockChains();
    await seedPlatformWallets();
    stubFetchTools();
    const basket = await seedBasket({ assets: [ETH] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 1_000_000_000n);
    fakes.evm.contracts.add(user.evmAddress.toLowerCase());
    const res = await invest(user.h, basket.basketId);
    expect(res.status).toBe(201);
    const bridges = (call: number) => [...vi.mocked(lifi.quote).mock.calls[call]![0].deny!.bridges].sort();
    expect(bridges(0)).toEqual(["mayan", "mayanSwift"]);
    // The fee leg settles first (a Solana transfer the chain mock reports final), then the swap quote is taken with the same deny list.
    const [fee, swap] = res.body.legs as { id: string; kind: string }[];
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${res.body.id}`;
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE id = ${fee!.id}`;
    const q = await post(user.h, `/v1/operations/${res.body.id}/legs/${swap!.id}/quote`, {});
    expect(q.status).toBe(200);
    expect(vi.mocked(lifi.quote).mock.calls.at(-1)![0].deny!.bridges.sort()).toEqual(["mayan", "mayanSwift"]);
  });
});

function stubFetchTools() {
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(tools)));
}

// ---------------------------------------------------------------------------------------------------------------------
// Solana gas for estimate-path legs: LI.FI's figure (+ rent only for a missing account), topped up at quote time within the caps
// ---------------------------------------------------------------------------------------------------------------------

describe("estimated Solana gas", () => {
  const TOKENS: SeedAsset[] = Array.from({ length: 8 }, (_, n) => ({ symbol: `T${n}`, chain: "solana", tokenStandard: "spl", bps: 1000, decimals: 6 }));
  /** A rebalance that sells SOL (all value) and buys 8 SPL tokens from the proceeds: 8 estimate-path legs. `gasNative` is what LI.FI's estimate says. */
  async function planEight(opts: { accounts: boolean; gasNative: bigint }) {
    const chain = mockChains();
    await seedPlatformWallets();
    const basket = await seedBasket({ assets: [{ ...SOL, bps: 2000 }, ...TOKENS] });
    const user = await seedUser({ wallet: solanaTestWallet() });
    await seedPrices(basket.deployments, ["100", ...TOKENS.map(() => "1")]);
    const positionId = await seedPosition(user.userId, basket, [{ deploymentId: basket.deployments[0]!.deploymentId, quantity: 10_000_000_000n }]);
    await seedVersion(basket, 2, [2000, ...TOKENS.map(() => 1000)]);
    chain.balances.set(balanceKey(user.solanaAddress, null), 10_000_000_000n);
    chain.balances.set(balanceKey(user.solanaAddress, USDC_MINT), 0n);
    if (opts.accounts) for (const d of basket.deployments.slice(1)) chain.tokenAccounts.add(ata(new PublicKey(user.solanaAddress), new PublicKey(d.address!)).toBase58());
    vi.mocked(lifi.estimate).mockImplementation(async (i) => ({
      estimatedOut: i.fromAmount, minOut: (i.fromAmount * 95n) / 100n, toolSummary: "est", transaction: null, gasEstimateUsd: 0.01, gasNative: opts.gasNative, nativePriceUsd: null, priceImpact: null, routeFees: [],
    }));
    const res = await post(user.h, "/v1/operations/rebalance", { positionId, target: "latest", slippageBps: 100, idempotencyKey: "reb-aaaaaaaa" });
    return { chain, basket, user, positionId, res };
  }
  const reserved = async (opId: string) => BigInt((await adminSql<{ gas_reserved: { solana: string } }[]>`SELECT gas_reserved FROM app.operations WHERE id = ${opId}`)[0]!.gas_reserved.solana);

  it("8 buys stay inside the 0.02 SOL per-user cap when the token accounts exist (no per-buy constant), and the leg records what it reserved", async () => {
    const { res, user } = await planEight({ accounts: true, gasNative: 5_000n });
    expect(res.status).toBe(201);
    expect(res.body.legs.filter((l: { fromDeploymentId: string | null; kind: string }) => l.fromDeploymentId === null && l.kind !== "network_fee")).toHaveLength(8);
    const total = await reserved(res.body.id);
    expect(total).toBeLessThan(200_000n); // 8 x 5,000 + the fee transfer and the sell; no rent
    expect(await adminSql`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${user.userId}`).toEqual([{ amount_native: total.toString() }]);
    const buys = await adminSql<{ expected_tx: { reservedNative: string } }[]>`SELECT expected_tx FROM app.operation_legs WHERE operation_id = ${res.body.id} AND from_deployment_id IS NULL AND kind <> 'network_fee'`;
    expect(buys.map((b) => b.expected_tx.reservedNative)).toEqual(Array(8).fill("5000"));
  });

  /** The fee and sell legs are final and the basket holds the proceeds: the first buy can be quoted. */
  async function toFirstBuy(p: Awaited<ReturnType<typeof planEight>>) {
    const legs = await adminSql<{ id: string; kind: string; from_deployment_id: string | null }[]>`SELECT id, kind, from_deployment_id FROM app.operation_legs WHERE operation_id = ${p.res.body.id} ORDER BY sequence`;
    await adminSql`UPDATE app.operations SET status = 'IN_PROGRESS' WHERE id = ${p.res.body.id}`;
    const buys = legs.filter((l) => l.from_deployment_id === null && l.kind !== "network_fee");
    await adminSql`UPDATE app.operation_legs SET status = 'SETTLED' WHERE operation_id = ${p.res.body.id} AND id <> ALL(${buys.map((b) => b.id)})`;
    await adminSql`INSERT INTO app.position_cash_entries (id, position_id, amount_micro, reason, leg_id) VALUES (gen_random_uuid(), ${p.positionId}, 2000000000, 'rebalance_sell', ${legs[0]!.id})`;
    p.chain.balances.set(balanceKey(p.user.solanaAddress, USDC_MINT), 2_000_000_000n);
    return buys[0]!;
  }

  it("at quote time the reservation is topped up (under the same caps) when the built transaction needs more than LI.FI's figure", async () => {
    const p = await planEight({ accounts: true, gasNative: 1_000n });
    const before = await reserved(p.res.body.id);
    const buy = await toFirstBuy(p);
    const q = await post(p.user.h, `/v1/operations/${p.res.body.id}/legs/${buy.id}/quote`, {});
    expect(q.status).toBe(200);
    const after = await reserved(p.res.body.id);
    expect(after - before).toBe(9_000n); // the mocked transaction exposes the platform for 10,000 lamports (two signatures); 1,000 were reserved for the leg
    expect(await adminSql`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${p.user.userId}`).toEqual([{ amount_native: after.toString() }]);
    expect((await adminSql<{ expected_tx: { reservedNative: string } }[]>`SELECT expected_tx FROM app.operation_legs WHERE id = ${buy.id}`)[0]!.expected_tx.reservedNative).toBe("10000");
    // a second quote of the same leg reserves nothing more
    expect((await post(p.user.h, `/v1/operations/${p.res.body.id}/legs/${buy.id}/quote`, {})).status).toBe(200);
    expect(await reserved(p.res.body.id)).toBe(after);
  });

  it("a top-up that would exceed the daily cap is refused with 409 GAS_BUDGET_EXHAUSTED and nothing more is reserved", async () => {
    const p = await planEight({ accounts: true, gasNative: 1_000n });
    const before = await reserved(p.res.body.id);
    const buy = await toFirstBuy(p);
    await adminSql`UPDATE app.sponsor_usage SET amount_native = 20000000 - 1000 WHERE user_id = ${p.user.userId}`; // 0.02 SOL cap, 1,000 lamports of room
    const q = await post(p.user.h, `/v1/operations/${p.res.body.id}/legs/${buy.id}/quote`, {});
    expect(q.status).toBe(409);
    expect(q.body.error.code).toBe("GAS_BUDGET_EXHAUSTED");
    expect(await reserved(p.res.body.id)).toBe(before);
    expect((await adminSql<{ amount_native: string }[]>`SELECT amount_native FROM app.sponsor_usage WHERE user_id = ${p.user.userId}`)[0]!.amount_native).toBe("19999000");
  });
});

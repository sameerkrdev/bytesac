import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redis } from "../../src/middleware/rate-limit";
import { lifi } from "../../src/providers/routes/lifi";
import { selectRouteProvider } from "../../src/providers/routes";
import { USDC_MINT } from "./helpers";

const SOLANA = 1151111081099710;
const SPONSOR = "FeePayer11111111111111111111111111111111111";
const USER_SOL = "UserSo1111111111111111111111111111111111111";
const USER_EVM = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const TOKEN = "0x1111111111111111111111111111111111111111";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const calls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => ({ url: new URL(c[0] as string), init: c[1] as RequestInit }));

/** A LI.FI quote for USDC (Solana) -> TOKEN (Ethereum) as the API would return it. */
const quoteBody = (over: { toAddress?: string; toToken?: string; toAmountMin?: string; fromAmount?: string } = {}) => ({
  tool: "mayan",
  action: {
    fromChainId: SOLANA, toChainId: 1, fromToken: { address: USDC_MINT, chainId: SOLANA }, toToken: { address: over.toToken ?? TOKEN, chainId: 1 },
    fromAmount: over.fromAmount ?? "10000000", toAddress: over.toAddress ?? USER_EVM.toLowerCase(),
  },
  estimate: { toAmount: "5000000", toAmountMin: over.toAmountMin ?? "4950000", gasCosts: [{ amountUSD: "0.05" }, { amountUSD: "0.02" }] },
  transactionRequest: { data: "AQID" },
});
const input = { fromChain: "solana", fromToken: USDC_MINT, toChain: "ethereum", toToken: TOKEN, fromAmount: 10_000_000n, fromAddress: USER_SOL, toAddress: USER_EVM, slippageBps: 100, svmSponsor: SPONSOR } as const;

beforeEach(async () => {
  await redis.flushdb();
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("lifi quote", () => {
  it("sends toAddress, svmSponsor, slippage, integrator and the API key, and parses the Solana transaction", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(quoteBody()));
    const q = await lifi.quote(input);
    const { url, init } = calls()[0]!;
    expect(url.origin + url.pathname).toBe("https://li.quest/v1/quote");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      fromChain: String(SOLANA), toChain: "1", fromToken: USDC_MINT, toToken: TOKEN, fromAmount: "10000000", fromAddress: USER_SOL, toAddress: USER_EVM, slippage: "0.01", integrator: "bytesac", svmSponsor: SPONSOR,
    });
    expect((init.headers as Record<string, string>)["x-lifi-api-key"]).toBe("test-lifi-key");
    expect(q).toMatchObject({ estimatedOut: 5_000_000n, minOut: 4_950_000n, toolSummary: "mayan", transaction: { kind: "solana", serializedBase64: "AQID" } });
    expect(q.gasEstimateUsd).toBeCloseTo(0.07);
    expect(q.expiresAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it("does not send svmSponsor for a non-Solana source and refuses a Solana source without one", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...quoteBody(), action: { ...quoteBody().action, fromChainId: 1, toChainId: SOLANA, fromToken: { address: TOKEN.toUpperCase().replace("0X", "0x"), chainId: 1 }, toToken: { address: USDC_MINT, chainId: SOLANA }, toAddress: USER_SOL }, transactionRequest: { to: TOKEN, data: "0xabcd", value: "0x10", chainId: 1 } }));
    const q = await lifi.quote({ ...input, fromChain: "ethereum", fromToken: TOKEN, toChain: "solana", toToken: USDC_MINT, toAddress: USER_SOL, fromAddress: USER_EVM, svmSponsor: undefined });
    expect(calls()[0]!.url.searchParams.has("svmSponsor")).toBe(false);
    expect(q.transaction).toEqual({ kind: "evm", to: TOKEN, data: "0xabcd", value: "16", chainId: 1 });
    await expect(lifi.quote({ ...input, svmSponsor: undefined })).rejects.toThrow("svmSponsor");
  });

  it("converts a hex Bitcoin PSBT to base64", async () => {
    const psbt = Buffer.from("70736274ff0100", "hex");
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...quoteBody(), action: { ...quoteBody().action, fromChainId: 20000000000001, fromToken: { address: "bitcoin", chainId: 20000000000001 }, toChainId: SOLANA, toToken: { address: USDC_MINT, chainId: SOLANA }, toAddress: USER_SOL }, transactionRequest: { data: psbt.toString("hex") } }));
    const q = await lifi.quote({ ...input, fromChain: "bitcoin", fromToken: null, toChain: "solana", toToken: USDC_MINT, toAddress: USER_SOL, fromAddress: "bc1qxyz", fromAmount: 10_000_000n, svmSponsor: undefined });
    expect(q.transaction).toEqual({ kind: "bitcoin", psbtBase64: psbt.toString("base64") });
    expect(calls()[0]!.url.searchParams.get("fromToken")).toBe("bitcoin");
  });

  it.each([
    ["another toAddress", quoteBody({ toAddress: "0x2222222222222222222222222222222222222222" })],
    ["another destination token", quoteBody({ toToken: "0x3333333333333333333333333333333333333333" })],
    ["another amount", quoteBody({ fromAmount: "20000000" })],
    ["a weaker minimum output than the chosen slippage", quoteBody({ toAmountMin: "4000000" })],
  ])("treats %s as a provider error", async (_name, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));
    await expect(lifi.quote(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
  });

  it("treats HTTP errors and malformed bodies as provider errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 500)).mockResolvedValueOnce(jsonResponse({ nope: 1 }));
    await expect(lifi.quote(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
    await expect(lifi.quote(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
  });
});

describe("lifi quote with a realistic LI.FI body (C1 regression)", () => {
  /** estimate.gasCosts entries as LI.FI returns them: amount in the native token's base units, amountUSD, and the native token. */
  const gasCosts = [
    { type: "SEND", price: "0.0000001", estimate: "5000", limit: "6000", amount: "21000000000", amountUSD: "0.0315", token: { address: "11111111111111111111111111111111", chainId: SOLANA, symbol: "SOL", decimals: 9, priceUSD: "150.5" } },
    { type: "SEND", amount: "5000", amountUSD: "0.0007", token: { address: "11111111111111111111111111111111", chainId: SOLANA, symbol: "SOL", decimals: 9, priceUSD: "150.5" } },
  ];
  it("parses estimate.gasCosts[].amount (the pattern once matched only the letter d, so every real quote was rejected) and sums gasNative", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...quoteBody(), estimate: { ...quoteBody().estimate, gasCosts } }));
    const q = await lifi.quote(input);
    expect(q.gasNative).toBe(21_000_005_000n);
    expect(q.gasEstimateUsd).toBeCloseTo(0.0322);
    expect(q.nativePriceUsd).toBe(150.5);
  });
  it("refuses a gas amount that is not an integer string, and an amountUSD that is not a decimal", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...quoteBody(), estimate: { ...quoteBody().estimate, gasCosts: [{ amount: "2.1e10", amountUSD: "0.03" }] } }));
    await expect(lifi.quote(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ ...quoteBody(), estimate: { ...quoteBody().estimate, gasCosts: [{ amount: "5", amountUSD: "NaN" }] } }));
    await expect(lifi.quote(input)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
  });
});

describe("lifi status", () => {
  const status = (body: unknown) => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(body));
    return lifi.status({ txHash: "0xabc", fromChain: "solana", toChain: "ethereum" });
  };
  it("maps LI.FI statuses", async () => {
    expect(await status({ status: "PENDING" })).toEqual({ state: "PENDING" });
    expect(await status({ status: "NOT_FOUND" })).toEqual({ state: "PENDING" });
    // the amount LI.FI reports is deliberately not surfaced: what arrived is read from the chain
    expect(await status({ status: "DONE", substatus: "COMPLETED", receiving: { txHash: "0xdest", amount: "123" } })).toEqual({ state: "DONE", destinationTx: "0xdest" });
    expect(await status({ status: "DONE", substatus: "PARTIAL" })).toEqual({ state: "UNKNOWN", reason: expect.any(String) }); // a different token was delivered: funds moved, never written off
    expect(await status({ status: "DONE", substatus: "REFUNDED" })).toEqual({ state: "FAILED", reason: "REFUNDED" });
    expect(await status({ status: "FAILED", substatus: "OUT_OF_GAS" })).toEqual({ state: "FAILED", reason: "OUT_OF_GAS" });
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ status: "INVALID" }));
    await expect(lifi.status({ txHash: "x", fromChain: "solana", toChain: "ethereum" })).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
  });
});

describe("lifi connections", () => {
  const connected = { connections: [{ fromTokens: [{ address: USDC_MINT, chainId: SOLANA }], toTokens: [{ address: TOKEN.toUpperCase().replace("0X", "0x"), chainId: 1 }] }] };
  it("is true only when both tokens are listed, and is cached for an hour", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(connected));
    const i = { fromChain: "solana", fromToken: USDC_MINT, toChain: "ethereum", toToken: TOKEN } as const;
    expect(await lifi.connections(i)).toBe(true);
    expect(await lifi.connections(i)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await redis.ttl(`lifi:conn:${SOLANA}:${USDC_MINT}:1:${TOKEN}`)).toBeGreaterThan(3500);
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ connections: [] }));
    expect(await lifi.connections({ ...i, toToken: "0x4444444444444444444444444444444444444444" })).toBe(false);
  });
  it("does not cache provider failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({}, 502)).mockResolvedValueOnce(jsonResponse(connected));
    const i = { fromChain: "solana", fromToken: USDC_MINT, toChain: "ethereum", toToken: TOKEN } as const;
    await expect(lifi.connections(i)).rejects.toMatchObject({ code: "ROUTE_UNAVAILABLE" });
    expect(await lifi.connections(i)).toBe(true);
  });
});

describe("provider selection", () => {
  it("matches the registry provider name against ROUTE_PROVIDER_ORDER", () => {
    expect(selectRouteProvider(["LI.FI"])?.id).toBe("lifi");
    expect(selectRouteProvider(["Jupiter"])).toBeUndefined();
  });
});

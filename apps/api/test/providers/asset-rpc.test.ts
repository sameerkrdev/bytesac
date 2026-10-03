import { RpcRequestError, encodeAbiParameters, encodeFunctionResult, erc20Abi, multicall3Abi } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: async (_args: { method: string }): Promise<unknown> => undefined }));

// Replace only the HTTP transport: the multicall classification under test runs against a scripted node.
vi.mock("viem", async (importOriginal) => {
  const viem = await importOriginal<typeof import("viem")>();
  return { ...viem, http: () => viem.custom({ request: ((args: { method: string }) => transport.request(args)) as never }, { retryCount: 0 }) };
});

const { readTokenMetadata } = await vi.importActual<typeof import("@/providers/evm-rpc")>("@/providers/evm-rpc");
const { getMintDecimals } = await vi.importActual<typeof import("@/providers/solana-rpc")>("@/providers/solana-rpc");

const unavailable = { code: "VERIFIER_UNAVAILABLE" };
const token = { chain: "base" as const, address: `0x${"ab".repeat(20)}` };
const ok = (name: "decimals" | "symbol" | "name", value: number | string) => ({ success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: name, result: value as never }) });
const failed = { success: false, returnData: "0x" as const };
const multicall = (results: Array<{ success: boolean; returnData: `0x${string}` }>) => encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: results });
const readWith = (request: (a: { method: string }) => Promise<unknown>) => {
  transport.request = request;
  return readTokenMetadata(token);
};

describe("readTokenMetadata", () => {
  it("returns decimals, symbol and name", async () => {
    expect(await readWith(async () => multicall([ok("decimals", 6), ok("symbol", "USDC"), ok("name", "USD Coin")]))).toEqual({ decimals: 6, symbol: "USDC", name: "USD Coin" });
  });
  it("a token without readable symbol and name still verifies", async () => {
    expect(await readWith(async () => multicall([ok("decimals", 8), failed, { success: true, returnData: encodeAbiParameters([{ type: "bytes32" }], [`0x${"00".repeat(32)}`]) }]))).toEqual({ decimals: 8, symbol: null, name: null });
  });
  it("failing decimals (not an ERC-20) -> null", async () => {
    expect(await readWith(async () => multicall([failed, failed, failed]))).toBeNull();
  });
  it("an address with no code (empty return data) -> null", async () => {
    expect(await readWith(async () => multicall([{ success: true, returnData: "0x" }, { success: true, returnData: "0x" }, { success: true, returnData: "0x" }]))).toBeNull();
  });
  it("network throw -> 503 VERIFIER_UNAVAILABLE", async () => {
    await expect(readWith(async () => { throw new TypeError("fetch failed"); })).rejects.toMatchObject(unavailable);
  });
  it("rate-limit RPC error -> 503 VERIFIER_UNAVAILABLE", async () => {
    await expect(readWith(async () => { throw new RpcRequestError({ body: {}, error: { code: -32005, message: "rate limited" }, url: "http://x" }); })).rejects.toMatchObject(unavailable);
  });
});

describe("getMintDecimals", () => {
  afterEach(() => vi.unstubAllGlobals());
  const rpc = (body: unknown, status = 200) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("posts a read-only getTokenSupply and returns the decimals", async () => {
    const fetchMock = rpc({ jsonrpc: "2.0", id: 1, result: { context: { slot: 1 }, value: { amount: "100", decimals: 6, uiAmount: 0.0001, uiAmountString: "0.0001" } } });
    expect(await getMintDecimals("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(6);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/solana-mainnet\.g\.alchemy\.com\/v2\//);
    expect(JSON.parse(init.body as string)).toEqual({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"] });
  });
  it("RPC error -32602 (not a mint) -> null", async () => {
    rpc({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "Invalid param: not a Token mint" } });
    expect(await getMintDecimals("11111111111111111111111111111111")).toBeNull();
  });
  it("other RPC errors, HTTP failures, network failures and malformed bodies -> 503", async () => {
    rpc({ jsonrpc: "2.0", id: 1, error: { code: -32005, message: "node is behind" } });
    await expect(getMintDecimals("x")).rejects.toMatchObject(unavailable);
    rpc({}, 503);
    await expect(getMintDecimals("x")).rejects.toMatchObject(unavailable);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    await expect(getMintDecimals("x")).rejects.toMatchObject(unavailable);
    rpc({ result: { value: { decimals: "six" } } });
    await expect(getMintDecimals("x")).rejects.toMatchObject(unavailable);
  });
});

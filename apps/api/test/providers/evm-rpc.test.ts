import { RpcRequestError } from "viem";
import { describe, expect, it, vi } from "vitest";

const transport = vi.hoisted(() => ({ request: async (_args: { method: string }): Promise<unknown> => undefined }));

// Replace only the HTTP transport: the classification logic under test runs against a scripted node.
vi.mock("viem", async (importOriginal) => {
  const viem = await importOriginal<typeof import("viem")>();
  return { ...viem, http: () => viem.custom({ request: ((args: { method: string }) => transport.request(args)) as never }, { retryCount: 0 }) };
});

const { verifyContractSignature } = await vi.importActual<typeof import("../../src/providers/evm-rpc")>("../../src/providers/evm-rpc");

const input = { chain: "base" as const, address: ("0x" + "ab".repeat(20)) as `0x${string}`, message: "hi", signature: ("0x" + "11".repeat(100)) as `0x${string}` };
const verifyWith = (request: (a: { method: string }) => Promise<unknown>) => {
  transport.request = request;
  return verifyContractSignature(input);
};
const rpcError = (code: number, message: string) => new RpcRequestError({ body: {}, error: { code, message }, url: "http://x" });
const unavailable = { code: "VERIFIER_UNAVAILABLE" };

describe("verifyContractSignature classification", () => {
  it("network throw -> 503 VERIFIER_UNAVAILABLE", async () => {
    await expect(verifyWith(async () => { throw new TypeError("fetch failed"); })).rejects.toMatchObject(unavailable);
  });
  it("rate-limit RPC error -> 503 VERIFIER_UNAVAILABLE", async () => {
    await expect(verifyWith(async () => { throw rpcError(-32005, "rate limited"); })).rejects.toMatchObject(unavailable);
  });
  it("internal RPC error -> 503 VERIFIER_UNAVAILABLE", async () => {
    await expect(verifyWith(async () => { throw rpcError(-32603, "internal error"); })).rejects.toMatchObject(unavailable);
  });
  it("execution revert -> false", async () => {
    expect(await verifyWith(async () => { throw rpcError(3, "execution reverted"); })).toBe(false);
  });
  it("non-magic / false result -> false", async () => {
    expect(await verifyWith(async () => "0x" + "00".repeat(32))).toBe(false);
  });
  it("valid result -> true", async () => {
    expect(await verifyWith(async () => "0x" + "00".repeat(31) + "01")).toBe(true);
  });
});

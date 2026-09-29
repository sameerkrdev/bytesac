import { custom, RpcRequestError } from "viem";
import { describe, expect, it } from "vitest";
import { AlchemyEvmRpc, VerifierUnavailableError } from "../../src/adapters/evm-rpc.js";

const input = { chain: "base" as const, address: ("0x" + "ab".repeat(20)) as `0x${string}`, message: "hi", signature: ("0x" + "11".repeat(100)) as `0x${string}` };
const rpc = (request: (a: { method: string }) => Promise<unknown>) =>
  new AlchemyEvmRpc(() => custom({ request: request as never }, { retryCount: 0 }));
const rpcError = (code: number, message: string) => new RpcRequestError({ body: {}, error: { code, message }, url: "http://x" });

describe("AlchemyEvmRpc classification", () => {
  it("network throw -> VerifierUnavailableError", async () => {
    await expect(rpc(async () => { throw new TypeError("fetch failed"); }).verifyContractSignature(input)).rejects.toBeInstanceOf(VerifierUnavailableError);
  });
  it("rate-limit RPC error -> VerifierUnavailableError", async () => {
    await expect(rpc(async () => { throw rpcError(-32005, "rate limited"); }).verifyContractSignature(input)).rejects.toBeInstanceOf(VerifierUnavailableError);
  });
  it("internal RPC error -> VerifierUnavailableError", async () => {
    await expect(rpc(async () => { throw rpcError(-32603, "internal error"); }).verifyContractSignature(input)).rejects.toBeInstanceOf(VerifierUnavailableError);
  });
  it("execution revert -> false", async () => {
    expect(await rpc(async () => { throw rpcError(3, "execution reverted"); }).verifyContractSignature(input)).toBe(false);
  });
  it("non-magic / false result -> false", async () => {
    expect(await rpc(async () => "0x" + "00".repeat(32)).verifyContractSignature(input)).toBe(false);
  });
  it("valid result -> true", async () => {
    expect(await rpc(async () => "0x" + "00".repeat(31) + "01").verifyContractSignature(input)).toBe(true);
  });
});

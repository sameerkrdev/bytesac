import createHttpError from "http-errors";
import { createPublicClient, erc20Abi, http, RpcRequestError, type Transport } from "viem";
import type { AssetChain, Chain } from "@repo/validator";
import { env } from "../env";

const ALCHEMY_HOST: Partial<Record<AssetChain, string>> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  bnb: "bnb-mainnet",
  arbitrum: "arb-mainnet",
};

/** A JSON-RPC error that means "the call executed and reverted" (definitive), as opposed to node/rate-limit/internal errors. */
function isDefinitiveRevert(err: unknown): boolean {
  if (!(err instanceof RpcRequestError)) return false;
  return err.code === 3 || /execution reverted|revert/i.test(err.message + " " + String(err.details ?? ""));
}

/**
 * viem turns any eth_call failure (transport errors included) into "invalid" / a failed result. So we observe transport-level failures ourselves:
 * a failure that is not a definitive revert is remembered in `state.failure` and callers report it as unavailable.
 */
function observedClient(host: string) {
  const state: { failure?: unknown } = {};
  const base = http(`https://${host}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, { timeout: 5_000, retryCount: 1 });
  const observed: Transport = (args) => {
    const t = base(args);
    return {
      ...t,
      request: (async (req: unknown) => {
        try {
          return await (t.request as (r: unknown) => Promise<unknown>)(req);
        } catch (err) {
          if (!isDefinitiveRevert(err)) state.failure ??= err;
          throw err;
        }
      }) as typeof t.request,
    };
  };
  return { client: createPublicClient({ transport: observed }), state };
}

const unavailable = (message: string, cause: unknown) => createHttpError(message, { code: "VERIFIER_UNAVAILABLE", cause });

/**
 * ERC-1271 / ERC-6492 validation on `chain`. Returns false for a definitive "not valid";
 * throws 503 VERIFIER_UNAVAILABLE on transport failures.
 */
export async function verifyContractSignature(i: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean> {
  const host = ALCHEMY_HOST[i.chain];
  if (!host) throw new Error("not an EVM chain");
  const failed = (cause: unknown) => unavailable("Wallet verification is temporarily unavailable. Please try again.", cause);
  const { client, state } = observedClient(host);
  let result: boolean;
  try {
    result = await client.verifyMessage({ address: i.address, message: i.message, signature: i.signature });
  } catch (err) {
    // Unknown/unclassified errors are treated as unavailable, never as "not valid".
    throw failed(state.failure ?? err);
  }
  if (state.failure !== undefined) throw failed(state.failure);
  return result;
}

/** Multicall3 has the same address on every chain the registry verifies. */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * ERC-20 `decimals`/`symbol`/`name` in one read-only call. Returns null when the address is not an ERC-20 (`decimals` fails on-chain);
 * any transport or node failure throws 503 VERIFIER_UNAVAILABLE, never null.
 */
export async function readTokenMetadata(i: { chain: AssetChain; address: string }): Promise<{ decimals: number; symbol: string | null; name: string | null } | null> {
  const host = ALCHEMY_HOST[i.chain];
  if (!host) throw new Error("not an on-chain verified chain");
  const failed = (cause: unknown) => unavailable("Token verification is temporarily unavailable. Please try again.", cause);
  const { client, state } = observedClient(host);
  const token = { address: i.address as `0x${string}`, abi: erc20Abi } as const;
  let results;
  try {
    results = await client.multicall({
      contracts: [{ ...token, functionName: "decimals" }, { ...token, functionName: "symbol" }, { ...token, functionName: "name" }],
      multicallAddress: MULTICALL3,
      allowFailure: true,
    });
  } catch (err) {
    throw failed(state.failure ?? err);
  }
  // allowFailure also swallows a failed aggregate call, so a transport failure shows up as failed results.
  if (state.failure !== undefined) throw failed(state.failure);
  const [decimals, symbol, name] = results;
  if (decimals.status === "failure") return null;
  return { decimals: decimals.result, symbol: symbol.status === "success" ? symbol.result : null, name: name.status === "success" ? name.result : null };
}

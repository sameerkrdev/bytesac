import createHttpError from "http-errors";
import { createPublicClient, http, RpcRequestError, type Transport } from "viem";
import type { Chain } from "@repo/validator";
import { env } from "../env";

const ALCHEMY_HOST: Partial<Record<Chain, string>> = {
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
 * ERC-1271 / ERC-6492 validation on `chain`. Returns false for a definitive "not valid";
 * throws 503 VERIFIER_UNAVAILABLE on transport failures.
 */
export async function verifyContractSignature(i: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean> {
  const host = ALCHEMY_HOST[i.chain];
  if (!host) throw new Error("not an EVM chain");
  const unavailable = (cause: unknown) => createHttpError("Wallet verification is temporarily unavailable. Please try again.", { code: "VERIFIER_UNAVAILABLE", cause });
  // viem's verifyMessage converts *any* eth_call failure (including transport errors) into "invalid".
  // So we observe transport-level failures ourselves: a failure that is not a definitive revert => unavailable.
  let transportFailure: unknown;
  const base = http(`https://${host}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, { timeout: 5_000, retryCount: 1 });
  const observed: Transport = (args) => {
    const t = base(args);
    return {
      ...t,
      request: (async (req: unknown) => {
        try {
          return await (t.request as (r: unknown) => Promise<unknown>)(req);
        } catch (err) {
          if (!isDefinitiveRevert(err)) transportFailure ??= err;
          throw err;
        }
      }) as typeof t.request,
    };
  };
  const client = createPublicClient({ transport: observed });
  let result: boolean;
  try {
    result = await client.verifyMessage({ address: i.address, message: i.message, signature: i.signature });
  } catch (err) {
    // Unknown/unclassified errors are treated as unavailable, never as "not valid".
    throw unavailable(transportFailure ?? err);
  }
  if (transportFailure !== undefined) throw unavailable(transportFailure);
  return result;
}

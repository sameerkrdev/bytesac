import type { Chain } from "@repo/validator";
import { createPublicClient, http, RpcRequestError, type Transport } from "viem";
export class VerifierUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) { super(message, options); this.name = "VerifierUnavailableError"; }
}
export interface EvmRpc {
  /** ERC-1271 / ERC-6492 validation on `chain`. Returns false for a definitive "not valid"; throws VerifierUnavailableError on transport failures. */
  verifyContractSignature(input: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean>;
}

const ALCHEMY_HOST: Record<Exclude<Chain, "solana">, string> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  bnb: "bnb-mainnet",
  arbitrum: "arb-mainnet",
};

export type EvmTransportFactory = (chain: Chain) => Transport;

const defaultTransportFactory = (apiKey: string): EvmTransportFactory => (chain) => {
  if (chain === "solana") throw new Error("not an EVM chain");
  return http(`https://${ALCHEMY_HOST[chain]}.g.alchemy.com/v2/${apiKey}`, { timeout: 5_000, retryCount: 1 });
};

/** A JSON-RPC error that means "the call executed and reverted" (definitive), as opposed to node/rate-limit/internal errors. */
function isDefinitiveRevert(err: unknown): boolean {
  if (!(err instanceof RpcRequestError)) return false;
  return err.code === 3 || /execution reverted|revert/i.test(err.message + " " + String(err.details ?? ""));
}

export class AlchemyEvmRpc implements EvmRpc {
  private readonly transportFor: EvmTransportFactory;
  /** `apiKey` builds the default Alchemy HTTP transport; pass a factory to inject another (tests). */
  constructor(apiKeyOrTransport: string | EvmTransportFactory) {
    this.transportFor = typeof apiKeyOrTransport === "string" ? defaultTransportFactory(apiKeyOrTransport) : apiKeyOrTransport;
  }

  async verifyContractSignature(i: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean> {
    // viem's verifyHash converts *any* eth_call failure (including transport errors) into "invalid".
    // So we observe transport-level failures ourselves: a failure that is not a definitive revert => unavailable.
    let transportFailure: unknown;
    const base = this.transportFor(i.chain);
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
      throw new VerifierUnavailableError("EVM RPC unavailable", { cause: transportFailure ?? err });
    }
    if (transportFailure !== undefined) throw new VerifierUnavailableError("EVM RPC unavailable", { cause: transportFailure });
    return result;
  }
}

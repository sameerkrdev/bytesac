import type { Chain } from "@repo/contracts";
import { createPublicClient, http, HttpRequestError, RpcRequestError, TimeoutError, type PublicClient } from "viem";
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

export class AlchemyEvmRpc implements EvmRpc {
  private readonly clients = new Map<Chain, PublicClient>();
  constructor(private readonly apiKey: string) {}

  private client(chain: Chain): PublicClient {
    if (chain === "solana") throw new Error("not an EVM chain");
    let c = this.clients.get(chain);
    if (!c) {
      c = createPublicClient({ transport: http(`https://${ALCHEMY_HOST[chain]}.g.alchemy.com/v2/${this.apiKey}`, { timeout: 5_000, retryCount: 1 }) });
      this.clients.set(chain, c);
    }
    return c;
  }

  async verifyContractSignature(i: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean> {
    try {
      // viem handles ERC-1271 (deployed) and ERC-6492 (counterfactual) via eth_call.
      return await this.client(i.chain).verifyMessage({ address: i.address, message: i.message, signature: i.signature });
    } catch (err) {
      if (err instanceof HttpRequestError || err instanceof TimeoutError || err instanceof RpcRequestError) {
        throw new VerifierUnavailableError("EVM RPC unavailable", { cause: err });
      }
      return false; // reverted / malformed contract response: definitive "not valid"
    }
  }
}

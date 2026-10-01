import type { AssetChain } from "@repo/validator";

/** `null` token = the chain's native asset; otherwise the deployment address (EVM lowercase hex, Solana base58). */
export interface ConnectionInput { fromChain: AssetChain; fromToken: string | null; toChain: AssetChain; toToken: string | null }

export interface LegQuoteInput extends ConnectionInput {
  /** Raw base units of the source token. */
  fromAmount: bigint;
  fromAddress: string;
  /** The user's own address on the destination chain. */
  toAddress: string;
  slippageBps: number;
  /** Platform fee payer; required when the source is Solana. */
  svmSponsor?: string;
}

export type LegTransaction =
  | { kind: "solana"; serializedBase64: string }
  | { kind: "evm"; to: string; data: string; value: string; chainId: number }
  | { kind: "bitcoin"; psbtBase64: string };

export interface LegQuote {
  estimatedOut: bigint;
  /** What the route transaction enforces on-chain. */
  minOut: bigint;
  toolSummary: string;
  transaction: LegTransaction;
  gasEstimateUsd: number;
  /** Estimated gas in the source chain's native base units (lamports, wei). */
  gasNative: bigint;
  /** EVM ERC-20 sources: the contract the user approves (exact amount) before the transaction. */
  approvalAddress: string | null;
  expiresAt: Date;
}

export type LegStatus =
  | { state: "PENDING" }
  | { state: "DONE"; destinationTx: string | null; receivedAmount: bigint | null }
  | { state: "FAILED"; reason: string };

/** Route providers sit behind this interface; selection follows `ROUTE_PROVIDER_ORDER`. A provider error is a 503 `ROUTE_UNAVAILABLE`. */
export interface RouteProvider {
  id: "lifi";
  connections(i: ConnectionInput): Promise<boolean>;
  quote(i: LegQuoteInput): Promise<LegQuote>;
  status(i: { txHash: string; fromChain: AssetChain; toChain: AssetChain }): Promise<LegStatus>;
}

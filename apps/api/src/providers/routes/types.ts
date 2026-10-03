import type { AssetChain } from "@repo/validator";

/** `null` token = the chain's native asset; otherwise the deployment address (EVM lowercase hex, Solana base58). */
export interface ConnectionInput { fromChain: AssetChain; fromToken: string | null; toChain: AssetChain; toToken: string | null }

/** LI.FI tool keys (`/v1/tools`) to leave out of every route: the ops deny list plus Mayan for a contract destination. */
export interface RouteDeny { bridges: string[]; exchanges: string[] }

export interface LegQuoteInput extends ConnectionInput {
  /** Raw base units of the source token. */
  fromAmount: bigint;
  fromAddress: string;
  deny?: RouteDeny;
  /** The user's own address on the destination chain. */
  toAddress: string;
  slippageBps: number;
  /** The destination token's decimals from OUR registry (never the provider's response): the output tolerance scales with it. */
  toDecimals: number;
  /** Platform fee payer; required when the source is Solana. */
  svmSponsor?: string;
}

export type LegTransaction =
  | { kind: "solana"; serializedBase64: string }
  | { kind: "evm"; to: string; data: string; value: string; chainId: number }
  | { kind: "bitcoin"; psbtBase64: string };

/** A plan-time estimate needs no funded wallet: `fromAddress` is not sent. Never authorizes anything. */
export type LegEstimateInput = Omit<LegQuoteInput, "fromAddress" | "svmSponsor">;

export interface RouteFee { name: string; amountUsd: number; included: boolean }

export interface LegEstimate {
  estimatedOut: bigint;
  minOut: bigint;
  toolSummary: string;
  transaction: null;
  gasEstimateUsd: number;
  gasNative: bigint;
  nativePriceUsd: number | null;
  /** 1 - toAmountUSD / fromAmountUSD; null when LI.FI gives no USD values. */
  priceImpact: number | null;
  routeFees: RouteFee[];
}

export interface LegQuote extends Omit<LegEstimate, "transaction"> {
  transaction: LegTransaction;
  /** EVM ERC-20 sources: the contract the user approves (exact amount) before the transaction. */
  approvalAddress: string | null;
  expiresAt: Date;
}

export type LegStatus =
  /** `substatus`: LI.FI's own wording (for example NOT_PROCESSABLE_REFUND_NEEDED while a refund is due), shown to the user. */
  | { state: "PENDING"; substatus?: string }
  | { state: "DONE"; destinationTx: string | null; substatus?: string }
  | { state: "FAILED"; reason: string; substatus?: string }
  /** Funds may have moved but not as quoted (LI.FI PARTIAL): `receiving` is the token that arrived (a failed destination swap), when LI.FI says. */
  | { state: "UNKNOWN"; reason: string; substatus?: string; receiving?: { txHash: string; token: { address: string; decimals: number; symbol: string } } };

/** Route providers sit behind this interface; selection follows `ROUTE_PROVIDER_ORDER`. A provider error is a 503 `ROUTE_UNAVAILABLE`. */
export interface RouteProvider {
  id: "lifi";
  connections(i: ConnectionInput): Promise<boolean>;
  quote(i: LegQuoteInput): Promise<LegQuote>;
  estimate(i: LegEstimateInput): Promise<LegEstimate>;
  status(i: { txHash: string; fromChain: AssetChain; toChain: AssetChain }): Promise<LegStatus>;
}

import { z } from "zod";
import { assetChainSchema } from "./assets";
import { challengeResponseSchema } from "./auth";
import { decimalStringSchema } from "./baskets";
import { chainFamilySchema } from "./chains";
import { operationFeeViewSchema } from "./fees";
import { positionExtrasSchema, repairSchema } from "./rebalance";

export const LEG_STATES = ["PLANNED", "SUBMITTING", "SUBMITTED", "PENDING_CHAIN", "SETTLED", "FAILED", "UNKNOWN"] as const;
export const OPERATION_STATES = ["PLANNED", "IN_PROGRESS", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"] as const;
export const LEG_KINDS = ["network_fee", "swap", "cross_chain"] as const;
export const GAS_PAYERS = ["platform_fee_payer", "platform_gas_drop", "user_btc_inputs"] as const;
export const OPERATION_KINDS = ["invest", "sell_to_usdc", "sell_former", "rebalance", "repair"] as const;
export type LegState = (typeof LEG_STATES)[number];
export type OperationState = (typeof OPERATION_STATES)[number];

/** PLANNED may fail without ever being sent (a rebalance buy left with no cash). SUBMITTING is the claim taken before anything is sent: a refused send returns to PLANNED, a sent (or unknown) one is SUBMITTED. */
export const LEG_TRANSITIONS = {
  PLANNED: ["SUBMITTING", "FAILED"], SUBMITTING: ["PLANNED", "SUBMITTED", "PENDING_CHAIN", "FAILED", "UNKNOWN"], SUBMITTED: ["PENDING_CHAIN", "FAILED", "UNKNOWN"],
  PENDING_CHAIN: ["SETTLED", "FAILED", "UNKNOWN"], UNKNOWN: ["SETTLED", "FAILED"], SETTLED: [], FAILED: [],
} as const;
export const OPERATION_TRANSITIONS = { PLANNED: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED", "PARTIAL", "FAILED"], PARTIAL: [], COMPLETED: [], FAILED: [], CANCELLED: [] } as const;

export const canTransition = <S extends string>(map: Readonly<Record<S, readonly S[]>>, from: S, to: S): boolean => map[from].includes(to);

/** USDC on Solana, the settlement asset of every operation. */
export const USDC_SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;
export const SLIPPAGE_DEFAULT_BPS = 100;
export const SLIPPAGE_MAX_BPS = 300;
/** Confirmations required before a source or destination transaction counts as final (Solana uses the `finalized` commitment). */
export const CONFIRMATIONS = { ethereum: 12, base: 10, bnb: 15, arbitrum: 10, polygon: 128, bitcoin: 2 } as const;

/** `deployable = amount - fee`; each share is `deployable * bps / 10000`, the remainder goes to the largest weight (ties: first). */
export function splitInvestment(amountMicro: bigint, feeMicro: bigint, weights: { deploymentId: string; bps: number }[]): { deploymentId: string; amountMicro: bigint }[] {
  const deployable = amountMicro - feeMicro;
  const shares = weights.map((w) => ({ deploymentId: w.deploymentId, amountMicro: (deployable * BigInt(w.bps)) / 10_000n }));
  const largest = weights.reduce((best, w, i) => (w.bps > weights[best]!.bps ? i : best), 0);
  shares[largest]!.amountMicro += deployable - shares.reduce((s, x) => s + x.amountMicro, 0n);
  return shares;
}

/** Floor of `quoted * (10000 - slippageBps) / 10000`. */
export const minOut = (quotedOut: bigint, slippageBps: number): bigint => (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;

/** Estimated gas in USD per leg, plus 20%, converted with the USDC price to micro-USDC (floats are scaled once with Math.round, then BigInt); at least 0.01 USDC. */
export function networkFeeMicro(gasUsd: number[], usdcPrice: string): bigint {
  if (!gasUsd.every(Number.isFinite) || !(Number(usdcPrice) > 0)) throw new RangeError("network fee inputs must be finite and the price positive");
  const totalUsdMicro = BigInt(Math.round(gasUsd.reduce((s, x) => s + x, 0) * 1e6));
  const priceMicro = BigInt(Math.round(Number(usdcPrice) * 1e6));
  const fee = (totalUsdMicro * 12n * 1_000_000n) / (10n * priceMicro);
  return fee < 10_000n ? 10_000n : fee;
}

// ---------------------------------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------------------------------

const slippage = z.number().int().min(1).max(SLIPPAGE_MAX_BPS).default(SLIPPAGE_DEFAULT_BPS);
const idempotencyKey = z.string().trim().min(8).max(128);

export const investRequestSchema = z.strictObject({ basketId: z.uuid(), amountUsdc: decimalStringSchema, slippageBps: slippage, idempotencyKey });
export type InvestRequest = z.infer<typeof investRequestSchema>;
export const sellRequestSchema = z.strictObject({ positionId: z.uuid(), percent: z.number().int().min(1).max(100), slippageBps: slippage, idempotencyKey });
export type SellRequest = z.infer<typeof sellRequestSchema>;
export const rebalanceRequestSchema = z.strictObject({ positionId: z.uuid(), target: z.enum(["latest", "applied"]), slippageBps: slippage, idempotencyKey });
export type RebalanceRequest = z.infer<typeof rebalanceRequestSchema>;
export const repairRequestSchema = z.strictObject({ deploymentId: z.uuid(), slippageBps: slippage, idempotencyKey });
export type RepairRequest = z.infer<typeof repairRequestSchema>;

/** Exactly one proof of submission: a signed Solana transaction, an EVM transaction hash, or a signed Bitcoin PSBT. */
export const legSubmitSchema = z.strictObject({
  signedTx: z.string().min(1).max(20_000).optional(),
  txHash: z.string().min(1).max(200).optional(),
  signedPsbt: z.string().min(1).max(50_000).optional(),
}).refine((b) => [b.signedTx, b.txHash, b.signedPsbt].filter((x) => x !== undefined).length === 1, { message: "Send exactly one of signedTx, txHash, signedPsbt." });
export type LegSubmit = z.infer<typeof legSubmitSchema>;

/** Ops resolution of a leg stuck UNKNOWN: the evidence is a transaction id/hash; SETTLED asset legs also need the amount received (verified on-chain where possible). */
export const resolveLegRequestSchema = z.strictObject({
  status: z.enum(["SETTLED", "FAILED"]),
  amountReceived: z.string().regex(/^\d+$/).optional(),
  txEvidence: z.string().trim().min(8).max(200),
  reason: z.string().trim().min(10).max(1000),
});
export type ResolveLegRequest = z.infer<typeof resolveLegRequestSchema>;

/** The challenge plus the BIP-322 `to_sign` PSBT (base64) the wallet signs. */
export const bitcoinChallengeResponseSchema = challengeResponseSchema.extend({ toSignPsbt: z.string() });
export type BitcoinChallengeResponse = z.infer<typeof bitcoinChallengeResponseSchema>;

export const bitcoinChallengeRequestSchema = z.strictObject({ address: z.string().trim().min(1).max(128) });
export type BitcoinChallengeRequest = z.infer<typeof bitcoinChallengeRequestSchema>;

/** `signature`: BIP-322 signed `to_sign` PSBT (base64) or a BIP-137 compact signature (base64). */
export const bitcoinVerifySchema = z.strictObject({
  challengeId: z.uuid(),
  address: z.string().trim().min(1).max(128),
  signature: z.string().min(1).max(50_000),
  method: z.enum(["bip322", "bip137"]),
});
export type BitcoinVerify = z.infer<typeof bitcoinVerifySchema>;

// ---------------------------------------------------------------------------------------------------------------------
// Responses (raw base units are decimal strings)
// ---------------------------------------------------------------------------------------------------------------------

export const investabilitySchema = z.object({
  basketId: z.uuid(),
  investable: z.boolean(),
  reasons: z.array(z.object({ instrumentId: z.uuid().optional(), code: z.string(), message: z.string() })),
  requiredFamilies: z.array(chainFamilySchema),
  minimumUsdc: z.string().nullable(),
  eligibility: z.object({ eligible: z.boolean(), reasons: z.array(z.object({ code: z.string(), message: z.string() })) }).optional(),
});
export type Investability = z.infer<typeof investabilitySchema>;

export const legSchema = z.object({
  id: z.uuid(),
  sequence: z.number().int(),
  kind: z.enum(LEG_KINDS),
  status: z.enum(LEG_STATES),
  fromChain: assetChainSchema,
  toChain: assetChainSchema,
  fromDeploymentId: z.uuid().nullable(),
  toDeploymentId: z.uuid().nullable(),
  amountIn: z.string(),
  minOut: z.string().nullable(),
  amountReceived: z.string().nullable(),
  provider: z.string().nullable(),
  routeSummary: z.unknown().nullable(),
  quoteExpiresAt: z.iso.datetime({ offset: true }).nullable(),
  gasPayer: z.enum(GAS_PAYERS).nullable(),
  sourceTx: z.string().nullable(),
  destinationTx: z.string().nullable(),
  failureReason: z.string().nullable(),
  /** LI.FI route fees and price impact from the plan (null on a leg without a route, such as the network fee). */
  priceImpact: z.number().nullable(),
  routeFees: z.array(z.object({ name: z.string(), amountUsd: z.number(), included: z.boolean() })),
  /** LI.FI substatus of the transfer (for example PARTIAL, REFUNDED, NOT_PROCESSABLE_REFUND_NEEDED), from the last status check. */
  providerSubstatus: z.string().nullable(),
  /** Set on a recovery leg: the leg whose destination swap failed. */
  recoveryOf: z.uuid().nullable(),
  /** Set on a leg that failed with DESTINATION_SWAP_FAILED: the token that arrived instead (amount from chain evidence). */
  recoveryToken: z.object({ chain: assetChainSchema, address: z.string().nullable(), decimals: z.number().int(), symbol: z.string(), amount: z.string() }).nullable(),
  /** The leg touches a deployment ops flagged as fee-on-transfer: the received amount can be below the quote. */
  feeOnTransfer: z.boolean(),
});
export type Leg = z.infer<typeof legSchema>;

export const operationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(OPERATION_KINDS),
  status: z.enum(OPERATION_STATES),
  basketId: z.uuid().nullable(),
  positionId: z.uuid().nullable(),
  amountUsdc: z.string().nullable(),
  sellPercent: z.number().int().nullable(),
  slippageBps: z.number().int(),
  networkFeeUsdc: z.string(),
  expiresAt: z.iso.datetime({ offset: true }),
  createdAt: z.iso.datetime({ offset: true }),
  legs: z.array(legSchema),
  fees: z.array(operationFeeViewSchema),
});
export type OperationView = z.infer<typeof operationSchema>;
/** A rebalance plan, or "already aligned" (the version was recorded and no operation made). */
export const rebalanceResponseSchema = z.union([operationSchema, z.strictObject({ aligned: z.literal(true) })]);

export const holdingSchema = z.object({
  deploymentId: z.uuid(),
  instrumentId: z.uuid(),
  symbol: z.string(),
  chain: assetChainSchema,
  quantity: z.string(),
  decimals: z.number().int(),
  valueUsd: z.string().nullable(),
  actualBps: z.number().int().nullable(),
  targetBps: z.number().int().nullable(),
  reconciliation: z.enum(["OK", "SHORT", "SURPLUS"]).nullable(),
});

export const positionSchema = z.object({
  id: z.uuid(),
  basketId: z.uuid(),
  basketSlug: z.string(),
  status: z.enum(["OPEN", "CLOSED"]),
  openedAt: z.iso.datetime({ offset: true }),
  closedAt: z.iso.datetime({ offset: true }).nullable(),
  holdings: z.array(holdingSchema),
}).extend(positionExtrasSchema.shape);

export const portfolioSchema = z.object({
  positions: z.array(positionSchema),
  /** One entry per short deployment (or basket cash): the buy-back / sync target. */
  repairs: z.array(repairSchema),
  openOperations: z.array(operationSchema),
  /** The 20 most recent finished operations (completed, partial, failed, cancelled), newest first. */
  history: z.array(operationSchema),
  formerPositions: z.array(positionSchema),
});
export type Portfolio = z.infer<typeof portfolioSchema>;

/** A fresh quote for one leg: what the wallet signs, per chain family. */
export const legQuoteResponseSchema = z.object({
  legId: z.uuid(),
  estimatedOut: z.string().nullable(),
  minOut: z.string().nullable(),
  quoteExpiresAt: z.iso.datetime({ offset: true }).nullable(),
  /** Null while an EVM gas drop is still confirming: no quote is fetched until it is. */
  transaction: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("solana"), serializedBase64: z.string() }),
    z.object({ kind: z.literal("evm"), to: z.string(), data: z.string(), value: z.string(), chainId: z.number().int() }),
    z.object({ kind: z.literal("bitcoin"), psbtBase64: z.string(), inputCount: z.number().int().min(1) }),
  ]).nullable(),
  /** ERC-20 sells: the exact-amount approval the wallet must sign first (never unlimited). */
  approval: z.object({ token: z.string(), spender: z.string(), amount: z.string() }).nullable(),
  /** EVM source legs: the platform gas drop must be `confirmed` before the user signs. */
  gasDrop: z.object({ status: z.enum(["pending", "confirmed", "failed", "skipped"]), txHash: z.string().nullable() }).nullable(),
});
export type LegQuoteResponse = z.infer<typeof legQuoteResponseSchema>;

/** Ops route policy: a LI.FI bridge or exchange (`/v1/tools` key) denied on every estimate and quote until allowed again. */
export const ROUTE_TOOL_KINDS = ["bridge", "exchange"] as const;
export const routePolicyInputSchema = z.object({ kind: z.enum(ROUTE_TOOL_KINDS), toolKey: z.string().trim().min(1).max(100), reason: z.string().trim().min(1).max(500) });
export type RoutePolicyInput = z.infer<typeof routePolicyInputSchema>;

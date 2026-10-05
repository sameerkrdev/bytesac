import type { Leg, OperationView, Portfolio } from "@repo/validator";

const ID = (n: number) => `0192f1c2-7a4b-7c3d-8e9f-${String(n).padStart(12, "0")}`;
export const id = ID;

export const leg = (over: Partial<Leg> = {}): Leg => ({
  id: ID(11), sequence: 1, kind: "swap", status: "PLANNED", fromChain: "solana", toChain: "solana", fromDeploymentId: null, toDeploymentId: ID(21),
  amountIn: "50000000", minOut: "320000000", amountReceived: null, provider: "lifi",
  routeSummary: { tool: "jupiter", estimatedOut: "330000000", symbol: "SOL", decimals: 9 },
  quoteExpiresAt: null, gasPayer: "platform_fee_payer", sourceTx: null, destinationTx: null, failureReason: null,
  priceImpact: 0.0123, routeFees: [{ name: "LI.FI", amountUsd: 0.12, included: true }], providerSubstatus: null, recoveryOf: null, recoveryToken: null, feeOnTransfer: false,
  ...over,
});

export const fees: OperationView["fees"] = [
  { kind: "network", recipientLabel: "Bytesac", amountMicro: "50000", waivedReason: null },
  { kind: "platform", recipientLabel: "Bytesac", amountMicro: "250000", waivedReason: null },
  { kind: "manager", recipientLabel: "Alpha Capital", amountMicro: "500000", waivedReason: "payout_wallet_unavailable" },
] as OperationView["fees"];

export const operation = (over: Partial<OperationView> = {}): OperationView => ({
  id: ID(1), kind: "invest", status: "PLANNED", basketId: ID(2), positionId: null, amountUsdc: "50000000", sellPercent: null, slippageBps: 100, networkFeeUsdc: "50000",
  expiresAt: "2026-10-04T00:00:00.000Z", createdAt: "2026-10-03T00:00:00.000Z", legs: [leg()], fees, ...over,
});

type Position = Portfolio["positions"][number];
export const position = (over: Partial<Position> = {}): Position => ({
  id: ID(31), basketId: ID(2), basketSlug: "alpha", basketName: "Alpha Basket", status: "OPEN", openedAt: "2026-09-01T00:00:00.000Z", closedAt: null,
  holdings: [{ deploymentId: ID(21), instrumentId: ID(41), symbol: "SOL", chain: "solana", quantity: "2000000000", decimals: 9, valueUsd: "300.00", actualBps: 6000, targetBps: 5000, reconciliation: "OK" }],
  states: { version: "CURRENT", backing: "VERIFIED", allocation: "ALIGNED", execution: "NONE" }, headline: "ALIGNED", cashMicro: "0", latestVersion: null, appliedVersionNumber: 1, driftThresholdBps: 500, ...over,
} as unknown as Position);

export const portfolio = (over: Partial<Portfolio> = {}): Portfolio => ({ positions: [], repairs: [], openOperations: [], history: [], formerPositions: [], ...over });

export const PERFORMANCE_LABEL = "Simulated model performance — not actual investor results. Net figures assume an investment equal to the basket minimum and include the basket's fees; network and swap costs are excluded.";

export const publicBasket = (over: Record<string, unknown> = {}) => ({
  slug: "alpha", status: "ACTIVE", hasAssetWarning: false,
  eligibility: { requirements: true, assets: [{ instrumentId: ID(41), outcome: "RESTRICTED", reason: "x" }] },
  organization: { id: ID(5), displayName: "Alpha Capital" },
  version: {
    versionNumber: 2, publishedAt: "2026-09-20T00:00:00.000Z", name: "Alpha Basket", shortDescription: "A balanced basket", longDescription: null, category: "multi_asset", tags: [],
    objective: "Grow steadily", thesis: null, methodology: null, intendedInvestor: null, horizon: null, keyAssumptions: null, knownLimitations: null,
    strategyRisks: "Prices can fall.", liquidityNotes: null, conflictsOfInterest: null, constraints: { maxWeightPerAssetBps: 6000 }, rebalance: { reviewFrequency: "monthly" },
    fees: { entry: { type: "percent", bps: 50 }, management: { type: "percent", bps: 100 }, rebalance: { type: "percent", bps: 25 }, subscription: null },
    minimumInvestmentUsdc: "50", minimumIncrementUsdc: "10",
  },
  allocation: [{ instrumentId: ID(41), name: "Solana", symbol: "SOL", assetType: "CRYPTO", chains: ["solana"], targetWeightBps: 5000, minWeightBps: null, maxWeightBps: null,
    prices: [{ instrumentId: ID(41), kind: "market", status: "ok", value: "150.5", currency: "USD", source: "x", observedAt: null, stale: false }] }],
  platformFee: [{ operationKind: "invest", bps: 100, minUsdc: null, maxUsdc: "50" }],
  disclosures: [{ title: "Not advice", body: "This is not investment advice." }],
  versionHistory: [{ versionNumber: 2, publishedAt: "2026-09-20T00:00:00.000Z", rationale: "Added SOL", diff: { added: [{ instrumentId: ID(41), weightBps: 5000 }], removed: [], changed: [], bandChanged: [], constraints: false, rebalance: false, fees: false, minimums: false } }],
  managers: [{ displayName: "Jane Doe", handle: null, role: "lead", from: "2026-09-01T00:00:00.000Z", to: null }],
  sectors: [], tags: [], files: [], label: PERFORMANCE_LABEL,
  performance: { available: true, dataDays: 2, series: [{ day: "2026-09-19", net: "100", gross: "100" }, { day: "2026-09-20", net: "101.5", gross: "102" }] },
  metrics: { available: true, dataDays: 2, net: { sinceLaunch: "0.015", d30: null, d90: null, y1: null }, gross: { sinceLaunch: "0.02", d30: null, d90: null, y1: null }, volatility: null, maxDrawdown: null },
  ...over,
});

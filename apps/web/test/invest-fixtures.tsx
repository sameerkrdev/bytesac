import type { Leg, MeResponse, OperationView, Portfolio } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MeProvider } from "@/components/me-context";

export const ID = (n: number) => `0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e${String(n).padStart(2, "0")}`;

export const me = (): MeResponse => ({
  user: { id: ID(1), status: "active", createdAt: "2026-09-29T00:00:00.000Z" },
  wallet: { id: ID(2), walletProvider: "Phantom", addresses: [] },
  contacts: [], permissions: [], platformRoles: [], organizations: [],
});

/** The network-fee leg (Solana, USDC transfer to the platform). */
export const feeLeg = (o: Partial<Leg> = {}): Leg => ({
  id: ID(10), sequence: 1, kind: "network_fee", status: "PLANNED", fromChain: "solana", toChain: "solana", fromDeploymentId: null, toDeploymentId: null, amountIn: "70000", minOut: null,
  amountReceived: null, provider: null, routeSummary: null, quoteExpiresAt: null, gasPayer: "platform_fee_payer", sourceTx: null, destinationTx: null, failureReason: null, ...o,
});

/** A buy leg: USDC on Solana to an asset on another chain. */
export const buyLeg = (o: Partial<Leg> = {}): Leg => ({
  ...feeLeg(), id: ID(11), sequence: 2, kind: "cross_chain", toChain: "ethereum", toDeploymentId: ID(30), amountIn: "99930000", minOut: "29700000000000000",
  provider: "lifi", routeSummary: { tool: "stargate", estimatedOut: "30000000000000000", symbol: "ETH", decimals: 18 }, ...o,
});

/** A sell leg: an asset on Ethereum back to USDC on Solana (the platform tops up gas first). */
export const sellLeg = (o: Partial<Leg> = {}): Leg => ({
  ...feeLeg(), id: ID(12), sequence: 1, kind: "cross_chain", fromChain: "ethereum", fromDeploymentId: ID(30), amountIn: "30000000000000000", minOut: "74000000",
  provider: "lifi", gasPayer: "platform_gas_drop", routeSummary: { tool: "stargate", estimatedOut: "75000000", symbol: "ETH", decimals: 18 }, ...o,
});

export const operation = (o: Partial<OperationView> = {}): OperationView => ({
  id: ID(20), kind: "invest", status: "PLANNED", basketId: ID(3), positionId: null, amountUsdc: "100000000", sellPercent: null, slippageBps: 100, networkFeeUsdc: "70000",
  expiresAt: "2026-10-01T12:30:00.000Z", createdAt: "2026-10-01T12:00:00.000Z", fees: [], legs: [feeLeg(), buyLeg()], ...o,
});

type Position = Portfolio["positions"][number];
export const position = (o: Partial<Position> = {}): Position => ({
  id: ID(40), basketId: ID(3), basketSlug: "core-crypto", status: "OPEN", openedAt: "2026-10-01T12:00:00.000Z", closedAt: null,
  states: { version: "CURRENT", backing: "VERIFIED", allocation: "ALIGNED", execution: "NONE" }, headline: "ALIGNED", cashMicro: "0", latestVersion: null, appliedVersionNumber: 1, driftThresholdBps: 500,
  holdings: [
    { deploymentId: ID(30), instrumentId: ID(31), symbol: "ETH", chain: "ethereum", quantity: "30000000000000000", decimals: 18, valueUsd: "75.00", actualBps: 6000, targetBps: 5000, reconciliation: "OK" },
    { deploymentId: ID(32), instrumentId: ID(33), symbol: "SOL", chain: "solana", quantity: "250000000", decimals: 9, valueUsd: "50.00", actualBps: 4000, targetBps: 5000, reconciliation: "OK" },
  ],
  ...o,
});

/** Renders with a fresh query client (no retries) and the signed-in user. */
export const renderApp = (ui: ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MeProvider initial={me()}>{ui}</MeProvider></QueryClientProvider>);

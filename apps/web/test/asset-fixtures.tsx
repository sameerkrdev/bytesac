import type { AssetProviderView, IssuerView, MeResponse, OpsAssetDetail } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { MeProvider } from "@/components/me-context";

export const T = "2026-09-30T00:00:00.000Z";
export const ASSET_ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f01";
export const DEPLOYMENT_ID = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f02";
export const SUBMITTER = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f03";
export const ADMIN = "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f04";

export const deployment = (over: Partial<OpsAssetDetail["deployments"][number]> = {}): OpsAssetDetail["deployments"][number] => ({
  id: DEPLOYMENT_ID, chain: "ethereum", tokenStandard: "erc20", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6, verification: "onchain",
  observedDecimals: 6, observedSymbol: "USDC", observedName: "USD Coin", observedAt: T, sourceUrl: null, status: "DRAFT", approvedByUserId: null, createdAt: T, updatedAt: T, ...over,
});

export const asset = (over: Partial<OpsAssetDetail> = {}): OpsAssetDetail => ({
  id: ASSET_ID, name: "USD Coin", symbol: "USDC", assetType: "STABLECOIN", description: null, issuerId: null, riskNotes: null, links: [], sector: "other", tags: [], status: "DRAFT",
  createdByUserId: SUBMITTER, submittedByUserId: null, decidedByUserId: null, createdAt: T, updatedAt: T,
  deployments: [deployment()], routes: [], rules: [], priceReferences: [], navObservations: [], events: [], missing: [], prices: [], ...over,
});

export const me = (platformRoles: MeResponse["platformRoles"], id = ADMIN): MeResponse => ({
  user: { id, status: "active", createdAt: T }, wallet: { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4e50", walletProvider: null, addresses: [] },
  contacts: [], permissions: [], platformRoles, organizations: [],
});

const issuer: IssuerView = { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f10", name: "Circle", legalName: null, website: null, jurisdiction: null, notes: null, createdAt: T, updatedAt: T };
const provider: AssetProviderView = { id: "0192f1c2-7a4b-7c3d-8e9f-0a1b2c3d4f11", name: "Jupiter", kind: "dex_aggregator", website: null, notes: null, createdAt: T, updatedAt: T };

/** Lookup lists the editor sections load; tests override the calls they care about. */
export const lookups = () => ({
  opsListAssetIssuers: vi.fn().mockResolvedValue([issuer]),
  opsCreateAssetIssuer: vi.fn(),
  opsListAssetProviders: vi.fn().mockResolvedValue([provider]),
  opsListAssets: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
});

export const renderAs = (ui: ReactElement, roles: MeResponse["platformRoles"] = ["ops_admin"], userId = ADMIN) =>
  render(<QueryClientProvider client={new QueryClient()}><MeProvider initial={me(roles, userId)}>{ui}</MeProvider></QueryClientProvider>);

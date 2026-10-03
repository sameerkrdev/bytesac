import type { DiscoverySearchItem } from "@repo/validator";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";

export const searchItem = (over: Partial<DiscoverySearchItem> = {}): DiscoverySearchItem => ({
  slug: "core-crypto", name: "Core Crypto", shortDescription: "Two assets", organizationName: "Ada Capital", category: "multi_asset", status: "ACTIVE",
  topAssets: [{ symbol: "SOL", bps: 4000 }, { symbol: "ETH", bps: 3000 }, { symbol: "BTC", bps: 2000 }, { symbol: "DOGE", bps: 1000 }],
  minimumInvestmentUsdc: "100", managementFeeBps: 50, netReturn1y: "0.123400", available: true, hasEligibilityRequirements: false, ...over,
});

export const withQuery = (ui: ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

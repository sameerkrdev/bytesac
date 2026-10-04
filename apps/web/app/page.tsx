import { createApiClient } from "@repo/api-client";
import type { DiscoverySearchItem } from "@repo/validator";
import { PublicShell } from "@/components/layout/app-shell";
import { DownloadApp } from "@/components/marketing/download-app";
import { Hero } from "@/components/marketing/hero";
import { BasketRail, ClosingCta, ForManagers, Journey, MultiChain, Research, SelfCustody, Statement, StrategyUpdates } from "@/components/marketing/sections";
import { SwapPanel, SwapStack } from "@/components/motion/page-swap";
import { SmoothScroll } from "@/components/motion/smooth-scroll";

export const dynamic = "force-dynamic";

/** Live published baskets for the rail; the section hides itself if discovery is unavailable. */
async function liveBaskets(): Promise<DiscoverySearchItem[]> {
  try {
    const client = createApiClient({ baseUrl: process.env.API_ORIGIN ?? "http://localhost:4000", transport: { kind: "cookie" } });
    return (await client.discoverBaskets({ sort: "relevance" })).items;
  } catch {
    return [];
  }
}

export default async function Landing() {
  const baskets = await liveBaskets();
  return (
    <PublicShell bare>
      <SmoothScroll />
      <SwapStack>
        <SwapPanel first><Hero /></SwapPanel>
        <SwapPanel>
          <Statement />
          <Journey />
          <BasketRail items={baskets} />
          <Research />
        </SwapPanel>
        <SwapPanel tone="dark"><SelfCustody /></SwapPanel>
        <SwapPanel>
          <StrategyUpdates />
          <MultiChain />
          <ForManagers />
          <div className="mx-auto w-full max-w-7xl px-4 pb-28 sm:px-6 md:pb-40 lg:px-10"><DownloadApp /></div>
        </SwapPanel>
        <SwapPanel last><ClosingCta /></SwapPanel>
      </SwapStack>
    </PublicShell>
  );
}

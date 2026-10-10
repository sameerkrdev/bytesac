import { PublicShell } from "@/components/layout/app-shell";
import { SurfaceProvider } from "@/components/layout/surface";
import { DownloadApp } from "@/components/marketing/download-app";
import { Hero } from "@/components/marketing/hero";
import { ClosingCta, ForManagers, Journey, MultiChain, Research, SelfCustody, Statement, StrategyUpdates } from "@/components/marketing/sections";
import { SwapPanel, SwapStack } from "@/components/motion/page-swap";
import { SmoothScroll } from "@/components/motion/smooth-scroll";

export const metadata = {
  title: { absolute: "Bytesac — Join the waitlist" },
  description: "Manager-led, multi-chain investment baskets. Your assets stay in your wallet and you sign every step. Join the waitlist.",
};

/**
 * The apex home (proxy.ts rewrites "/" here): the marketing landing in waitlist mode. Every call to action leads to the
 * form in the closing section; the live basket rail is left out because the API is gated during the soft launch.
 */
export default function WaitlistPage() {
  return (
    <SurfaceProvider value="marketing">
      <PublicShell bare>
        <SmoothScroll />
        <SwapStack>
          <SwapPanel first><Hero /></SwapPanel>
          <SwapPanel>
            <Statement />
            <Journey />
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
    </SurfaceProvider>
  );
}

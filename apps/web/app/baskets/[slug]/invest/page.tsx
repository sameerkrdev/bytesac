"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { InvestButton } from "@/components/invest/invest-button";
import { InvestFlow } from "@/components/invest/invest-flow";
import { PageHeader } from "@/components/layout/page-layout";
import { ErrorState, LoadingState } from "@/components/layout/states";
import { api } from "@/lib/api";

/** Full-page investment. When the viewer can't invest yet, the same reasons and fixes as the basket page are shown. */
export default function InvestPage() {
  const { slug } = useParams<{ slug: string }>();
  const inv = useQuery({ queryKey: ["investability", slug], queryFn: () => api.getInvestability(slug), retry: false });
  const basket = useQuery({ queryKey: ["public-basket", slug], queryFn: () => api.getPublicBasket(slug) });
  const b = basket.data && !("redirectTo" in basket.data) ? basket.data : null;
  const ready = inv.data?.investable && inv.data.eligibility?.eligible && b;
  return (
    <section aria-labelledby="invest-title" className="space-y-10">
      <PageHeader id="invest-title" breadcrumb={[{ label: "Baskets", href: "/baskets" }, { label: b?.version.name ?? "Basket", href: `/baskets/${slug}` }, { label: "Invest" }]}
        eyebrow="Invest" title={b ? `Invest in ${b.version.name}` : "Invest"} />
      {inv.isPending || basket.isPending ? <LoadingState /> : basket.isError ? <ErrorState error={basket.error} onRetry={() => void basket.refetch()} /> : ready ? (
        <InvestFlow slug={slug} basketId={inv.data!.basketId} basket={b!} />
      ) : (
        <div className="max-w-lg space-y-4 rounded-card border border-line bg-surface p-6">
          <p className="text-ink-muted">Before you can invest in this basket:</p>
          <InvestButton slug={slug} name={b?.version.name ?? ""} minimumUsdc={b?.version.minimumInvestmentUsdc ?? null} incrementUsdc={b?.version.minimumIncrementUsdc ?? null} />
        </div>
      )}
    </section>
  );
}

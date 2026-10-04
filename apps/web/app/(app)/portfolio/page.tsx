"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/layout/states";
import { PageLayout } from "@/components/layout/page-layout";
import { OperationDetail } from "@/components/portfolio/operation-detail";
import { PositionsList } from "@/components/portfolio/positions-list";
import { AttentionList, PortfolioSummary } from "@/components/portfolio/summary";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";

export default function PortfolioPage() {
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const p = q.data;
  // The mobile app links to /portfolio#operation-<id>; the element only exists once the portfolio has loaded.
  useEffect(() => {
    if (p && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [p]);
  return (
    <PageLayout id="portfolio-title" title="Portfolio" eyebrow="Your baskets, your wallets"
      description="What Bytesac has reconciled in your own wallets, measured against each basket's target."
      actions={p && p.history.length > 0 ? <Link href="/portfolio/activity" className={buttonVariants({ variant: "secondary" })}>Activity<ArrowRight /></Link> : undefined}>
      {q.isPending && <LoadingState />}
      {q.isError && !p && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && p && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      {p && (
        <>
          {p.positions.length > 0 && <PortfolioSummary portfolio={p} />}
          {p.openOperations.length > 0 && (
            <section id="open-operations" aria-label="Open operations" className="scroll-mt-24 space-y-4">
              <h2 className="type-heading text-ink">Open operations</h2>
              <ul className="space-y-3">{p.openOperations.map((o) => <OperationDetail key={o.id} operation={o} open />)}</ul>
            </section>
          )}
          <AttentionList portfolio={p} />
          <section aria-label="Positions" className="space-y-4">
            <h2 className="type-heading text-ink">Positions</h2>
            {p.positions.length === 0 ? <EmptyState title="You have no open positions. Find a basket to invest in."><Link href="/baskets" className={buttonVariants({ variant: "secondary" })}>Discover baskets</Link></EmptyState> : <PositionsList positions={p.positions} repairs={p.repairs} />}
          </section>
          {p.formerPositions.length > 0 && (
            <section aria-label="Former positions" className="space-y-4">
              <h2 className="type-heading text-ink">Former positions</h2>
              <PositionsList positions={p.formerPositions} former />
            </section>
          )}
          {p.history.length > 0 && (
            <section aria-label="History" className="space-y-4">
              <div className="flex items-end justify-between gap-3"><h2 className="type-heading text-ink">History</h2><Link href="/portfolio/activity" className="text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline">All activity</Link></div>
              <ul className="space-y-3">{p.history.slice(0, 5).map((o) => <OperationDetail key={o.id} operation={o} />)}</ul>
            </section>
          )}
        </>
      )}
    </PageLayout>
  );
}

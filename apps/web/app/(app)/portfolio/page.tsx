"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { OperationDetail } from "@/components/portfolio/operation-detail";
import { PositionsList } from "@/components/portfolio/positions-list";
import { api } from "@/lib/api";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/layout/states";
import { PageLayout } from "@/components/layout/page-layout";

export default function PortfolioPage() {
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const p = q.data;
  return (
    <PageLayout id="portfolio-title" title="Portfolio" className="space-y-8">
      {q.isPending && <LoadingState />}
      {q.isError && !p && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && p && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      {p && (
        <>
          {p.openOperations.length > 0 && (
            <section id="open-operations" aria-label="Open operations" className="space-y-3">
              <h2 className="font-display text-xl font-semibold text-ivory">Open operations</h2>
              <ul className="space-y-3">{p.openOperations.map((o) => <OperationDetail key={o.id} operation={o} open />)}</ul>
            </section>
          )}
          <section aria-label="Positions" className="space-y-3">
            <h2 className="font-display text-xl font-semibold text-ivory">Positions</h2>
            {p.positions.length === 0 ? <EmptyState title="You have no open positions. Find a basket to invest in."><Link href="/baskets" className="inline-flex min-h-11 items-center text-mint underline">Discover baskets</Link></EmptyState> : <PositionsList positions={p.positions} repairs={p.repairs} />}
          </section>
          {p.formerPositions.length > 0 && (
            <section aria-label="Former positions" className="space-y-3">
              <h2 className="font-display text-xl font-semibold text-ivory">Former positions</h2>
              <PositionsList positions={p.formerPositions} former />
            </section>
          )}
          {p.history.length > 0 && (
            <section aria-label="History" className="space-y-3">
              <h2 className="font-display text-xl font-semibold text-ivory">History</h2>
              <ul className="space-y-3">{p.history.map((o) => <OperationDetail key={o.id} operation={o} />)}</ul>
            </section>
          )}
        </>
      )}
    </PageLayout>
  );
}

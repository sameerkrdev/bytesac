"use client";

import { useQuery } from "@tanstack/react-query";
import { OperationDetail } from "@/components/portfolio/operation-detail";
import { PositionsList } from "@/components/portfolio/positions-list";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

export default function PortfolioPage() {
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const p = q.data;
  return (
    <section aria-labelledby="portfolio-title" className="space-y-8">
      <h1 id="portfolio-title" className="font-display text-3xl font-bold text-ivory md:text-4xl">Portfolio</h1>
      {q.isPending && <p role="status" className="text-sm text-stone">Loading…</p>}
      {q.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(q.error).title}</p>}
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
            {p.positions.length === 0 ? <p className="text-sm text-stone">You have no open positions. Find a basket to invest in.</p> : <PositionsList positions={p.positions} repairs={p.repairs} />}
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
    </section>
  );
}

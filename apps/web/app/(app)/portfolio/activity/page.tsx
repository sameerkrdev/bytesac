"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageLayout } from "@/components/layout/page-layout";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/states";
import { OperationDetail } from "@/components/portfolio/operation-detail";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";

/** Every recent operation — open first — with its steps, fees and explorer links. */
export default function ActivityPage() {
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  return (
    <PageLayout breadcrumb={[{ label: "Portfolio", href: "/portfolio" }, { label: "Activity" }]} title="Activity"
      description="Investments, rebalances, repairs and sales you started, with each step you signed. The 20 most recent finished operations are kept here.">
      {q.isPending ? <LoadingState /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data.openOperations.length + q.data.history.length === 0 ? (
        <EmptyState title="No activity yet."><Link href="/baskets" className={buttonVariants({ variant: "secondary" })}>Discover baskets</Link></EmptyState>
      ) : (
        <div className="space-y-10">
          {q.data.openOperations.length > 0 && (
            <section aria-label="In progress" className="space-y-4"><h2 className="type-heading text-ink">In progress</h2>
              <ul className="space-y-3">{q.data.openOperations.map((o) => <OperationDetail key={o.id} operation={o} open />)}</ul></section>
          )}
          <section aria-label="Finished" className="space-y-4"><h2 className="type-heading text-ink">Finished</h2>
            <ul className="space-y-3">{q.data.history.map((o) => <OperationDetail key={o.id} operation={o} />)}</ul></section>
        </div>
      )}
    </PageLayout>
  );
}

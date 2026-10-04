"use client";

import { useQuery } from "@tanstack/react-query";
import { Layers, ScanLine, Target } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageLayout } from "@/components/layout/page-layout";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/layout/states";
import { OperationDetail } from "@/components/portfolio/operation-detail";
import { PositionsList } from "@/components/portfolio/positions-list";
import { HEADLINE_HELP, positionValue, usd } from "@/components/portfolio/summary";
import { buttonVariants } from "@/components/ui/button";
import { Figure } from "@/components/ui/kit";
import { api } from "@/lib/api";

const LAYERS = [
  { icon: Target, title: "Strategy target", body: "The weights in the basket version you applied. Set by the organization; it changes only when you accept a new version." },
  { icon: Layers, title: "Your basket allocation", body: "How Bytesac attributes your holdings to this basket — a ledger kept per basket, so several baskets can share one wallet." },
  { icon: ScanLine, title: "Verified holdings", body: "What your wallets actually hold, read from each chain. A shortfall or surplus against the ledger is flagged per asset." },
];

/** One position, with the three layers that are never the same spelled out above the holdings. */
export default function PositionPage() {
  const { positionId } = useParams<{ positionId: string }>();
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  if (q.isPending) return <LoadingState />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data!.positions.find((x) => x.id === positionId) ?? q.data!.formerPositions.find((x) => x.id === positionId);
  if (!p) return <EmptyState title="This position isn't in your portfolio."><Link href="/portfolio" className={buttonVariants({ variant: "secondary" })}>Back to portfolio</Link></EmptyState>;
  const former = p.status === "CLOSED";
  const v = positionValue(p);
  const ops = [...q.data!.openOperations, ...q.data!.history].filter((o) => o.positionId === p.id);
  return (
    <PageLayout breadcrumb={[{ label: "Portfolio", href: "/portfolio" }, { label: p.basketName }]} eyebrow={former ? "Former position" : `Applied version ${p.appliedVersionNumber}`} title={p.basketName}
      actions={<Link href={`/baskets/${p.basketSlug}`} className={buttonVariants({ variant: "secondary" })}>Basket research</Link>}>
      {q.isError && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="space-y-2 rounded-card border border-line bg-surface p-6">
          <p className="type-eyebrow text-ink-faint">Value</p>
          {v === null ? <p className="type-figure text-3xl text-ink-muted">Unavailable</p> : <Figure value={usd(v)} size="lg" />}
          {!former && <p className="pt-3 text-sm text-ink-muted">{HEADLINE_HELP[p.headline]}</p>}
        </div>
        <ol className="grid gap-3 sm:grid-cols-3">
          {LAYERS.map((l, i) => (
            <li key={l.title} className="rounded-card border border-line bg-surface p-5">
              <div className="flex items-center justify-between"><l.icon aria-hidden className="size-4.5 text-ink-faint" /><span className="font-mono text-[0.6875rem] text-ink-faint">0{i + 1}</span></div>
              <p className="mt-5 font-medium text-ink">{l.title}</p>
              <p className="mt-1.5 text-xs text-ink-muted">{l.body}</p>
            </li>
          ))}
        </ol>
      </div>
      <PositionsList positions={[p]} former={former} repairs={q.data!.repairs} linkDetail={false} />
      {ops.length > 0 && (
        <section aria-label="Operations for this position" className="space-y-4">
          <h2 className="type-heading text-ink">Operations</h2>
          <ul className="space-y-3">{ops.map((o) => <OperationDetail key={o.id} operation={o} open={q.data!.openOperations.includes(o)} />)}</ul>
        </section>
      )}
    </PageLayout>
  );
}

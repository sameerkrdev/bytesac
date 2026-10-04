import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL } from "@repo/app-core/basket-status";
import { formatBps, formatFraction } from "@repo/app-core/format";
import type { DiscoverySearchItem } from "@repo/validator";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { AllocationBar } from "@/components/visual/allocation-ring";
import { cn } from "@/lib/utils";

/**
 * A basket as a research entry point: who runs it, what it holds, what it costs. The 1-year figure is the simulated
 * model's net return and is labelled as such. Every string renders as text.
 */
export function BasketCard({ b, className, headingLevel: H = "h3", showStatus = false }: { b: DiscoverySearchItem; className?: string; headingLevel?: "h2" | "h3"; showStatus?: boolean }) {
  const slices = b.topAssets.map((a) => ({ key: a.symbol, label: a.symbol, bps: a.bps }));
  const status = BASKET_STATUS_LABEL[b.status];
  return (
    <article className={cn("group relative flex h-full flex-col rounded-card border border-line bg-surface p-6 transition-[border-color,box-shadow,transform] duration-300 ease-calm hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="type-eyebrow text-ink-faint">{BASKET_CATEGORY_LABEL[b.category]}</p>
        {(showStatus || b.status !== "ACTIVE") && <StatusBadge {...status} />}
      </div>
      <H className="mt-3 text-xl font-normal tracking-tight text-ink">
        <Link href={`/baskets/${b.slug}`} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
          {b.name}
        </Link>
      </H>
      <p className="mt-1 text-sm text-ink-muted">by {b.organizationName}</p>
      {b.shortDescription && <p className="mt-4 line-clamp-2 text-sm text-ink-muted">{b.shortDescription}</p>}

      <div className="mt-6 space-y-2.5">
        <AllocationBar slices={slices} label={`Target allocation: ${b.topAssets.map((a) => `${a.symbol} ${formatBps(a.bps)}`).join(", ")}`} />
        <p className="font-mono text-[0.6875rem] text-ink-muted">{b.topAssets.slice(0, 3).map((a) => `${a.symbol} ${formatBps(a.bps)}`).join(" · ")}</p>
      </div>

      <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-line pt-5 text-sm">
        <div className="space-y-1">
          <dt className="text-[0.6875rem] text-ink-faint">1y net · simulated</dt>
          <dd className={cn("tabular-nums", b.netReturn1y === null ? "text-ink-muted" : Number(b.netReturn1y) >= 0 ? "text-ink" : "text-danger")}>{b.netReturn1y === null ? "New" : formatFraction(b.netReturn1y, true)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-[0.6875rem] text-ink-faint">Minimum</dt>
          <dd className="text-ink tabular-nums">{`${b.minimumInvestmentUsdc} USDC`}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-[0.6875rem] text-ink-faint">Mgmt fee</dt>
          <dd className="text-ink tabular-nums">{formatBps(b.managementFeeBps)}</dd>
        </div>
      </dl>
      <div className="mt-4 flex items-center justify-between gap-2 text-xs text-ink-muted">
        {b.hasEligibilityRequirements ? <span className="inline-flex items-center gap-1.5"><ShieldAlert aria-hidden className="size-3.5" />Eligibility requirements</span> : <span />}
        <ArrowUpRight aria-hidden className="size-4 text-ink-faint transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink" />
      </div>
    </article>
  );
}

import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL } from "@repo/app-core/basket-status";
import { formatBps } from "@repo/app-core/format";
import type { DiscoverySearchItem } from "@repo/validator";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { AssetStack, ReturnFigure, VolatilityFigure } from "@/components/baskets/basket-card";
import { BookmarkButton } from "@/components/baskets/saved-baskets";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";

/** Column template shared by the row and its header, so figures line up down the list. */
export const ROW_GRID = "md:grid-cols-[minmax(0,1fr)_7.5rem_7rem_7.5rem_2.5rem]";

/** Header for a list of `BasketRow`s (desktop only; phones show labelled figures inside each row). */
export function BasketRowHeader() {
  return (
    <div aria-hidden className={cn("hidden gap-4 border-b border-line px-5 pb-3 text-[0.6875rem] tracking-wide text-ink-faint uppercase md:grid", ROW_GRID)}>
      <span>Basket</span><span className="text-right">Min. amount</span><span className="text-right">1y · simulated</span><span className="text-right">Volatility</span><span />
    </div>
  );
}

/**
 * A basket as one scannable list row: holdings logos, name, manager, description, then minimum, simulated 1-year
 * return, volatility and a save toggle. The whole row links to the basket. Every string renders as text.
 */
export function BasketRow({ b, headingLevel: H = "h2" }: { b: DiscoverySearchItem; headingLevel?: "h2" | "h3" }) {
  return (
    <article className={cn("group relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-4 rounded-tile px-4 py-5 transition-colors hover:bg-surface has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus sm:px-5", ROW_GRID)}>
      <div className="flex min-w-0 items-start gap-4">
        <AssetStack assets={b.topAssets} size={36} max={2} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <H className="text-base leading-snug font-medium text-ink">
            <Link href={`/baskets/${b.slug}`} className="after:absolute after:inset-0 after:rounded-tile focus-visible:outline-none">{b.name}</Link>
          </H>
          <p className="mt-0.5 truncate text-sm text-ink-muted">by {b.organizationName} · {BASKET_CATEGORY_LABEL[b.category]}</p>
          {b.shortDescription && <p className="mt-1.5 line-clamp-1 max-w-2xl text-sm text-ink-faint">{b.shortDescription}</p>}
          {(b.status !== "ACTIVE" || b.hasEligibilityRequirements) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {b.status !== "ACTIVE" && <StatusBadge {...BASKET_STATUS_LABEL[b.status]} />}
              {b.hasEligibilityRequirements && <span className="inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-1 text-[0.6875rem] text-ink-muted"><ShieldAlert aria-hidden className="size-3" />Eligibility requirements</span>}
            </div>
          )}
        </div>
      </div>
      <BookmarkButton slug={b.slug} name={b.name} className="md:order-last" />
      <dl className="col-span-2 grid grid-cols-3 gap-3 text-sm md:contents">
        <div className="md:text-right"><dt className="text-[0.6875rem] text-ink-faint md:sr-only">Min. amount</dt><dd className="text-ink tabular-nums">{`${b.minimumInvestmentUsdc} USDC`}<span className="block text-[0.6875rem] text-ink-faint">{formatBps(b.managementFeeBps)} mgmt fee</span></dd></div>
        <div className="md:text-right"><dt className="text-[0.6875rem] text-ink-faint md:sr-only">1y · simulated</dt><dd><ReturnFigure value={b.netReturn1y} /></dd></div>
        <div className="md:flex md:flex-col md:items-end"><dt className="text-[0.6875rem] text-ink-faint md:sr-only">Volatility</dt><dd><VolatilityFigure value={b.volatility} /></dd></div>
      </dl>
      <p className="sr-only">{`Largest holdings: ${b.topAssets.map((a) => `${a.symbol} ${formatBps(a.bps)}`).join(", ")}.`}</p>
    </article>
  );
}

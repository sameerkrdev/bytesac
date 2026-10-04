import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL } from "@repo/app-core/basket-status";
import { formatBps, formatFraction } from "@repo/app-core/format";
import type { DiscoverySearchItem } from "@repo/validator";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { BookmarkButton } from "@/components/baskets/saved-baskets";
import { StatusBadge } from "@/components/status-badge";
import { AssetMark } from "@/components/visual/chain-badge";
import { cn } from "@/lib/utils";

/** Overlapping logos of a basket's largest holdings, plus "+n" when it holds more. */
export function AssetStack({ assets, size = 30, max = 3, className }: { assets: DiscoverySearchItem["topAssets"]; size?: number; max?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("flex items-center", className)}>
      {assets.slice(0, max).map((a, i) => (
        <AssetMark key={a.symbol} symbol={a.symbol} index={i} size={size} className="-ml-2 ring-2 ring-surface first:ml-0" />
      ))}
    </span>
  );
}

/** The 1-year simulated net return, coloured by sign; "New" until a year of model data exists. */
export function ReturnFigure({ value, className }: { value: string | null; className?: string }) {
  if (value === null) return <span className={cn("text-ink-muted", className)}>New</span>;
  const up = Number(value) >= 0;
  return <span className={cn("tabular-nums", up ? "text-success" : "text-danger", className)}>{formatFraction(value, true)}</span>;
}

/**
 * Annualised volatility of the simulated model, as a number and a 5-step meter on a fixed 0–100% scale (no
 * low/medium/high verdict is implied). Shows "—" until performance data exists.
 */
export function VolatilityFigure({ value, className }: { value: string | null; className?: string }) {
  if (value === null) return <span className={cn("text-ink-muted", className)}>—</span>;
  const pct = Number(value) * 100;
  const steps = Math.min(5, Math.max(1, Math.ceil(pct / 20)));
  return (
    <span className={cn("inline-flex items-center gap-2 tabular-nums text-ink", className)}>
      <span aria-hidden className="flex items-end gap-0.5">
        {[1, 2, 3, 4, 5].map((s) => <span key={s} className={cn("w-1 rounded-full", s <= steps ? "bg-ink-muted" : "bg-line-strong")} style={{ height: 4 + s * 2 }} />)}
      </span>
      {`${pct.toFixed(0)}%`}
    </span>
  );
}

/**
 * A basket as a research entry point (rails and grids): holdings at a glance, who runs it, minimum, simulated 1-year
 * return and volatility. Figures are simulated model performance and labelled as such. Every string renders as text.
 */
export function BasketCard({ b, className, headingLevel: H = "h3", showStatus = false }: { b: DiscoverySearchItem; className?: string; headingLevel?: "h2" | "h3"; showStatus?: boolean }) {
  const status = BASKET_STATUS_LABEL[b.status];
  return (
    <article className={cn("group relative flex h-full flex-col rounded-card border border-line bg-surface p-5 transition-[border-color,box-shadow,transform] duration-300 ease-calm hover:-translate-y-0.5 hover:border-line-strong hover:shadow-float has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus sm:p-6", className)}>
      <div className="flex items-start justify-between gap-3">
        <AssetStack assets={b.topAssets} size={34} />
        <BookmarkButton slug={b.slug} name={b.name} className="-mt-1.5 -mr-2" />
      </div>
      <H className="mt-5 text-lg leading-snug font-normal tracking-tight text-ink">
        <Link href={`/baskets/${b.slug}`} className="after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">{b.name}</Link>
      </H>
      <p className="mt-1 truncate text-sm text-ink-muted">by {b.organizationName}</p>
      {b.shortDescription && <p className="mt-3 line-clamp-2 text-sm text-ink-muted">{b.shortDescription}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="rounded-pill bg-surface-muted px-2.5 py-1 text-[0.6875rem] text-ink-muted">{BASKET_CATEGORY_LABEL[b.category]}</span>
        {(showStatus || b.status !== "ACTIVE") && <StatusBadge {...status} />}
        {b.hasEligibilityRequirements && <span className="inline-flex items-center gap-1 rounded-pill bg-surface-muted px-2.5 py-1 text-[0.6875rem] text-ink-muted"><ShieldAlert aria-hidden className="size-3" />Eligibility requirements</span>}
      </div>
      <dl className="mt-auto grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
        <div className="space-y-1"><dt className="text-[0.6875rem] text-ink-faint">Min. amount</dt><dd className="text-ink tabular-nums">{`${b.minimumInvestmentUsdc} USDC`}</dd></div>
        <div className="space-y-1"><dt className="text-[0.6875rem] text-ink-faint">1y · simulated</dt><dd><ReturnFigure value={b.netReturn1y} /></dd></div>
        <div className="space-y-1"><dt className="text-[0.6875rem] text-ink-faint">Volatility</dt><dd><VolatilityFigure value={b.volatility} /></dd></div>
      </dl>
      <p className="sr-only">{`Largest holdings: ${b.topAssets.map((a) => `${a.symbol} ${formatBps(a.bps)}`).join(", ")}. Management fee ${formatBps(b.managementFeeBps)}.`}</p>
    </article>
  );
}

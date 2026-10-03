import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL } from "@repo/app-core/basket-status";
import { formatBps, formatFraction } from "@repo/app-core/format";
import type { DiscoverySearchItem } from "@repo/validator";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";

/** Shared by the structured results (server) and the AI results (client). Every string renders as text. */
export function ResultsList({ items }: { items: DiscoverySearchItem[] }) {
  if (items.length === 0) return <p role="status" className="text-sm text-stone">No baskets match. Try removing a filter.</p>;
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.map((b) => (
        <li key={b.slug}>
          <Card className="h-full rounded-2xl border-border-dark bg-slate">
            <CardContent className="space-y-2">
              <h2 className="font-display text-lg font-semibold text-ivory"><Link href={`/baskets/${b.slug}`} className="underline-offset-4 hover:underline">{b.name}</Link></h2>
              <p className="text-xs text-stone">{b.organizationName} · {BASKET_CATEGORY_LABEL[b.category]}</p>
              {b.shortDescription && <p className="text-sm text-ivory">{b.shortDescription}</p>}
              <p className="text-sm text-ivory">{b.topAssets.slice(0, 3).map((a) => `${a.symbol} ${formatBps(a.bps)}`).join(" · ")}</p>
              <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-stone">
                <div><dt className="inline">1 y net </dt><dd className="inline text-ivory">{b.netReturn1y === null ? "New" : formatFraction(b.netReturn1y, true)}</dd></div>
                <div><dt className="inline">Minimum </dt><dd className="inline text-ivory">{b.minimumInvestmentUsdc} USDC</dd></div>
                <div><dt className="inline">Management fee </dt><dd className="inline text-ivory">{formatBps(b.managementFeeBps)}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-2">
                <StatusBadge {...BASKET_STATUS_LABEL[b.status]} />
                {b.hasEligibilityRequirements && <StatusBadge tone="neutral" label="Eligibility requirements" />}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

import type { DiscoverySearchItem } from "@repo/validator";
import { SearchX } from "lucide-react";
import { BasketRow, BasketRowHeader } from "@/components/baskets/basket-row";

/** Shared by the structured results (server) and the AI results (client): one scannable list. Every string renders as text. */
export function ResultsList({ items }: { items: DiscoverySearchItem[] }) {
  if (items.length === 0) {
    return (
      <div role="status" className="flex flex-col items-start gap-3 rounded-card border border-dashed border-line-strong px-6 py-10">
        <span aria-hidden className="grid size-10 place-items-center rounded-full bg-surface-muted text-ink-faint"><SearchX className="size-4.5" /></span>
        <p className="text-base text-ink">No baskets match. Try removing a filter.</p>
      </div>
    );
  }
  return (
    <div className="rounded-card border border-line bg-surface-muted/40 p-1.5 pt-4">
      <BasketRowHeader />
      <ul className="divide-y divide-line">
        {items.map((b) => <li key={b.slug}><BasketRow b={b} /></li>)}
      </ul>
    </div>
  );
}

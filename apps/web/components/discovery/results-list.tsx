import type { DiscoverySearchItem } from "@repo/validator";
import { SearchX } from "lucide-react";
import { BasketCard } from "@/components/baskets/basket-card";

/** Shared by the structured results (server) and the AI results (client). Every string renders as text. */
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
    <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {items.map((b) => <li key={b.slug}><BasketCard b={b} headingLevel="h2" showStatus /></li>)}
    </ul>
  );
}

import { BASKET_CATEGORY_LABEL } from "@repo/app-core/basket-status";
import { encodeDiscoveryFilters } from "@repo/api-client";
import { basketCategorySchema, type DiscoveryFilters } from "@repo/validator";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Quick category switcher above the results: "All" plus one chip per category; keeps the other filters. */
export function CategoryChips({ filters }: { filters: DiscoveryFilters }) {
  const active = filters.categories?.length === 1 ? filters.categories[0] : filters.categories?.length ? "many" : null;
  const href = (category: DiscoveryFilters["categories"]) => {
    const { categories: _c, cursor: _cursor, ...rest } = filters;
    const next = category ? { ...rest, categories: category } : rest;
    return Object.keys(next).length ? `/baskets?f=${encodeDiscoveryFilters(next)}` : "/baskets";
  };
  const chip = "inline-flex min-h-10 shrink-0 items-center rounded-pill border px-4 text-sm transition-colors";
  return (
    <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-2">
        <li><Link href={href(undefined)} aria-current={active === null ? "page" : undefined} className={cn(chip, active === null ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink")}>All</Link></li>
        {basketCategorySchema.options.map((c) => (
          <li key={c}>
            <Link href={href([c])} aria-current={active === c ? "page" : undefined} className={cn(chip, active === c ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink")}>{BASKET_CATEGORY_LABEL[c]}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

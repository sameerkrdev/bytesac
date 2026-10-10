import { createApiClient, decodeDiscoveryFilters, encodeDiscoveryFilters } from "@repo/api-client";
import type { DiscoveryCollectionsResponse } from "@repo/validator";
import { Flame, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { BasketRail } from "@/components/baskets/basket-rail";
import { AiSearchBox } from "@/components/discovery/ai-search-box";
import { CategoryChips } from "@/components/discovery/category-chips";
import { FiltersPanel } from "@/components/discovery/filters-panel";
import { ResultsList } from "@/components/discovery/results-list";
import { PageHeader } from "@/components/layout/page-layout";
import { API_ORIGIN, serverFetch } from "@/lib/server-api";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Baskets" };

const NO_COLLECTIONS: DiscoveryCollectionsResponse = { featured: [], trending: [] };

export default async function PublicBasketsPage({ searchParams }: { searchParams: Promise<{ f?: string; cursor?: string }> }) {
  const { f, cursor } = await searchParams;
  const filters = decodeDiscoveryFilters(f); // invalid `f` is ignored
  const canonical = Object.keys(filters).length ? encodeDiscoveryFilters(filters) : undefined;
  const client = createApiClient({ baseUrl: API_ORIGIN, transport: { kind: "cookie" }, fetch: serverFetch });
  const browsing = !canonical && !cursor;
  const [{ items, nextCursor }, collections] = await Promise.all([
    client.discoverBaskets({ ...filters, cursor }),
    // Rails only on the unfiltered first page; a failure just hides them.
    browsing ? client.getDiscoveryCollections().catch(() => NO_COLLECTIONS) : Promise.resolve(NO_COLLECTIONS),
  ]);

  return (
    <section aria-labelledby="page-title" className="space-y-10 md:space-y-14">
      <PageHeader id="page-title" eyebrow="Discover" title="Baskets"
        description="Strategies from verified organizations. Research what each one holds, why, what it costs and how it has changed — then decide."
        actions={<Link href="/assets" className={buttonVariants({ variant: "secondary" })}>Asset registry</Link>} />
      <AiSearchBox />
      {browsing && (collections.featured.length > 0 || collections.trending.length > 0) && (
        <div className="space-y-12">
          <BasketRail id="featured-title" bleed title="Featured" icon={<Sparkles aria-hidden className="size-4 text-accent" />} items={collections.featured}
            description="Chosen by the Bytesac team. Being featured is not advice or a view on future returns." />
          <BasketRail id="trending-title" bleed title="Trending" icon={<Flame aria-hidden className="size-4 text-warning" />} items={collections.trending}
            description="Most new investors over the last 30 days." />
        </div>
      )}
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="type-heading text-ink">{browsing ? "All baskets" : "Results"}</h2>
        </div>
        <CategoryChips filters={filters} />
        <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-10">
          <FiltersPanel key={canonical} filters={filters} />
          <div className="min-w-0 space-y-6">
            <p className="text-sm text-ink-muted">
              {items.length === 0 ? "No results" : `${items.length}${nextCursor ? "+" : ""} ${items.length === 1 ? "basket" : "baskets"}`}
              {canonical && <> · <Link href="/baskets" className="text-ink underline-offset-4 hover:underline">clear filters</Link></>}
            </p>
            <ResultsList items={items} />
            {nextCursor && <Link href={`/baskets?${new URLSearchParams({ ...(canonical && { f: canonical }), cursor: nextCursor })}`} className={buttonVariants({ variant: "secondary" })}>Load more</Link>}
            <p className="text-xs text-ink-faint">Returns and volatility are simulated model performance, not actual investor results. Saved baskets are kept on this device.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

import { createApiClient, decodeDiscoveryFilters, encodeDiscoveryFilters } from "@repo/api-client";
import type { Metadata } from "next";
import Link from "next/link";
import { AiSearchBox } from "@/components/discovery/ai-search-box";
import { FiltersPanel } from "@/components/discovery/filters-panel";
import { ResultsList } from "@/components/discovery/results-list";
import { PageHeader } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Baskets" };

export default async function PublicBasketsPage({ searchParams }: { searchParams: Promise<{ f?: string; cursor?: string }> }) {
  const { f, cursor } = await searchParams;
  const filters = decodeDiscoveryFilters(f); // invalid `f` is ignored
  const canonical = Object.keys(filters).length ? encodeDiscoveryFilters(filters) : undefined;
  const client = createApiClient({ baseUrl: process.env.API_ORIGIN ?? "http://localhost:4000", transport: { kind: "cookie" } });
  const { items, nextCursor } = await client.discoverBaskets({ ...filters, cursor });

  return (
    <section aria-labelledby="page-title" className="space-y-10 md:space-y-14">
      <PageHeader id="page-title" eyebrow="Discover" title="Baskets"
        description="Strategies from verified organizations. Research what each one holds, why, what it costs and how it has changed — then decide."
        actions={<Link href="/assets" className={buttonVariants({ variant: "secondary" })}>Asset registry</Link>} />
      <AiSearchBox />
      <div className="grid gap-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-12">
        <FiltersPanel key={canonical} filters={filters} />
        <div className="min-w-0 space-y-6">
          <p className="text-sm text-ink-muted">
            {items.length === 0 ? "No results" : `${items.length}${nextCursor ? "+" : ""} ${items.length === 1 ? "basket" : "baskets"}`}
            {canonical && <> · <Link href="/baskets" className="text-ink underline-offset-4 hover:underline">clear filters</Link></>}
          </p>
          <ResultsList items={items} />
          {nextCursor && <Link href={`/baskets?${new URLSearchParams({ ...(canonical && { f: canonical }), cursor: nextCursor })}`} className={buttonVariants({ variant: "secondary" })}>Load more</Link>}
          <p className="text-xs text-ink-faint">Returns shown are simulated model performance, not actual investor results.</p>
        </div>
      </div>
    </section>
  );
}

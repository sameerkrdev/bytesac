import { createApiClient, decodeDiscoveryFilters, encodeDiscoveryFilters } from "@repo/api-client";
import type { Metadata } from "next";
import Link from "next/link";
import { AiSearchBox } from "@/components/discovery/ai-search-box";
import { FiltersPanel } from "@/components/discovery/filters-panel";
import { ResultsList } from "@/components/discovery/results-list";
import { PageLayout } from "@/components/layout/page-layout";

export const metadata: Metadata = { title: "Baskets · Bytesac" };

export default async function PublicBasketsPage({ searchParams }: { searchParams: Promise<{ f?: string; cursor?: string }> }) {
  const { f, cursor } = await searchParams;
  const filters = decodeDiscoveryFilters(f); // invalid `f` is ignored
  const canonical = Object.keys(filters).length ? encodeDiscoveryFilters(filters) : undefined;
  const client = createApiClient({ baseUrl: process.env.API_ORIGIN ?? "http://localhost:4000", transport: { kind: "cookie" } });
  const { items, nextCursor } = await client.discoverBaskets({ ...filters, cursor });

  return (
    <PageLayout title="Baskets">
      <AiSearchBox />
      <div className="grid gap-8 md:grid-cols-[18rem_1fr]">
        <FiltersPanel key={canonical} filters={filters} />
        <div className="space-y-6">
          <ResultsList items={items} />
          {nextCursor && <Link href={`/baskets?${new URLSearchParams({ ...(canonical && { f: canonical }), cursor: nextCursor })}`} className="inline-flex min-h-11 items-center rounded-lg border border-border-dark px-4 text-sm text-ivory hover:bg-slate">Load more</Link>}
        </div>
      </div>
    </PageLayout>
  );
}

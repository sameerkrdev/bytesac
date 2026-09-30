import { BASKET_CATEGORY_LABEL, BASKET_STATUS_LABEL } from "@repo/app-core/basket-status";
import { publicBasketListResponseSchema } from "@repo/validator";
import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";

export const metadata: Metadata = { title: "Baskets · Bytesac" };

export default async function PublicBasketsPage({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const res = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/v1/public/baskets${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`GET public baskets failed: ${res.status}`);
  const { items, nextCursor } = publicBasketListResponseSchema.parse(await res.json());

  return (
    <main className="mx-auto min-h-screen max-w-4xl space-y-6 bg-space px-4 py-10 md:px-8">
      <h1 className="font-display text-3xl font-bold text-ivory md:text-4xl">Baskets</h1>
      {items.length === 0 ? <p className="text-sm text-stone">No baskets are published yet.</p> : (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((b) => (
            <li key={b.slug}>
              <Card className="h-full rounded-2xl border-border-dark bg-slate">
                <CardContent className="space-y-2">
                  <h2 className="font-display text-lg font-semibold text-ivory"><Link href={`/baskets/${b.slug}`} className="underline-offset-4 hover:underline">{b.name}</Link></h2>
                  <p className="text-xs text-stone">{b.organizationName ?? "Organization"} · {BASKET_CATEGORY_LABEL[b.category]}</p>
                  {b.shortDescription && <p className="text-sm text-ivory">{b.shortDescription}</p>}
                  <p className="text-xs text-stone">{b.assetCount} assets · minimum {b.minimumInvestmentUsdc ? `${b.minimumInvestmentUsdc} USDC` : "not set"} · published {new Date(b.publishedAt).toLocaleDateString()}</p>
                  <StatusBadge {...BASKET_STATUS_LABEL[b.status]} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {nextCursor && <Link href={`/baskets?cursor=${encodeURIComponent(nextCursor)}`} className="inline-flex min-h-11 items-center rounded-lg border border-border-dark px-4 text-sm text-ivory hover:bg-slate">Load more</Link>}
    </main>
  );
}

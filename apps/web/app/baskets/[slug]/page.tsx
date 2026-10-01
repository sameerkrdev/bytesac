import { formatBps } from "@repo/app-core/format";
import { BASKET_STATUS_LABEL, SECTOR_LABEL } from "@repo/app-core/basket-status";
import { publicBasketResponseSchema, type BasketStatus } from "@repo/validator";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { InvestButton } from "@/components/invest/invest-button";
import { PerformanceChart } from "@/components/baskets/performance-chart";
import { BasketView } from "@/components/baskets/basket-view";
import { DiffSummary } from "@/components/baskets/version-history";
import { StatusBadge } from "@/components/status-badge";

export const metadata: Metadata = { title: "Basket · Bytesac" };

const NOTICE: Partial<Record<BasketStatus, string>> = {
  PAUSED: "This basket is paused by its manager or by Bytesac.",
  REASSIGNMENT_REQUIRED: "The basket's lead manager left. A new lead needs approval from Bytesac.",
  RETIREMENT_PENDING: "The manager asked to retire this basket. Bytesac has not decided yet.",
  RETIRED: "This basket is retired.",
};

export default async function PublicBasketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const res = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/v1/public/baskets/${encodeURIComponent(slug)}`, {
    headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`GET public basket failed: ${res.status}`);
  const b = publicBasketResponseSchema.parse(await res.json());
  if ("redirectTo" in b) permanentRedirect(`/baskets/${b.redirectTo}`);

  const names = Object.fromEntries(b.allocation.map((a) => [a.instrumentId, `${a.name} (${a.symbol})`]));
  const notice = NOTICE[b.status];
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 bg-space px-4 py-10 md:px-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold text-ivory md:text-4xl">{b.version.name}</h1>
        <p className="flex flex-wrap items-center gap-3 text-sm text-stone">
          <StatusBadge {...BASKET_STATUS_LABEL[b.status]} />
          <span>Version {b.version.versionNumber} · published {new Date(b.version.publishedAt).toLocaleDateString()}</span>
          <Link href={`/organizations/${b.organization.id}`} className="text-mint underline">{b.organization.displayName ?? "Organization"}</Link>
        </p>
      </div>
      {notice && <p role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">{notice}</p>}
      {b.hasAssetWarning && <p role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">One or more assets in this basket were paused or deprecated in the registry after publication.</p>}
      <InvestButton slug={slug} name={b.version.name} minimumUsdc={b.version.minimumInvestmentUsdc} incrementUsdc={b.version.minimumIncrementUsdc} />

      <PerformanceChart performance={b.performance} metrics={b.metrics} label={b.label} />

      <BasketView content={b.version} disclosures={b.disclosures}
        allocation={b.allocation.map((a) => {
          const p = a.prices.find((x) => x.status === "ok" && x.value !== null);
          return {
            ...a, key: a.instrumentId,
            price: p ? <>{p.value} {p.currency}{p.stale && <span className="ml-2 rounded border border-warning/40 px-1.5 py-0.5 text-xs text-warning">Stale</span>}</> : "Price unavailable",
          };
        })} />

      {(b.sectors.length > 0 || b.tags.length > 0) && (
        <section aria-label="Sectors and tags" className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-ivory">Sectors</h2>
          <ul className="space-y-2">
            {b.sectors.map((s) => (
              <li key={s.sector} className="space-y-1">
                <p className="flex justify-between text-sm text-ivory"><span>{SECTOR_LABEL[s.sector]}</span><span>{formatBps(s.bps)}</span></p>
                <div aria-hidden className="h-2 rounded bg-border-dark"><div className="h-2 rounded bg-mint" style={{ width: `${Math.min(s.bps / 100, 100)}%` }} /></div>
              </li>
            ))}
          </ul>
          {b.tags.length > 0 && <p className="text-sm text-stone">Tags: {b.tags.map((t) => t.label).join(", ")}</p>}
        </section>
      )}

      <section aria-label="Version history" className="space-y-3">
        <h2 className="font-display text-xl font-semibold text-ivory">Version history</h2>
        <ul className="divide-y divide-border-dark">
          {b.versionHistory.map((h) => (
            <li key={h.versionNumber} className="space-y-1 py-3">
              <p className="text-sm font-medium text-ivory">Version {h.versionNumber} <span className="font-normal text-stone">· {new Date(h.publishedAt).toLocaleDateString()}</span></p>
              {h.rationale && <p className="whitespace-pre-wrap text-sm text-stone">{h.rationale}</p>}
              <DiffSummary diff={h.diff} names={names} />
            </li>
          ))}
        </ul>
      </section>

      {([["Current managers", b.managers.filter((m) => m.to === null)], ["Former managers", b.managers.filter((m) => m.to !== null)]] as const).map(([title, list]) => list.length > 0 && (
        <section key={title} aria-label={title} className="space-y-3">
          <h2 className="font-display text-xl font-semibold text-ivory">{title}</h2>
          <ul className="space-y-2">
            {list.map((m, i) => (
              <li key={i} className="text-sm text-ivory">
                {m.handle ? <Link href={`/managers/${m.handle}`} className="font-medium text-mint underline">{m.displayName}</Link> : <span className="font-medium">{m.displayName}</span>}
                <span className="text-stone"> · {m.role === "lead" ? "Lead" : "Co-manager"} · from {new Date(m.from).toLocaleDateString()}{m.to && ` to ${new Date(m.to).toLocaleDateString()}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

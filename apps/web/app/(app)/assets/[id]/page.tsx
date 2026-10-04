"use client";

import { ASSET_TYPE_LABEL, shortAddress } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock, ShieldAlert } from "lucide-react";
import { useParams } from "next/navigation";
import { PageLayout } from "@/components/layout/page-layout";
import { ErrorState, LoadingState, StaleNotice } from "@/components/layout/states";
import { Callout } from "@/components/ui/kit";
import { AssetMark, ChainBadge } from "@/components/visual/chain-badge";
import { api } from "@/lib/api";

const METHOD: Record<string, string> = {
  swap: "Swap", subscription: "Issuer subscription", secondary_market: "Secondary market", platform_inventory: "Platform inventory", redemption: "Issuer redemption", cross_chain_transfer: "Cross-chain transfer",
};
const STANDARD: Record<string, string> = { native: "Native", erc20: "ERC-20", spl: "SPL", spl_token_2022: "SPL Token-2022", other: "Other" };

/**
 * One instrument, then where it lives (deployments per network) and how Bytesac can trade it (routes).
 * Tokenized assets carry issuer and restriction notes; Bytesac buys and sells them on secondary markets only.
 */
export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ["asset", id], queryFn: () => api.getAsset(id) });
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const a = q.data;
  const rwa = a.assetType.startsWith("TOKENIZED_");
  const market = a.prices.find((p) => p.kind === "market");
  const nav = a.prices.find((p) => p.kind === "nav");
  return (
    <PageLayout breadcrumb={[{ label: "Assets", href: "/assets" }, { label: a.symbol }]} eyebrow={ASSET_TYPE_LABEL[a.assetType]}
      title={<span className="flex items-center gap-4"><AssetMark symbol={a.symbol} size={48} />{a.name}</span>}>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-10">
          {a.description && <p className="max-w-2xl type-lede text-ink">{a.description}</p>}
          {rwa && (
            <Callout tone="warning" icon={<ShieldAlert />} title="Tokenized real-world asset">
              Depends on its issuer{a.issuer ? ` (${a.issuer.name})` : ""} and may be restricted by region or investor status. Bytesac buys and sells it on secondary markets only — it never subscribes to or redeems with the issuer, and settlement is not instant redemption.
            </Callout>
          )}

          <section aria-labelledby="deployments" className="space-y-4">
            <div><p className="type-eyebrow text-ink-faint">Where it lives</p><h2 id="deployments" className="mt-2 type-heading text-ink">Deployments</h2></div>
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {a.deployments.map((d) => (
                <li key={`${d.chain}-${d.address}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <ChainBadge chain={d.chain} />
                  <span className="font-mono text-xs text-ink-muted">{STANDARD[d.tokenStandard] ?? d.tokenStandard} · {d.decimals} decimals{d.address && <> · <span title={d.address}>{shortAddress(d.address)}</span></>}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-faint">The same asset on different networks is a different token contract. Bytesac tracks each deployment separately.</p>
          </section>

          <section aria-labelledby="routes" className="space-y-4">
            <div><p className="type-eyebrow text-ink-faint">How it is traded</p><h2 id="routes" className="mt-2 type-heading text-ink">Execution routes</h2></div>
            {a.routes.length === 0 ? <p className="text-sm text-ink-muted">No active route — this asset can’t be traded through Bytesac right now.</p> : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {a.routes.map((r, i) => (
                  <li key={i} className="space-y-3 rounded-tile border border-line bg-surface p-4">
                    <div className="flex items-center justify-between gap-2"><ChainBadge chain={r.chain} /><span className="text-xs text-ink-muted">{r.providerName}</span></div>
                    <p className="text-sm text-ink">{METHOD[r.method] ?? r.method}{r.settlementSymbol && <span className="text-ink-muted"> · settles in {r.settlementSymbol}</span>}</p>
                    <p className="flex items-center gap-1.5 text-xs text-ink-muted">{r.processingModel === "async" && <Clock aria-hidden className="size-3.5" />}{r.processingModel === "async" ? "Asynchronous — settlement can take time" : "Settles in one transaction"}{r.minimumAmount && ` · minimum ${r.minimumAmount}`}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {a.riskNotes && <section aria-labelledby="risk" className="space-y-3"><h2 id="risk" className="type-heading text-ink">Risk notes</h2><p className="max-w-2xl whitespace-pre-wrap text-ink-muted">{a.riskNotes}</p></section>}
        </div>

        <aside className="space-y-4">
          <div className="rounded-card border border-line bg-surface p-6">
            <p className="type-eyebrow text-ink-faint">Market price</p>
            <p className="mt-2 type-figure text-4xl text-ink">{market?.status === "ok" && market.value ? `$${Number(market.value).toLocaleString(undefined, { maximumFractionDigits: 4 })}` : "Unavailable"}</p>
            {market?.stale && <div className="mt-3"><StaleNotice>Price may be out of date</StaleNotice></div>}
            {market?.observedAt && <p className="mt-2 text-xs text-ink-faint">Observed {new Date(market.observedAt).toLocaleString()}</p>}
            {nav && <p className="mt-5 border-t border-line pt-4 text-sm text-ink-muted">Issuer NAV {nav.value ? `$${nav.value}` : "unavailable"} <span className="block text-xs text-ink-faint">Display only — trades use market prices.</span></p>}
          </div>
          {a.issuer && (
            <div className="rounded-card border border-line bg-surface p-6 text-sm">
              <p className="type-eyebrow text-ink-faint">Issuer</p>
              <p className="mt-2 text-ink">{a.issuer.name}</p>
              {a.issuer.website?.startsWith("https://") && <a href={a.issuer.website} target="_blank" rel="noopener noreferrer nofollow" className="mt-2 inline-flex items-center gap-1 text-ink-muted underline-offset-4 hover:underline">Website<ArrowUpRight aria-hidden className="size-3.5" /></a>}
            </div>
          )}
        </aside>
      </div>
    </PageLayout>
  );
}

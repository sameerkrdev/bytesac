"use client";

import { ASSET_TYPE_LABEL } from "@repo/app-core";
import { assetTypeSchema, type AssetType } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Search } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";
import { PageLayout } from "@/components/layout/page-layout";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/states";
import { Input } from "@/components/ui/input";
import { AssetMark, ChainBadge } from "@/components/visual/chain-badge";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const isRwa = (t: AssetType) => t.startsWith("TOKENIZED_");

/** The asset registry as investors see it: approved instruments and the networks each is deployed on. */
export default function AssetsPage() {
  const [q, setQ] = useState("");
  const [type, setType] = useState<AssetType | "">("");
  const query = useDeferredValue(q.trim());
  const list = useQuery({ queryKey: ["assets", query, type], queryFn: () => api.listAssets({ ...(query && { q: query }), ...(type && { type }) }) });
  return (
    <PageLayout eyebrow="Asset registry" title="Assets" description="Every asset a basket can hold is approved here first, per network. An asset is more than its ticker: each deployment and route is reviewed on its own.">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search assets</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or symbol" className="pl-10" />
        </label>
        <div role="group" aria-label="Asset type" className="flex gap-1 overflow-x-auto rounded-pill border border-line bg-surface p-1 [scrollbar-width:none]">
          {(["", "CRYPTO", "STABLECOIN", ...assetTypeSchema.options.filter(isRwa)] as const).slice(0, 5).map((t) => (
            <button key={t || "all"} type="button" aria-pressed={type === t} onClick={() => setType(t)}
              className={cn("min-h-9 shrink-0 rounded-pill px-3.5 text-xs font-medium whitespace-nowrap text-ink-muted hover:text-ink", type === t && "bg-primary text-primary-ink hover:text-primary-ink")}>
              {t ? ASSET_TYPE_LABEL[t] : "All"}
            </button>
          ))}
        </div>
      </div>
      {list.isPending ? <LoadingState /> : list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : list.data.items.length === 0 ? <EmptyState title="No assets match." /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {list.data.items.map((a, i) => (
            <li key={a.id}>
              <Link href={`/assets/${a.id}`} className="group grid min-h-18 grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3 transition-colors hover:bg-surface-muted sm:grid-cols-[auto_1fr_auto_auto]">
                <AssetMark symbol={a.symbol} index={i} size={36} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{a.name}</span>
                  <span className="block text-xs text-ink-muted">{a.symbol} · {ASSET_TYPE_LABEL[a.assetType]}</span>
                </span>
                <span className="hidden flex-wrap justify-end gap-1 sm:flex">{a.chains.map((c) => <ChainBadge key={c} chain={c} compact />)}</span>
                <ArrowUpRight aria-hidden className="size-4 text-ink-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageLayout>
  );
}

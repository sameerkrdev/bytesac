"use client";

import type { ApiClient } from "@repo/api-client";
import { ASSET_TYPE_LABEL, INSTRUMENT_STATUS_LABEL } from "@repo/app-core";
import { ASSET_CHAINS, INSTRUMENT_STATUSES, assetChainSchema, assetTypeSchema, opsAssetListQuerySchema } from "@repo/validator";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { OpsError } from "../ops-error";

type Client = Pick<ApiClient, "opsListAssets">;

export function AssetsTable({ client = api }: { client?: Client }) {
  const router = useRouter();
  const params = useSearchParams();
  // Unknown values in a hand-edited URL are ignored instead of reaching the API.
  const filters = opsAssetListQuerySchema.omit({ cursor: true }).catch({}).parse({
    status: params.get("status") ?? undefined, type: params.get("type") ?? undefined, chain: params.get("chain") ?? undefined, q: params.get("q") ?? undefined,
  });
  const [search, setSearch] = useState(filters.q ?? "");
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`/ops/assets?${next}`);
  };
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== (filters.q ?? "")) set("q", search.trim()); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on the typed text only
  }, [search]);

  const list = useInfiniteQuery({
    queryKey: ["ops", "assets", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.opsListAssets({ ...filters, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const chains = (chs: readonly (keyof typeof ASSET_CHAINS)[]) => chs.map((c) => ASSET_CHAINS[c].label).join(", ") || "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold text-ivory">Assets</h1>
        <Link href="/ops/assets/new" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">New asset</Link>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="f-status" className="text-xs font-medium text-ivory">Status</Label>
          <Select id="f-status" value={filters.status ?? ""} onChange={(e) => set("status", e.target.value)}>
            <option value="">All statuses</option>
            {INSTRUMENT_STATUSES.map((s) => <option key={s} value={s}>{INSTRUMENT_STATUS_LABEL[s].label}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="f-type" className="text-xs font-medium text-ivory">Type</Label>
          <Select id="f-type" value={filters.type ?? ""} onChange={(e) => set("type", e.target.value)}>
            <option value="">All types</option>
            {assetTypeSchema.options.map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="f-chain" className="text-xs font-medium text-ivory">Chain</Label>
          <Select id="f-chain" value={filters.chain ?? ""} onChange={(e) => set("chain", e.target.value)}>
            <option value="">All chains</option>
            {assetChainSchema.options.map((c) => <option key={c} value={c}>{ASSET_CHAINS[c].label}</option>)}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="f-q" className="text-xs font-medium text-ivory">Search</Label>
          <Input id="f-q" type="search" placeholder="Name or symbol" value={search} onChange={(e) => setSearch(e.target.value)} className="min-h-11 bg-space text-ivory placeholder:text-stone" />
        </div>
      </div>

      {list.isError ? <OpsError error={list.error} /> : list.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No assets found.</p>
      ) : (
        <>
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="text-xs text-stone">
              <tr><th className="py-2 pr-4 font-medium">Name</th><th className="pr-4 font-medium">Symbol</th><th className="pr-4 font-medium">Type</th><th className="pr-4 font-medium">Chains</th><th className="pr-4 font-medium">Status</th><th className="font-medium">Updated</th></tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-border-dark">
                  <td className="py-3 pr-4"><Link href={`/ops/assets/${i.id}`} className="font-medium text-ivory underline-offset-4 hover:underline">{i.name}</Link></td>
                  <td className="pr-4 text-ivory">{i.symbol}</td>
                  <td className="pr-4 text-stone">{ASSET_TYPE_LABEL[i.assetType]}</td>
                  <td className="pr-4 text-stone">{chains(i.chains)}</td>
                  <td className="pr-4"><StatusBadge {...INSTRUMENT_STATUS_LABEL[i.status]} /></td>
                  <td className="text-stone">{new Date(i.updatedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-3 md:hidden">
            {items.map((i) => (
              <li key={i.id}>
                <Link href={`/ops/assets/${i.id}`} className="block space-y-2 rounded-xl border border-border-dark bg-slate p-4">
                  <span className="block font-medium text-ivory">{i.name} · {i.symbol}</span>
                  <span className="block text-xs text-stone">{ASSET_TYPE_LABEL[i.assetType]} · {chains(i.chains)}</span>
                  <StatusBadge {...INSTRUMENT_STATUS_LABEL[i.status]} />
                </Link>
              </li>
            ))}
          </ul>
          {list.hasNextPage && <Button variant="secondary" className="min-h-11" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button>}
        </>
      )}
    </div>
  );
}

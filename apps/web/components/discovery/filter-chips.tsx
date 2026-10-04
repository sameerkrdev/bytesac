"use client";

import { BASKET_CATEGORY_LABEL, SECTOR_LABEL, ASSET_TYPE_LABEL, formatBps } from "@repo/app-core";
import type { DiscoveryFilters } from "@repo/validator";
import { X } from "lucide-react";

type Key = Exclude<keyof DiscoveryFilters, "cursor" | "sort">;
const band = (r: { minBps?: number; maxBps?: number }) => ` ${r.minBps !== undefined ? formatBps(r.minBps) : "0%"} to ${r.maxBps !== undefined ? formatBps(r.maxBps) : "100%"}`;

const describe: { [K in Key]: (v: NonNullable<DiscoveryFilters[K]>) => string } = {
  q: (v) => `Keywords: ${v}`,
  organizationId: () => "One organization",
  managerHandle: (v) => `Manager: ${v}`,
  categories: (v) => `Category: ${v.map((c) => BASKET_CATEGORY_LABEL[c]).join(", ")}`,
  assets: (v) => `Assets: ${v.map((a) => `${a.symbol ?? "asset"}${band(a)}`).join(", ")}`,
  assetTypes: (v) => `Asset types: ${v.map((a) => `${ASSET_TYPE_LABEL[a.type]}${band(a)}`).join(", ")}`,
  sectors: (v) => `Sectors: ${v.map((s) => `${SECTOR_LABEL[s.sector]}${band(s)}`).join(", ")}`,
  tags: (v) => `Tags: ${v.join(", ")}`,
  maxSingleWeightBps: (v) => `No asset above ${formatBps(v)}`,
  maxMinimumInvestmentUsdc: (v) => `Minimum up to ${v} USDC`,
  maxFeeBps: (v) => `Fees up to ${Object.entries(v).map(([k, b]) => `${k} ${formatBps(b)}`).join(", ")}`,
  reviewFrequencies: (v) => `Review: ${v.join(", ")}`,
  minBasketAgeDays: (v) => `At least ${v} days old`,
  performance: (v) => `Performance: ${Object.entries(v).map(([k, f]) => `${k} ${f}`).join(", ")}`,
  minManagerExperienceYears: (v) => `Manager experience ${v}+ years`,
};

/** The filters the AI search used. Removing one hands the rest to the structured search. */
export function FilterChips({ filters, onChange }: { filters: DiscoveryFilters; onChange(next: DiscoveryFilters): void }) {
  const keys = (Object.keys(describe) as Key[]).filter((k) => filters[k] !== undefined);
  return (
    <ul aria-label="Filters used" className="flex flex-wrap gap-2">
      {keys.map((k) => (
        <li key={k} className="inline-flex min-h-10 items-center gap-0.5 rounded-pill border border-line-strong/70 bg-surface py-0.5 pl-3.5 text-sm text-ink shadow-soft">
          <span>{(describe[k] as (v: unknown) => string)(filters[k])}</span>
          <button type="button" aria-label={`Remove filter: ${(describe[k] as (v: unknown) => string)(filters[k])}`} className="inline-flex size-9 items-center justify-center rounded-pill text-ink-faint hover:bg-surface-muted hover:text-ink"
            onClick={() => { const { [k]: _removed, ...rest } = filters; onChange(rest); }}>
            <X aria-hidden className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}

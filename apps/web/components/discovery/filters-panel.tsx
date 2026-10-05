"use client";

import { ASSET_TYPE_LABEL, BASKET_CATEGORY_LABEL, REVIEW_FREQUENCY_LABEL, SECTOR_LABEL } from "@repo/app-core";
import { encodeDiscoveryFilters } from "@repo/api-client";
import { INSTRUMENT_SECTORS, assetTypeSchema, basketCategorySchema, discoveryFiltersSchema, type DiscoveryFilters, type DiscoverySort } from "@repo/validator";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface Row { key: string; min: string; max: string }
const SORTS: Record<DiscoverySort, string> = { relevance: "Relevance", newest: "Newest", return_1y: "1 y net return", return_since_launch: "Return since launch", minimum_asc: "Lowest minimum", management_fee_asc: "Lowest management fee" };
const FEES = ["entry", "management", "rebalance", "subscription"] as const;
const PERF = [["minNetReturn1y", "Minimum 1 y net return (%)"], ["minNetReturnSinceLaunch", "Minimum return since launch (%)"], ["maxVolatility", "Maximum volatility (%)"], ["maxDrawdown", "Maximum drawdown (%)"]] as const;

// The form edits percents; filters carry basis points and decimal fractions.
const toBps = (s: string) => Math.round(Number(s) * 100);
const fromBps = (n: number | undefined) => (n === undefined ? "" : String(n / 100));
const toFraction = (s: string) => (Number(s) / 100).toFixed(6);
const fromFraction = (s: string | undefined) => (s === undefined ? "" : String(Number((Number(s) * 100).toFixed(4))));
const rows = <T extends { minBps?: number; maxBps?: number }>(list: T[] | undefined, key: (t: T) => string): Row[] => (list ?? []).map((r) => ({ key: key(r), min: fromBps(r.minBps), max: fromBps(r.maxBps) }));
const bounds = (r: Row) => ({ ...(r.min.trim() && { minBps: toBps(r.min) }), ...(r.max.trim() && { maxBps: toBps(r.max) }) });
const num = (v: string, f: (s: string) => number) => (v.trim() ? f(v) : undefined);

function RangeRows({ legend, rows: list, options, onChange }: { legend: string; rows: Row[]; options?: Record<string, string>; onChange(next: Row[]): void }) {
  const patch = (i: number, p: Partial<Row>) => onChange(list.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const cls = "w-24";
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-xs font-medium text-ink-muted">{legend}</legend>
      {list.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          {options
            ? <Select aria-label={`${legend} ${i + 1}`} className="w-auto" value={r.key} onChange={(e) => patch(i, { key: e.target.value })}>{Object.entries(options).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            : <Input aria-label={`${legend} ${i + 1} symbol`} className="w-24 uppercase" placeholder="SOL" value={r.key} onChange={(e) => patch(i, { key: e.target.value })} />}
          <Input aria-label={`${legend} ${i + 1} minimum %`} type="number" min={0} max={100} step="any" placeholder="Min %" className={cls} value={r.min} onChange={(e) => patch(i, { min: e.target.value })} />
          <Input aria-label={`${legend} ${i + 1} maximum %`} type="number" min={0} max={100} step="any" placeholder="Max %" className={cls} value={r.max} onChange={(e) => patch(i, { max: e.target.value })} />
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(list.filter((_, k) => k !== i))}>Remove<span className="sr-only"> {legend} {i + 1}</span></Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" disabled={list.length >= 10} onClick={() => onChange([...list, { key: options ? Object.keys(options)[0]! : "", min: "", max: "" }])}>Add to {legend.toLowerCase()}</Button>
    </fieldset>
  );
}

const CATEGORIES = Object.fromEntries(basketCategorySchema.options.map((c) => [c, BASKET_CATEGORY_LABEL[c]]));
const TYPES = Object.fromEntries(assetTypeSchema.options.map((t) => [t, ASSET_TYPE_LABEL[t]]));
const SECTORS = Object.fromEntries(INSTRUMENT_SECTORS.map((s) => [s, SECTOR_LABEL[s]]));
const checkbox = (label: string, checked: boolean, onChange: () => void) => (
  <label key={label} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-ink"><input type="checkbox" className="size-4 accent-[var(--c-primary)]" checked={checked} onChange={onChange} />{label}</label>
);

/** A collapsible group of filters. */
function Group({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group border-t border-line py-1">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
        {title}<ChevronDown aria-hidden className="size-4 text-ink-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 pt-1 pb-5">{children}</div>
    </details>
  );
}

/** Draft filter form. Apply pushes the filters into the URL as one `f` param; the server page runs the search. */
export function FiltersPanel({ filters }: { filters: DiscoveryFilters }) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [f, setF] = useState({
    q: filters.q ?? "", organizationId: filters.organizationId ?? "", managerHandle: filters.managerHandle ?? "", categories: (filters.categories ?? []) as string[],
    assets: rows(filters.assets, (a) => a.symbol ?? ""), assetTypes: rows(filters.assetTypes, (a) => a.type), sectors: rows(filters.sectors, (a) => a.sector),
    tags: (filters.tags ?? []).join(", "), maxSingle: fromBps(filters.maxSingleWeightBps), maxMinimum: filters.maxMinimumInvestmentUsdc ?? "",
    fees: Object.fromEntries(FEES.map((k) => [k, fromBps(filters.maxFeeBps?.[k])])), reviews: (filters.reviewFrequencies ?? []) as string[], age: filters.minBasketAgeDays?.toString() ?? "",
    perf: Object.fromEntries(PERF.map(([k]) => [k, fromFraction(filters.performance?.[k])])), experience: filters.minManagerExperienceYears?.toString() ?? "",
  });
  const go = (next: DiscoveryFilters) => router.push(`/baskets?f=${encodeDiscoveryFilters(next)}`);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const field = (label: string, value: string, onChange: (v: string) => void, extra: ComponentProps<typeof Input> = {}) => (
    <Label key={label} className="block space-y-1.5 text-xs font-medium text-ink-muted">{label}
      <Input value={value} onChange={(e) => onChange(e.target.value)} {...extra} />
    </Label>
  );

  const apply = () => {
    const fee = Object.fromEntries(FEES.filter((k) => f.fees[k]?.trim()).map((k) => [k, toBps(f.fees[k]!)]));
    const perf = Object.fromEntries(PERF.filter(([k]) => f.perf[k]?.trim()).map(([k]) => [k, toFraction(f.perf[k]!)]));
    const tags = f.tags.split(",").map((t) => t.trim()).filter(Boolean);
    const parsed = discoveryFiltersSchema.safeParse({
      q: f.q.trim() || undefined, sort: filters.sort,
      organizationId: f.organizationId.trim() || undefined, managerHandle: f.managerHandle.trim() || undefined,
      categories: f.categories.length ? f.categories : undefined,
      assets: f.assets.length ? f.assets.map((r) => ({ symbol: r.key.trim(), ...bounds(r) })) : undefined,
      assetTypes: f.assetTypes.length ? f.assetTypes.map((r) => ({ type: r.key, ...bounds(r) })) : undefined,
      sectors: f.sectors.length ? f.sectors.map((r) => ({ sector: r.key, ...bounds(r) })) : undefined,
      tags: tags.length ? tags : undefined,
      maxSingleWeightBps: num(f.maxSingle, toBps), maxMinimumInvestmentUsdc: f.maxMinimum.trim() || undefined,
      maxFeeBps: Object.keys(fee).length ? fee : undefined, reviewFrequencies: f.reviews.length ? f.reviews : undefined,
      minBasketAgeDays: num(f.age, Number), performance: Object.keys(perf).length ? perf : undefined, minManagerExperienceYears: num(f.experience, Number),
    });
    setInvalid(!parsed.success);
    if (parsed.success) go(parsed.data);
  };

  return (
    <aside aria-label="Filters" className="space-y-4 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-2 scroll-quiet">
      <Button type="button" variant="secondary" className="lg:hidden" aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen(!open)}><SlidersHorizontal aria-hidden />Filters</Button>
      <form id={`${id}-body`} className={`${open ? "block" : "hidden"} space-y-1 lg:block`} onSubmit={(e) => { e.preventDefault(); apply(); }}>
        <div className="space-y-1.5 pb-4">
          <Label htmlFor={`${id}-sort`} className="text-xs font-medium text-ink-muted">Sort by</Label>
          <Select id={`${id}-sort`} value={filters.sort ?? "relevance"} onChange={(e) => go({ ...filters, sort: e.target.value as DiscoverySort })}>
            {Object.entries(SORTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </div>
        <Group title="Basics" open>
          {field("Keywords", f.q, (q) => setF({ ...f, q }), { maxLength: 200, spellCheck: false })}
          <fieldset className="space-y-0.5">
            <legend className="mb-1 text-xs font-medium text-ink-muted">Categories</legend>
            {Object.entries(CATEGORIES).map(([k, l]) => checkbox(l, f.categories.includes(k), () => setF({ ...f, categories: toggle(f.categories, k) })))}
          </fieldset>
        </Group>
        <Group title="Holdings" open>
          <RangeRows legend="Assets" rows={f.assets} onChange={(assets) => setF({ ...f, assets })} />
          <RangeRows legend="Asset types" rows={f.assetTypes} options={TYPES} onChange={(assetTypes) => setF({ ...f, assetTypes })} />
          <RangeRows legend="Sectors" rows={f.sectors} options={SECTORS} onChange={(sectors) => setF({ ...f, sectors })} />
          {field("Largest single asset (max %)", f.maxSingle, (maxSingle) => setF({ ...f, maxSingle }), { type: "number", min: 0, max: 100, step: "any" })}
        </Group>
        <Group title="Costs">
          {field("Highest minimum investment (USDC)", f.maxMinimum, (maxMinimum) => setF({ ...f, maxMinimum }), { inputMode: "decimal" })}
          <fieldset className="space-y-3">
            <legend className="mb-1 text-xs font-medium text-ink-muted">Fee ceilings (% of the minimum investment)</legend>
            {FEES.map((k) => field(`${k[0]!.toUpperCase()}${k.slice(1)} fee`, f.fees[k] ?? "", (v) => setF({ ...f, fees: { ...f.fees, [k]: v } }), { type: "number", min: 0, max: 100, step: "any" }))}
          </fieldset>
        </Group>
        <Group title="Strategy & managers">
          <fieldset className="space-y-0.5">
            <legend className="mb-1 text-xs font-medium text-ink-muted">Review frequency</legend>
            {Object.entries(REVIEW_FREQUENCY_LABEL).map(([k, l]) => checkbox(l, f.reviews.includes(k), () => setF({ ...f, reviews: toggle(f.reviews, k) })))}
          </fieldset>
          {field("Basket age (at least, days)", f.age, (age) => setF({ ...f, age }), { type: "number", min: 0, step: 1 })}
          {field("Tags (comma separated)", f.tags, (tags) => setF({ ...f, tags }), { spellCheck: false })}
          {field("Manager experience (at least, years)", f.experience, (experience) => setF({ ...f, experience }), { type: "number", min: 0, max: 60, step: 1 })}
          {field("Organization ID", f.organizationId, (organizationId) => setF({ ...f, organizationId }), { spellCheck: false })}
          {field("Manager handle", f.managerHandle, (managerHandle) => setF({ ...f, managerHandle }), { spellCheck: false })}
        </Group>
        <Group title="Simulated performance">
          {PERF.map(([k, l]) => field(l, f.perf[k] ?? "", (v) => setF({ ...f, perf: { ...f.perf, [k]: v } }), { type: "number", step: "any" }))}
        </Group>
        {invalid && <p role="alert" className="text-sm text-danger">Check the filters: use valid numbers within range.</p>}
        <div className="sticky bottom-0 flex flex-wrap gap-2 bg-canvas/90 py-4 backdrop-blur">
          <Button type="submit">Apply filters</Button>
          <Button type="button" variant="ghost" onClick={() => router.push("/baskets")}>Clear all</Button>
        </div>
      </form>
    </aside>
  );
}

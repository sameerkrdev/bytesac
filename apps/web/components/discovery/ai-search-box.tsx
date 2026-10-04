"use client";

import { ApiError, encodeDiscoveryFilters, type ApiClient } from "@repo/api-client";
import type { DiscoveryFilters } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Loader2, ScanSearch } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { FilterChips } from "./filter-chips";
import { ResultsList } from "./results-list";

const MODE_LABEL = { tool: "Matched by filters", semantic: "Closest in meaning", keyword: "Keyword match" } as const;
const MODE_HELP = {
  tool: "Your words were turned into the filters below. Remove any you don’t want, or edit them all.",
  semantic: "No exact filters fit, so these are the baskets closest in meaning to your words.",
  keyword: "These baskets mention your words.",
} as const;

const EXAMPLES = [
  "Diversified BTC, ETH and SOL with tokenized treasuries, no asset above 30%, monthly review",
  "Low-fee stablecoin baskets with a monthly review",
  "Solana ecosystem, minimum under 100 USDC",
];

/**
 * Natural-language research: the query is turned into structured, editable filters (or a semantic/keyword match).
 * It never shows generated advice or prose — only the criteria and the matching baskets.
 */
export function AiSearchBox({ client = api }: { client?: Pick<ApiClient, "aiSearchBaskets"> }) {
  const id = useId();
  const router = useRouter();
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const search = useMutation({ mutationFn: (q: string) => client.aiSearchBaskets(q) });
  const rateLimited = search.error instanceof ApiError && (search.error.status === 429 || search.error.code === "RATE_LIMITED");
  // Editing a chip leaves the AI result: the remaining filters become the structured search (URL `f`).
  const edit = (f: DiscoveryFilters) => { search.reset(); router.push(`/baskets?f=${encodeDiscoveryFilters(f)}`); };
  const submit = (q: string) => { if (q.trim()) search.mutate(q.trim()); };

  return (
    <section aria-labelledby={`${id}-h`} className="atmosphere relative overflow-hidden rounded-shell border border-line p-5 sm:p-8 md:p-10">
      <div className="max-w-3xl">
        <p className="type-eyebrow flex items-center gap-2 text-ink-muted"><ScanSearch aria-hidden className="size-3.5" />Research query</p>
        <h2 id={`${id}-h`} className="mt-3 type-title text-ink">Describe what you want</h2>
      </div>
      <form className="mt-6" onSubmit={(e) => { e.preventDefault(); submit(query); }}>
        <Label htmlFor={`${id}-q`} className="sr-only">Search in your own words</Label>
        <div className="glass flex flex-col gap-3 rounded-card p-2 shadow-soft sm:flex-row sm:items-end">
          <textarea id={`${id}-q`} value={query} maxLength={500} rows={2} placeholder="Low-fee stablecoin baskets with a monthly review"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(query); } }}
            className="min-h-14 flex-1 resize-none bg-transparent px-3 py-2.5 text-base text-ink outline-none placeholder:text-ink-faint md:text-lg" />
          <Button type="submit" size="lg" className="shrink-0" disabled={search.isPending || !query.trim()}>
            {search.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <ArrowRight aria-hidden />}Search
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => { setQuery(ex); submit(ex); }}
              className="max-w-full truncate rounded-pill border border-line bg-surface/70 px-3 py-1.5 text-left text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink">
              {ex}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs text-ink-faint">Queries are processed by Google Gemini.</p>
      </form>
      {search.isError && (rateLimited
        ? <p role="alert" className="mt-4 text-sm text-danger">Too many searches. Try again later.</p>
        : <p role="alert" className="mt-4 text-sm text-danger">{toDisplayError(search.error).title}</p>)}
      {search.data && (
        <motion.div className="mt-8 space-y-5 border-t border-ink/10 pt-6" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
          <div className="space-y-1">
            <p role="status" className="text-sm font-medium text-ink">{MODE_LABEL[search.data.mode]}</p>
            <p className="text-sm text-ink-muted">{MODE_HELP[search.data.mode]}</p>
          </div>
          {search.data.filters && <FilterChips filters={search.data.filters} onChange={edit} />}
          {search.data.filters && <Button type="button" variant="secondary" onClick={() => edit(search.data.filters!)}>Edit these filters</Button>}
          <ResultsList items={search.data.results} />
        </motion.div>
      )}
    </section>
  );
}

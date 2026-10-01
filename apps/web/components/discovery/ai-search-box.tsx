"use client";

import { ApiError, encodeDiscoveryFilters, type ApiClient } from "@repo/api-client";
import type { DiscoveryFilters } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { FilterChips } from "./filter-chips";
import { ResultsList } from "./results-list";

const MODE_LABEL = { tool: "Matched by filters", semantic: "Closest in meaning", keyword: "Keyword match" } as const;

export function AiSearchBox({ client = api }: { client?: Pick<ApiClient, "aiSearchBaskets"> }) {
  const id = useId();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const search = useMutation({ mutationFn: (q: string) => client.aiSearchBaskets(q) });
  const rateLimited = search.error instanceof ApiError && (search.error.status === 429 || search.error.code === "RATE_LIMITED");
  // Editing a chip leaves the AI result: the remaining filters become the structured search (URL `f`).
  const edit = (f: DiscoveryFilters) => { search.reset(); router.push(`/baskets?f=${encodeDiscoveryFilters(f)}`); };

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3 rounded-2xl border border-border-dark bg-slate p-4">
      <h2 id={`${id}-h`} className="flex items-center gap-2 font-display text-lg font-semibold text-ivory"><Sparkles aria-hidden className="size-4 text-mint" />Describe what you want</h2>
      <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(query.trim()); }}>
        <Label htmlFor={`${id}-q`} className="text-xs font-medium text-ivory">Search in your own words</Label>
        <Textarea id={`${id}-q`} value={query} maxLength={500} placeholder="Low-fee stablecoin baskets with a monthly review" onChange={(e) => setQuery(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" className="min-h-11" disabled={search.isPending || !query.trim()}>{search.isPending && <Loader2 aria-hidden className="animate-spin" />}Search</Button>
          <p className="text-xs text-stone">Queries are processed by Google Gemini.</p>
        </div>
      </form>
      {search.isError && (rateLimited
        ? <p role="alert" className="text-sm text-danger">Too many searches. Try again later.</p>
        : <p role="alert" className="text-sm text-danger">{toDisplayError(search.error).title}</p>)}
      {search.data && (
        <div className="space-y-4">
          <p role="status" className="text-sm font-medium text-ivory">{MODE_LABEL[search.data.mode]}</p>
          {search.data.filters && <FilterChips filters={search.data.filters} onChange={edit} />}
          <ResultsList items={search.data.results} />
        </div>
      )}
    </section>
  );
}

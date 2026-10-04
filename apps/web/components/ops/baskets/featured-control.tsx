"use client";

import type { ApiClient } from "@repo/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toDisplayError } from "@/lib/errors";

/**
 * Curates the public Featured rail (ADR-019): rank 1 shows first. Only active baskets can be featured; removing always
 * works. Audited server-side. Featuring is presentation, never a recommendation.
 */
export function FeaturedControl({ bid, rank, active, client }: { bid: string; rank: number | null; active: boolean; client: Pick<ApiClient, "opsSetBasketFeatured"> }) {
  const id = useId();
  const qc = useQueryClient();
  const [value, setValue] = useState(String(rank ?? 1));
  const set = useMutation({
    mutationFn: (r: number | null) => client.opsSetBasketFeatured(bid, { rank: r }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["ops", "basket", bid] }),
  });
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1 && n <= 99;
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-3 rounded-card border border-line bg-surface p-5">
      <h2 id={`${id}-h`} className="flex items-center gap-2 text-base font-medium text-ink"><Sparkles aria-hidden className="size-4 text-accent" />Featured rail</h2>
      <p className="text-sm text-ink-muted">{rank === null ? "Not featured." : `Featured at position ${rank}.`} Shown on Discover and the signed-in home, labelled as chosen by Bytesac and not advice.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <label htmlFor={`${id}-rank`} className="text-xs text-ink-muted">Position (1–99)</label>
          <Input id={`${id}-rank`} type="number" min={1} max={99} className="w-24" value={value} aria-invalid={!valid} onChange={(e) => setValue(e.target.value)} disabled={!active || set.isPending} />
        </div>
        <Button size="sm" disabled={!active || !valid || set.isPending} onClick={() => set.mutate(n)}>{rank === null ? "Feature" : "Update position"}</Button>
        {rank !== null && <Button size="sm" variant="ghost" disabled={set.isPending} onClick={() => set.mutate(null)}>Remove from rail</Button>}
      </div>
      {!active && rank === null && <p className="text-xs text-ink-faint">Only active baskets can be featured.</p>}
      {set.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(set.error).message}</p>}
    </section>
  );
}

"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

const NOUN = { invest: "investment", sell_to_usdc: "sale", sell_former: "sale", rebalance: "rebalance", repair: "buy-back" } as const;

/** The user's open operation that needs a decision, or undefined. One open operation blocks new plans, so every entry point says so. */
export function useOpenOperation(exceptId?: string, enabled = true) {
  const q = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio(), retry: false, staleTime: 30_000, enabled });
  return q.data?.openOperations.find((o) => o.id !== exceptId && (o.needsAction || o.status === "IN_PROGRESS"));
}

/** "Finish or stop your open investment", with Continue (the operation's page) and Stop. Renders nothing without an open operation. */
export function OpenOperationBanner({ exceptId }: { exceptId?: string }) {
  const qc = useQueryClient();
  const open = useOpenOperation(exceptId);
  const stop = useMutation({ mutationFn: (id: string) => api.cancelOperation(id), onSettled: () => qc.invalidateQueries({ queryKey: ["portfolio"] }) });
  if (!open) return null;
  return (
    <section aria-label="Open operation" className="space-y-3 rounded-tile border border-warning/25 bg-warning-soft p-4 text-sm">
      <p className="font-medium text-ink">Finish or stop your open {NOUN[open.kind]}</p>
      <p className="text-ink-muted">Only one operation can be open at a time. Continue where you left off, or stop it to start something new. Fees already paid are not refunded.</p>
      {stop.error && <p role="alert" className="text-danger">{toDisplayError(stop.error).title}</p>}
      <div className="flex flex-wrap gap-3">
        <Link href={`/portfolio#operation-${open.id}`} className={buttonVariants()}>Continue</Link>
        <Button variant="secondary" disabled={stop.isPending} onClick={() => stop.mutate(open.id)}>Stop</Button>
      </div>
    </section>
  );
}

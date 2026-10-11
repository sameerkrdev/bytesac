"use client";

import { ApiError } from "@repo/api-client";
import { legRoute, legTitle, LEG_IN_FLIGHT } from "@repo/app-core";
import { INVEST_AUTO_STOP_HOURS, SLIPPAGE_MAX_BPS, type Leg, type OperationView } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

const SLIPPAGE_STEPS = [50, 100, 200, SLIPPAGE_MAX_BPS];

/** Why a leg did not go through, in plain words. `lastError` is what the server stored when it released the leg unsent. */
function reason(l: Leg): string {
  const e = l.lastError;
  if (e === "QUOTE_STALE") return "Quote expired before sending — nothing spent";
  if (e === "STOPPED") return "Not sent because an earlier step stopped — nothing spent";
  if (e?.startsWith("PREFLIGHT_REFUSED")) return `Refused before sending — nothing spent${e.slice(17)}`;
  if (e?.startsWith("FEE_REFUSED")) return `The fee payment was refused, so nothing was sent${e.slice(11)}`;
  if (l.status === "FAILED") return l.failureReason ?? "This step failed";
  return "Not sent yet — nothing spent";
}

/**
 * A grouped investment that stopped part-way. It stays open until the user decides: Continue (new quotes for what is left), Raise slippage,
 * Skip an asset, Invest what's available (when the wallet is short on USDC), or Stop. The server owns every rule; this only sends the choice.
 */
export function NeedsAction({ op, busy, onContinued, onStopped }: { op: OperationView; busy?: boolean; onContinued(op: OperationView): void; onStopped(op: OperationView): void }) {
  const higher = SLIPPAGE_STEPS.filter((s) => s > op.slippageBps);
  const [bps, setBps] = useState(higher[0] ?? SLIPPAGE_MAX_BPS);
  const next = useMutation({
    mutationFn: (extra: { slippageBps?: number; skipLegIds?: string[]; scaleToAvailable?: boolean }) => api.continueOperation(op.id, { idempotencyKey: crypto.randomUUID(), ...extra }),
    onSuccess: onContinued,
  });
  const stop = useMutation({ mutationFn: () => api.cancelOperation(op.id), onSuccess: onStopped });
  const replaced = new Set(op.legs.map((l) => l.retryOf));
  const open = op.legs.filter((l) => l.kind !== "network_fee" && !l.recoveryOf && !replaced.has(l.id) && !l.recoveryToken && (l.status === "PLANNED" || (l.status === "FAILED" && l.failureReason !== "SKIPPED")));
  const waiting = busy || op.legs.some((l) => LEG_IN_FLIGHT.includes(l.status));
  const pending = next.isPending || stop.isPending;
  const error = next.error ?? stop.error;
  const short = next.error instanceof ApiError && next.error.code === "INSUFFICIENT_BALANCE";
  const until = op.needsActionSince ? new Date(new Date(op.needsActionSince).getTime() + INVEST_AUTO_STOP_HOURS * 3_600_000).toLocaleString() : null;

  return (
    <section aria-label="Needs your decision" className="space-y-4 rounded-tile border border-warning/25 bg-warning-soft p-4 text-sm">
      <p className="font-medium text-ink">Some steps didn&apos;t go through</p>
      <ul className="space-y-2">
        {open.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
            <span><span className="font-medium text-ink">{legTitle(l, true)}</span><span className="block text-ink-muted">{reason(l)}</span></span>
            <Button variant="secondary" size="sm" disabled={waiting || pending} onClick={() => next.mutate({ skipLegIds: [l.id] })}>Skip {legRoute(l).symbol ?? "this step"}</Button>
          </li>
        ))}
      </ul>
      {waiting && <p role="status" className="text-ink-muted">Waiting for the network to confirm. You can continue when it has.</p>}
      {error && <div role="alert"><p className="font-medium text-ink">{toDisplayError(error).title}</p><p className="text-ink-muted">{toDisplayError(error).message}</p></div>}
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={waiting || pending} onClick={() => next.mutate({})}>{next.isPending && <Loader2 aria-hidden className="animate-spin" />}Continue</Button>
        {short && <Button variant="secondary" disabled={waiting || pending} onClick={() => next.mutate({ scaleToAvailable: true })}>Invest what&apos;s available</Button>}
        <Button variant="secondary" disabled={waiting || pending} onClick={() => stop.mutate()}>{stop.isPending && <Loader2 aria-hidden className="animate-spin" />}Stop</Button>
      </div>
      {higher.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-ink-muted">Slippage <select value={bps} onChange={(e) => setBps(Number(e.target.value))} className="ml-1 h-9 rounded-tile border border-line bg-surface px-2 text-ink">{higher.map((s) => <option key={s} value={s}>{s / 100}%</option>)}</select></label>
          <Button variant="secondary" size="sm" disabled={waiting || pending} onClick={() => next.mutate({ slippageBps: bps })}>Raise slippage</Button>
        </div>
      )}
      <p className="text-xs text-ink-muted">Continue is free{until && ` until ${until}`}; stopping keeps fees already paid.</p>
    </section>
  );
}

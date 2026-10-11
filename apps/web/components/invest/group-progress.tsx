"use client";

import { useAppKit } from "@reown/appkit/react";
import { ApiError } from "@repo/api-client";
import {
  describeError, formatSol, groupSignerReducer, initialGroupSignerState, LEG_IN_FLIGHT, legAmounts, legRoute, legTitle, OPERATION_STATUS_LABEL, OUTCOME_UNKNOWN, runGroup, useCountdown,
  type GroupSignerEvent, type GroupSignerState,
} from "@repo/app-core";
import { SOL_BUFFER_LAMPORTS, type ErrorCode, type GroupResponse, type OperationView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { FeeLines } from "@/components/invest/fee-lines";
import { LegProgress, LegRow, toSigner } from "@/components/invest/leg-progress";
import { NeedsAction } from "@/components/invest/needs-action";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { useLegSigner } from "@/lib/wallet/use-leg-signer";

/** Invests planned by the website sign in groups; a plan from before groups existed, or one already partly signed leg by leg, keeps the per-leg flow. */
export const isGrouped = (o: OperationView) => o.kind === "invest" && o.approvalsEstimate !== null && (o.groups.length > 0 || o.legs.every((l) => l.status === "PLANNED"));

/** What the plan can say before any quote exists: nothing here expires. */
export function PlanEstimates({ plan }: { plan: OperationView }) {
  const n = plan.approvalsEstimate;
  const need = plan.solRequiredLamports === null ? null : BigInt(plan.solRequiredLamports);
  return (
    <div className="space-y-1 rounded-tile border border-line bg-surface p-4 text-sm">
      {n !== null && <p className="text-ink">About {n} wallet {n === 1 ? "approval" : "approvals"}</p>}
      {need !== null && <p className="text-ink">Network fees: about {formatSol(need > SOL_BUFFER_LAMPORTS ? need - SOL_BUFFER_LAMPORTS : 0n)} SOL, paid by you in SOL <span className="text-ink-muted">· keep about 0.001 SOL extra</span></p>}
      <p className="text-xs text-ink-muted">Fees are charged per batch; batches you never send aren&apos;t charged.</p>
    </div>
  );
}

/** The fresh figures of a quoted group with a countdown to `sendBy`. When a minimum moved against the plan, the wallet waits for an explicit tap. */
function PricesStrip({ group, op, onDecide }: { group: GroupResponse; op: OperationView; onDecide(accept: boolean): void }) {
  const left = useCountdown(group.sendBy);
  const expired = left === 0 && Date.parse(group.sendBy) <= Date.now();
  return (
    <div role="status" aria-label="Prices updated" className="space-y-2 rounded-tile border border-line p-3 text-sm">
      <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-ink">Prices updated</span><span className="text-xs text-ink-muted tabular-nums">{expired ? "Quotes expired" : `Send within ${left} s`}</span></p>
      <ul className="space-y-1 text-ink-muted">
        {group.legs.map((g) => {
          const leg = op.legs.find((l) => l.id === g.legId);
          if (!leg) return null;
          if (g.error) return <li key={g.legId}>{legTitle(leg, true)}: left out for now — {g.error.message}</li>;
          const a = legAmounts({ ...leg, minOut: g.minOut, routeSummary: { ...legRoute(leg), estimatedOut: g.estimatedOut ?? undefined } }, true);
          return <li key={g.legId}>{legTitle(leg, true)}: {a.in} → about {a.estimatedOut} (at least {a.minOut})</li>;
        })}
      </ul>
      {group.priceMoved && (
        <div className="space-y-2">
          <p className="text-warning">Some minimums are lower than in your plan. Check them before you sign.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={expired} onClick={() => onDecide(true)}>Accept new prices</Button>
            <Button variant="secondary" onClick={() => onDecide(false)}>Not now</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The failure of a group request as copy: API errors by code (with their details), wallet failures by their own words. */
function failureCopy(f: Extract<GroupSignerState, { kind: "failed" }>) {
  if (f.code === "WALLET_REJECTED") return describeError("WALLET_REJECTED");
  if (f.code === "WRONG_WALLET") return { title: "Wrong wallet", message: f.message };
  if (f.code === OUTCOME_UNKNOWN) return { title: "Confirming with the network", message: f.message };
  return toDisplayError(new ApiError(f.code as ErrorCode, 0, f.message, undefined, f.details));
}

/**
 * Signs and tracks a grouped investment: quotes a chunk, opens the wallet once (twice on MetaMask, which signs and sends; once per transaction when the wallet
 * cannot sign a batch), submits, and repeats until nothing is left to sign. The server prepares and checks everything; nothing here resends a submitted group.
 */
export function GroupProgress({ operationId, autoStart = false }: { operationId: string; autoStart?: boolean }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const wallet = useLegSigner(me);
  const { open } = useAppKit();
  const [state, dispatch] = useReducer(groupSignerReducer, initialGroupSignerState);
  const [tier, setTier] = useState<"sign_all" | "single">("sign_all");
  const [running, setRunning] = useState(false);
  const decision = useRef<((accept: boolean) => void) | null>(null);
  const started = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const op = useQuery({
    queryKey: ["operation", operationId], queryFn: () => api.getOperation(operationId),
    refetchInterval: (q) => (running || q.state.data?.legs.some((l) => LEG_IN_FLIGHT.includes(l.status)) ? 3000 : false),
  });
  const setOp = (o: OperationView) => { qc.setQueryData(["operation", operationId], o); void qc.invalidateQueries({ queryKey: ["portfolio"] }); };
  const stop = useMutation({ mutationFn: () => api.cancelOperation(operationId), onSuccess: setOp });

  /**
   * Groups until nothing is left to sign or something this drive sent failed (the server then waits for Continue or Stop). The server refuses the next group
   * while the previous fee is not confirmed on chain; that request is repeated for up to a minute ("Confirming fee…"), never any submission.
   */
  const drive = async () => {
    setRunning(true);
    let now = tier === "single" ? tier : await wallet.chooseTier();
    const leftOut = new Set<string>();
    const signed = new Set<string>();
    const track = (e: GroupSignerEvent) => {
      dispatch(e);
      if (e.type !== "quoted") return;
      e.group.legs.filter((l) => l.error).forEach((l) => leftOut.add(l.legId));
      e.group.transactions.filter((t) => t.kind === "asset").forEach((t) => signed.add(t.legId));
    };
    try {
      for (;;) {
        const o = await runGroup(api, toSigner(wallet), operationId, track, {
          tier: now, walletName: wallet.walletName,
          acceptNewPrices: () => new Promise<boolean>((resolve) => { decision.current = resolve; }),
          onDowngrade: () => { now = "single"; setTier("single"); },
        });
        if (!o) {
          // A failed group returns no view, and after OUTCOME_UNKNOWN the server still holds the claim (legs SUBMITTING): the fresh view shows them in flight, so
          // the page waits instead of offering "Try again".
          void qc.invalidateQueries({ queryKey: ["operation", operationId] });
          return;
        }
        setOp(o);
        const broke = o.legs.some((l) => signed.has(l.id) && (l.status === "FAILED" || (l.status === "PLANNED" && !!l.lastError)));
        const more = o.legs.some((l) => l.kind !== "network_fee" && !l.recoveryOf && l.status === "PLANNED" && !leftOut.has(l.id));
        if (!alive.current || o.status !== "IN_PROGRESS" || o.legs.some((l) => l.kind === "network_fee" && l.status === "UNKNOWN") || broke || !more) return;
      }
    } finally {
      setRunning(false);
    }
  };
  useEffect(() => {
    if (autoStart && !started.current) { started.current = true; void drive(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const status = op.data?.status;
  useEffect(() => { if (status && status !== "PLANNED" && status !== "IN_PROGRESS") void qc.invalidateQueries({ queryKey: ["portfolio"] }); }, [status, qc]);

  if (op.isPending) return <p role="status" className="text-sm text-ink-muted"><Loader2 aria-hidden className="mr-2 inline size-4 animate-spin" />Loading…</p>;
  if (!op.data) return <p role="alert" className="text-sm text-danger">{toDisplayError(op.error).title}</p>;
  const o = op.data;
  const assets = o.legs.filter((l) => l.kind !== "network_fee");
  const sent = assets.filter((l) => [...LEG_IN_FLIGHT, "UNKNOWN", "SETTLED"].includes(l.status)).length;
  const confirmed = assets.filter((l) => l.status === "SETTLED").length;
  const inFlight = o.legs.some((l) => LEG_IN_FLIGHT.includes(l.status));
  const live = o.status === "PLANNED" || o.status === "IN_PROGRESS";
  const left = assets.some((l) => l.status === "PLANNED" && !l.recoveryOf);
  const recovery = o.legs.find((l) => l.recoveryOf && l.status === "PLANNED");
  const failure = state.kind === "failed" ? failureCopy(state) : null;
  const busy = running || state.kind === "quoting" || state.kind === "feeConfirming" || state.kind === "sending";

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-ink">Status <StatusBadge {...OPERATION_STATUS_LABEL[o.status]} /></p>
      {sent > 0 && <p role="status" className="text-sm text-ink-muted tabular-nums">{inFlight || running ? "Sending" : "Sent"} {sent} of {assets.length} · confirmed {confirmed}</p>}
      <ol className="space-y-3">{o.legs.map((l) => <LegRow key={l.id} leg={l} buying />)}</ol>

      {(state.kind === "priceMoved" || state.kind === "signing" || state.kind === "sending") && <PricesStrip group={state.group} op={o} onDecide={(accept) => decision.current?.(accept)} />}
      {state.kind === "quoting" && <p role="status" className="text-sm text-ink-muted"><Loader2 aria-hidden className="mr-2 inline size-4 animate-spin" />Getting fresh prices…</p>}
      {state.kind === "feeConfirming" && <p role="status" className="text-sm text-ink-muted"><Loader2 aria-hidden className="mr-2 inline size-4 animate-spin" />Confirming fee…</p>}
      {state.kind === "signing" && <p role="status" className="text-sm text-ink">Approve in your wallet{tier === "single" && ". Your wallet signs one transaction at a time, so you will be asked several times"}.</p>}
      {state.kind === "sending" && <p role="status" className="text-sm text-ink-muted"><Loader2 aria-hidden className="mr-2 inline size-4 animate-spin" />Sending…</p>}

      {failure && (
        <div role="alert" className="space-y-2 rounded-tile border border-danger/25 p-3 text-sm text-ink">
          <p className="font-medium">{failure.title}</p>
          <p className="text-ink-muted">{failure.message}</p>
          {state.kind === "failed" && state.code === "WRONG_WALLET" && <Button variant="secondary" onClick={() => void open({ view: "Connect" })}>Connect wallet</Button>}
        </div>
      )}
      {stop.error && <div role="alert" className="rounded-tile border border-danger/25 p-3 text-sm text-ink"><p className="font-medium">{toDisplayError(stop.error).title}</p><p className="text-ink-muted">{toDisplayError(stop.error).message}</p></div>}

      {live && inFlight && !busy && <p role="status" className="text-sm text-ink-muted">Waiting for the network to confirm. This page updates by itself.</p>}
      {live && o.needsAction && !running && <NeedsAction op={o} busy={busy} onContinued={(next) => { setOp(next); void drive(); }} onStopped={setOp} />}
      {live && recovery && !busy && !inFlight && <LegProgress operationId={o.id} legId={recovery.id} />}
      {live && !o.needsAction && !busy && !inFlight && (
        <div className="flex flex-wrap gap-3">
          {left && <Button onClick={() => void drive()}>{state.kind === "failed" ? (state.code === "GROUP_EXPIRED" ? "Get new quotes" : "Try again") : "Confirm and sign"}</Button>}
          <Button variant="secondary" disabled={stop.isPending} onClick={() => stop.mutate()}>{o.status === "PLANNED" ? "Cancel" : "Stop"}</Button>
        </div>
      )}

      {o.status === "COMPLETED" && <p role="status" className="text-sm text-ink">All steps are settled. Your basket is in your wallet and shown in your portfolio.</p>}
      {(o.status === "PARTIAL" || o.status === "FAILED") && <p role="status" className="text-sm text-ink">{o.status === "PARTIAL" ? "Some steps settled and the rest were stopped. What you received is in your wallet; unspent USDC stays there too." : "Nothing was bought. Your USDC is still in your wallet."}{o.charged.length > 0 && " Fees already paid are not refunded."}</p>}
      {o.status === "CANCELLED" && <p role="status" className="text-sm text-ink">Cancelled. Nothing was submitted.</p>}
      <FeeLines fees={o.fees} />
    </div>
  );
}

"use client";

import { useAppKit, useAppKitState } from "@reown/appkit/react";
import { ApiError } from "@repo/api-client";
import {
  explorerTxUrl, formatUnits, GasDropError, initialLegSignerState, LEG_ACTIVE as ACTIVE, LEG_IN_FLIGHT as IN_FLIGHT, LEG_STATUS_LABEL, LEG_STEP_LABEL, legAmounts, legRoute, legSignerReducer, legTitle, nextLeg, OPERATION_STATUS_LABEL, prepareLeg, PRICE_IMPACT_WARNING, signLeg, type Prepared, type Signer, WrongWalletError,
} from "@repo/app-core";
import { ASSET_CHAINS, type Leg, type OperationView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { FeeLines } from "@/components/invest/fee-lines";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { useLegSigner } from "@/lib/wallet/use-leg-signer";

/** Adapts the web wallet hooks to the shared `Signer` (the hooks keep their own call shapes). */
const toSigner = (w: ReturnType<typeof useLegSigner>): Signer => ({
  signSolana: (b64) => w.signSolana(b64),
  sendEvm: ({ approval, ...tx }) => w.sendEvm(tx, approval ?? null),
  signPsbt: (psbt, inputCount) => w.signBitcoin(psbt, inputCount),
});

/** One leg: what it does, amounts, status and explorer links. */
export function LegRow({ leg: l, buying, showStatus = true }: { leg: Leg; buying: boolean; showStatus?: boolean }) {
  const a = legAmounts(l, buying);
  const btc = l.fromChain === "bitcoin" || l.toChain === "bitcoin";
  const fees = l.routeFees.filter((f) => f.included).reduce((s, f) => s + f.amountUsd, 0);
  const t = l.recoveryToken;
  const refunded = l.providerSubstatus === "REFUNDED";
  const refunding = l.providerSubstatus === "NOT_PROCESSABLE_REFUND_NEEDED" || l.providerSubstatus === "REFUND_IN_PROGRESS";
  return (
    <li className="space-y-1 rounded-tile border border-line p-3 text-sm">
      <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-ink">{l.sequence}. {l.recoveryOf ? "Complete swap" : legTitle(l, buying)}</span>{showStatus && <StatusBadge {...LEG_STATUS_LABEL[l.status]} />}</p>
      <p className="text-ink-muted">{l.recoveryOf && "Swap what arrived: "}{a.in}{a.estimatedOut && ` → about ${a.estimatedOut}`}{a.minOut && ` (at least ${a.minOut})`}</p>
      {l.recoveryOf && l.status === "PLANNED" && <p className="text-xs text-ink-muted">You sign a fresh quote first; the figures above are an estimate.</p>}
      {l.status === "PLANNED" && fees > 0 && <p className="text-xs text-ink-muted">Route fees (LI.FI, DEX, bridge): ${fees.toFixed(2)} — included in the estimate</p>}
      {l.status === "PLANNED" && l.priceImpact !== null && <p className={`text-xs ${l.priceImpact >= PRICE_IMPACT_WARNING ? "text-warning" : "text-ink-muted"}`}>Price impact {(l.priceImpact * 100).toFixed(2)}%{l.priceImpact >= PRICE_IMPACT_WARNING && " — higher than usual"}</p>}
      {l.feeOnTransfer && l.status === "PLANNED" && <p className="text-xs text-warning">This token charges a transfer tax; amounts are estimates.</p>}
      {refunding && <p className="text-xs text-warning">Refund in progress (the route couldn&apos;t complete).</p>}
      {l.status === "FAILED" && refunded && <p className="text-xs text-ink">Funds returned to your wallet.</p>}
      {t && <p className="text-xs text-ink">Arrived as {formatUnits(t.amount, t.decimals)} {t.symbol} on {ASSET_CHAINS[t.chain].label}. Complete the swap below, or stop here and keep it in your wallet.</p>}
      {btc && l.status !== "SETTLED" && <p className="text-xs text-ink-muted">Bitcoin needs 2 confirmations, about 20 minutes.</p>}
      {l.status === "UNKNOWN" && <p className="text-xs text-warning">We are checking this with the chain. Do not sign it again. You can stop here; the check continues and the result is added to your portfolio.</p>}
      {l.failureReason && !t && <p className="text-xs text-danger">{l.failureReason}</p>}
      <p className="flex flex-wrap gap-3 text-xs">
        {l.sourceTx && <a className="inline-flex items-center gap-1 text-ink underline underline-offset-4" href={explorerTxUrl(l.fromChain, l.sourceTx)} target="_blank" rel="noreferrer">Source transaction<ExternalLink aria-hidden className="size-3" /></a>}
        {l.destinationTx && <a className="inline-flex items-center gap-1 text-ink underline underline-offset-4" href={explorerTxUrl(l.toChain, l.destinationTx)} target="_blank" rel="noreferrer">Destination transaction<ExternalLink aria-hidden className="size-3" /></a>}
      </p>
    </li>
  );
}

/** Signs and tracks every leg of one operation, one leg at a time. The server prepares each transaction and checks what comes back; nothing here retries a submitted leg. */
export function LegProgress({ operationId }: { operationId: string }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const signer = useLegSigner(me);
  const { open } = useAppKit();
  const modal = useAppKitState().open;
  const [state, dispatch] = useReducer(legSignerReducer, initialLegSignerState);
  const step = LEG_STEP_LABEL[state.kind] ?? "";
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const op = useQuery({
    queryKey: ["operation", operationId], queryFn: () => api.getOperation(operationId),
    refetchInterval: (q) => (q.state.data && !ACTIVE.includes(q.state.data.status) ? false : 4000),
  });
  const setOp = (o: OperationView) => { qc.setQueryData(["operation", operationId], o); void qc.invalidateQueries({ queryKey: ["portfolio"] }); };

  // Step 1: a fresh quote (and, on EVM, the confirmed gas top-up). The wallet is not opened until the user has seen the fresh figures.
  const prepare = useMutation({ mutationFn: (leg: Leg) => prepareLeg(api, operationId, leg, dispatch), onSuccess: setPrepared });
  // Step 2: the user approves the fresh figures; the wallet signs and the server verifies and submits.
  const sign = useMutation({
    mutationFn: (p: Prepared) => { lastSigned.current = p; return signLeg(api, toSigner(signer), operationId, p, dispatch, `/portfolio#operation-${operationId}`); },
    onSuccess: (o) => { if (o) setOp(o); },
    onSettled: () => setPrepared(null),
  });
  // After "Connect wallet": once the set of connected wallets changes, start the step again from a fresh quote (the user still approves the figures). One shot: it is
  // dropped when the modal closes without a change and on unmount, and is never armed after a rejection (a different error).
  const armed = useRef<{ leg: Leg; key: string; opened: boolean } | null>(null);
  const lastSigned = useRef<Prepared | null>(null);
  const connectionKey = signer.connectionKey;
  useEffect(() => {
    const a = armed.current;
    if (!a) return;
    if (modal) a.opened = true;
    if (a.key !== connectionKey) { armed.current = null; prepare.mutate(a.leg); } else if (a.opened && !modal) armed.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionKey, modal]);
  useEffect(() => () => { armed.current = null; }, []);
  const stop = useMutation({ mutationFn: () => api.cancelOperation(operationId), onSuccess: setOp });

  if (op.isPending) return <p role="status" className="text-sm text-ink-muted"><Loader2 aria-hidden className="mr-2 inline size-4 animate-spin" />Loading…</p>;
  if (!op.data) return <p role="alert" className="text-sm text-danger">{toDisplayError(op.error).title}</p>;
  const o = op.data;
  const buying = o.kind === "invest";
  const next = nextLeg(o.legs);
  const inFlight = o.legs.some((l) => IN_FLIGHT.includes(l.status));
  const expired = sign.error instanceof ApiError && sign.error.code === "QUOTE_EXPIRED";
  const failure = prepare.error ?? sign.error ?? stop.error;
  const busy = prepare.isPending || sign.isPending;
  const fresh = prepared && prepared.leg.id === next?.id ? prepared : null;
  const freshAmounts = fresh && fresh.q.estimatedOut ? legAmounts({ ...fresh.leg, minOut: fresh.q.minOut, routeSummary: { ...legRoute(fresh.leg), estimatedOut: fresh.q.estimatedOut } }, buying) : null;
  const err = failure ? (failure instanceof GasDropError ? { title: failure.message, message: undefined } : toDisplayError(failure)) : null;
  const done = o.legs.some((l) => l.kind !== "network_fee" && l.status === "SETTLED");
  const unknown = o.legs.some((l) => l.status === "UNKNOWN");
  const feePaid = o.legs.some((l) => l.kind === "network_fee" && l.status === "SETTLED");
  const remaining = o.legs.filter((l) => l.status === "PLANNED");

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm text-ink">Status <StatusBadge {...OPERATION_STATUS_LABEL[o.status]} /></p>
      <ol className="space-y-3">
        {o.legs.map((l) => <LegRow key={l.id} leg={l} buying={buying} />)}
      </ol>

      {err && <div role="alert" className="rounded-tile border border-danger/25 p-3 text-sm text-ink"><p className="font-medium">{expired ? "Quote expired" : err.title}</p><p className="text-ink-muted">{expired ? "Get a new quote, then sign again. Nothing was submitted." : err.message}</p></div>}
      {sign.error instanceof WrongWalletError && !busy && (
        <Button variant="secondary" onClick={() => { if (!lastSigned.current) return; armed.current = { leg: lastSigned.current.leg, key: connectionKey, opened: false }; void open({ view: "Connect" }); }}>Connect wallet</Button>
      )}
      {busy && <p role="status" className="text-sm text-ink-muted"><Loader2 aria-hidden className="mr-2 inline size-4 animate-spin" />{step}…</p>}
      {fresh && !busy && (
        <div role="status" className="space-y-1 rounded-tile border border-line p-3 text-sm">
          <p className="font-medium text-ink">Fresh quote for step {fresh.leg.sequence}</p>
          {freshAmounts ? <p className="text-ink-muted">{freshAmounts.in} → about {freshAmounts.estimatedOut} (at least {freshAmounts.minOut})</p> : <p className="text-ink-muted">Fee transfer of {formatUnits(fresh.leg.amountIn, 6)} USDC (all fees together).</p>}
          <p className="text-xs text-ink-muted">The quote is valid for about a minute. {fresh.leg.recoveryOf ? "You sign this quote: the amounts above are what you get, at least." : "If the price moves against you the server refuses it and nothing is sent."}</p>
        </div>
      )}
      {ACTIVE.includes(o.status) && inFlight && !busy && <p role="status" className="text-sm text-ink-muted">Waiting for the network to confirm. This page updates by itself.</p>}

      {ACTIVE.includes(o.status) && (
        <div className="flex flex-wrap gap-3">
          {next && !busy && !fresh && <Button  onClick={() => prepare.mutate(next)}>{expired ? "Get a new quote" : next.recoveryOf ? "Complete swap" : `Review step ${next.sequence}`}</Button>}
          {fresh && !busy && <Button  onClick={() => sign.mutate(fresh)}>Approve step {fresh.leg.sequence} in your wallet</Button>}
          {!inFlight && !busy && <Button variant="secondary"  disabled={stop.isPending} onClick={() => stop.mutate()}>{done || unknown || o.legs.some((l) => l.recoveryToken) ? "Stop here" : "Cancel"}</Button>}
        </div>
      )}

      {o.status === "COMPLETED" && <p role="status" className="text-sm text-ink">All steps are settled.{o.kind === "invest" && " Your basket is in your wallet and shown in your portfolio."}</p>}
      {(o.status === "PARTIAL" || o.status === "FAILED") && (
        <p role="status" className="text-sm text-ink">
          {o.status === "PARTIAL" ? "Some steps settled and some did not run. What you received is in your wallet." : "No assets were bought or sold."}
          {unknown && " A step is still being checked with the chain; its result is added to your portfolio when it settles."}
          {feePaid && " The fees were already paid and are not refunded."}
          {remaining.length > 0 && ` Not run: ${remaining.map((l) => legTitle(l, buying)).join(", ")}.`} Start a new plan to continue. Unspent USDC stays in your wallet.
        </p>
      )}
      {o.status === "CANCELLED" && <p role="status" className="text-sm text-ink">Cancelled. Nothing was submitted.</p>}
      <FeeLines fees={o.fees} />
    </div>
  );
}

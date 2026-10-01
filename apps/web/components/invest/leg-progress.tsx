"use client";

import { ApiError } from "@repo/api-client";
import { explorerTxUrl, formatUnits, legAmounts, legRoute, legTitle, LEG_STATUS_LABEL, OPERATION_STATUS_LABEL } from "@repo/app-core";
import type { Leg, LegQuoteResponse, OperationView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { useLegSigner } from "@/lib/wallet/use-leg-signer";

class GasDropError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ACTIVE = ["PLANNED", "IN_PROGRESS"];
/** Legs being sent or confirmed: the operation cannot be stopped while one of these is open. An UNKNOWN leg does not block stopping; it keeps being checked. */
const IN_FLIGHT = ["SUBMITTING", "SUBMITTED", "PENDING_CHAIN"];
type Prepared = { leg: Leg; q: LegQuoteResponse & { transaction: NonNullable<LegQuoteResponse["transaction"]> } };

/** The leg the user signs next: the first planned one whose predecessors settled (a network fee that is already on chain does not hold up the first asset leg). */
const nextLeg = (legs: Leg[]) => legs.find((l, i) => l.status === "PLANNED" && legs.slice(0, i).every((p) => p.status === "SETTLED" || (p.kind === "network_fee" && p.status === "PENDING_CHAIN")));

/** One leg: what it does, amounts, status and explorer links. */
export function LegRow({ leg: l, buying }: { leg: Leg; buying: boolean }) {
  const a = legAmounts(l, buying);
  const btc = l.fromChain === "bitcoin" || l.toChain === "bitcoin";
  return (
    <li className="space-y-1 rounded-xl border border-border-dark p-3 text-sm">
      <p className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-ivory">{l.sequence}. {legTitle(l, buying)}</span><StatusBadge {...LEG_STATUS_LABEL[l.status]} /></p>
      <p className="text-stone">{a.in}{a.estimatedOut && ` → about ${a.estimatedOut}`}{a.minOut && ` (at least ${a.minOut})`}</p>
      {btc && l.status !== "SETTLED" && <p className="text-xs text-stone">Bitcoin needs 2 confirmations, about 20 minutes.</p>}
      {l.status === "UNKNOWN" && <p className="text-xs text-warning">We are checking this with the chain. Do not sign it again. You can stop here; the check continues and the result is added to your portfolio.</p>}
      {l.failureReason && <p className="text-xs text-danger">{l.failureReason}</p>}
      <p className="flex flex-wrap gap-3 text-xs">
        {l.sourceTx && <a className="inline-flex items-center gap-1 text-mint underline" href={explorerTxUrl(l.fromChain, l.sourceTx)} target="_blank" rel="noreferrer">Source transaction<ExternalLink aria-hidden className="size-3" /></a>}
        {l.destinationTx && <a className="inline-flex items-center gap-1 text-mint underline" href={explorerTxUrl(l.toChain, l.destinationTx)} target="_blank" rel="noreferrer">Destination transaction<ExternalLink aria-hidden className="size-3" /></a>}
      </p>
    </li>
  );
}

/** Signs and tracks every leg of one operation, one leg at a time. The server prepares each transaction and checks what comes back; nothing here retries a submitted leg. */
export function LegProgress({ operationId }: { operationId: string }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const signer = useLegSigner(me);
  const [step, setStep] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const op = useQuery({
    queryKey: ["operation", operationId], queryFn: () => api.getOperation(operationId),
    refetchInterval: (q) => (q.state.data && !ACTIVE.includes(q.state.data.status) ? false : 4000),
  });
  const setOp = (o: OperationView) => { qc.setQueryData(["operation", operationId], o); void qc.invalidateQueries({ queryKey: ["portfolio"] }); };

  // Step 1: a fresh quote (and, on EVM, the confirmed gas top-up). The wallet is not opened until the user has seen the fresh figures.
  const prepare = useMutation({
    mutationFn: async (leg: Leg): Promise<Prepared> => {
      setStep("Getting a quote");
      let q = await api.quoteLeg(operationId, leg.id);
      // EVM legs: the platform's gas top-up must be confirmed before anything is signed.
      for (let n = 0; !q.transaction && q.gasDrop?.status === "pending" && n < 40; n++) {
        setStep("Waiting for the gas top-up to confirm");
        await sleep(3000);
        q = await api.quoteLeg(operationId, leg.id);
      }
      if (!q.transaction) throw new GasDropError("The gas top-up did not confirm. Nothing was signed. Try again in a moment.");
      return { leg, q: { ...q, transaction: q.transaction } };
    },
    onSuccess: setPrepared,
    onSettled: () => setStep(""),
  });
  // Step 2: the user approves the fresh figures; the wallet signs and the server verifies and submits.
  const sign = useMutation({
    mutationFn: async ({ leg, q }: Prepared) => {
      setStep("Approve in your wallet");
      const body = q.transaction.kind === "solana" ? { signedTx: await signer.signSolana(q.transaction.serializedBase64) }
        : q.transaction.kind === "evm" ? { txHash: await signer.sendEvm(q.transaction, q.approval) }
          : { signedPsbt: await signer.signBitcoin(q.transaction.psbtBase64, q.transaction.inputCount) };
      setStep("Submitting");
      return api.submitLeg(operationId, leg.id, body);
    },
    onSuccess: setOp,
    onSettled: () => { setStep(""); setPrepared(null); },
  });
  const stop = useMutation({ mutationFn: () => api.cancelOperation(operationId), onSuccess: setOp });

  if (op.isPending) return <p role="status" className="text-sm text-stone"><Loader2 aria-hidden className="mr-2 inline size-4 animate-spin" />Loading…</p>;
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
      <p className="flex items-center gap-2 text-sm text-ivory">Status <StatusBadge {...OPERATION_STATUS_LABEL[o.status]} /></p>
      <ol className="space-y-3">
        {o.legs.map((l) => <LegRow key={l.id} leg={l} buying={buying} />)}
      </ol>

      {err && <div role="alert" className="rounded-xl border border-danger/40 p-3 text-sm text-ivory"><p className="font-medium">{expired ? "Quote expired" : err.title}</p><p className="text-stone">{expired ? "Get a new quote, then sign again. Nothing was submitted." : err.message}</p></div>}
      {busy && <p role="status" className="text-sm text-stone"><Loader2 aria-hidden className="mr-2 inline size-4 animate-spin" />{step}…</p>}
      {fresh && !busy && (
        <div role="status" className="space-y-1 rounded-xl border border-border-dark p-3 text-sm">
          <p className="font-medium text-ivory">Fresh quote for step {fresh.leg.sequence}</p>
          {freshAmounts ? <p className="text-stone">{freshAmounts.in} → about {freshAmounts.estimatedOut} (at least {freshAmounts.minOut})</p> : <p className="text-stone">Network fee transfer of {formatUnits(fresh.leg.amountIn, 6)} USDC.</p>}
          <p className="text-xs text-stone">The quote is valid for about a minute. If the price moves against you the server refuses it and nothing is sent.</p>
        </div>
      )}
      {ACTIVE.includes(o.status) && inFlight && !busy && <p role="status" className="text-sm text-stone">Waiting for the network to confirm. This page updates by itself.</p>}

      {ACTIVE.includes(o.status) && (
        <div className="flex flex-wrap gap-3">
          {next && !busy && !fresh && <Button className="min-h-11" onClick={() => prepare.mutate(next)}>{expired ? "Get a new quote" : `Review step ${next.sequence}`}</Button>}
          {fresh && !busy && <Button className="min-h-11" onClick={() => sign.mutate(fresh)}>Approve step {fresh.leg.sequence} in your wallet</Button>}
          {!inFlight && !busy && <Button variant="secondary" className="min-h-11" disabled={stop.isPending} onClick={() => stop.mutate()}>{done || unknown ? "Stop here" : "Cancel"}</Button>}
        </div>
      )}

      {o.status === "COMPLETED" && <p role="status" className="text-sm text-ivory">All steps are settled.{o.kind === "invest" && " Your basket is in your wallet and shown in your portfolio."}</p>}
      {(o.status === "PARTIAL" || o.status === "FAILED") && (
        <p role="status" className="text-sm text-ivory">
          {o.status === "PARTIAL" ? "Some steps settled and some did not run. What you received is in your wallet." : "No assets were bought or sold."}
          {unknown && " A step is still being checked with the chain; its result is added to your portfolio when it settles."}
          {feePaid && " The network fee was already paid and is not refunded."}
          {remaining.length > 0 && ` Not run: ${remaining.map((l) => legTitle(l, buying)).join(", ")}.`} Start a new plan to continue. Unspent USDC stays in your wallet.
        </p>
      )}
      {o.status === "CANCELLED" && <p role="status" className="text-sm text-ivory">Cancelled. Nothing was submitted.</p>}
      <p className="text-xs text-stone">Network fee: {formatUnits(o.networkFeeUsdc, 6)} USDC, paid to Bytesac for gas.</p>
    </div>
  );
}

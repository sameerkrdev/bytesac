"use client";

import { SLIPPAGE_DEFAULT_BPS, type OperationView, type Portfolio } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { DeclarationForm, isDeclarationRequired } from "@/components/eligibility/declaration-form";
import { FeeLines } from "@/components/invest/fee-lines";
import { LegProgress, LegRow } from "@/components/invest/leg-progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

type Position = Portfolio["positions"][number];

export const ErrorBox = ({ error }: { error: unknown }) => {
  const e = toDisplayError(error);
  return <div role="alert" className="rounded-xl border border-danger/40 p-3 text-sm text-ivory"><p className="font-medium">{e.title}</p><p className="text-stone">{e.message}</p></div>;
};

/** Closes the position without any transaction: the assets stay in the user's wallets, outside the basket. */
export function LeaveDialog({ position }: { position: Position }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const leave = useMutation({ mutationFn: () => api.leavePosition(position.id), onSuccess: () => { setOpen(false); void qc.invalidateQueries({ queryKey: ["portfolio"] }); } });
  return (
    <>
      <Button variant="secondary" className="min-h-11" onClick={() => setOpen(true)}>Leave basket (keep assets)</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border-dark bg-space">
          <DialogHeader>
            <DialogTitle className="text-ivory">Leave this basket?</DialogTitle>
            <DialogDescription>Your assets stay in your wallets. No transaction is made and nothing is sold. Bytesac stops tracking this basket for you, so it will not be rebalanced or updated. You can sell the former assets to USDC later from your portfolio.</DialogDescription>
          </DialogHeader>
          {leave.error && <ErrorBox error={leave.error} />}
          <DialogFooter>
            <Button variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="min-h-11" disabled={leave.isPending} onClick={() => leave.mutate()}>{leave.isPending && <Loader2 aria-hidden className="animate-spin" />}Leave basket</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Dust only (the API refuses a position worth $1 or more): closes the position without a transaction. */
export function CloseDialog({ position }: { position: Position }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const close = useMutation({ mutationFn: () => api.closePosition(position.id), onSuccess: () => { setOpen(false); void qc.invalidateQueries({ queryKey: ["portfolio"] }); } });
  return (
    <>
      <Button variant="secondary" className="min-h-11" onClick={() => setOpen(true)}>Close position</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border-dark bg-space">
          <DialogHeader>
            <DialogTitle className="text-ivory">Close this position?</DialogTitle>
            <DialogDescription>Remaining tokens stay in your wallet outside this basket.</DialogDescription>
          </DialogHeader>
          {close.error && <ErrorBox error={close.error} />}
          <DialogFooter>
            <Button variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="min-h-11" disabled={close.isPending} onClick={() => close.mutate()}>{close.isPending && <Loader2 aria-hidden className="animate-spin" />}Close position</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Sell part or all of a position back to USDC ("Sell to USDC" for an open one, "Sell former assets" for a closed one). The network fee comes out of the proceeds. */
export function SellDialog({ position }: { position: Position }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState(100);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [plan, setPlan] = useState<OperationView | null>(null);
  const [signing, setSigning] = useState(false);
  const label = position.status === "OPEN" ? "Sell to USDC" : "Sell former assets";
  const preview = useMutation({ mutationFn: () => api.sellPlan({ positionId: position.id, percent, slippageBps: SLIPPAGE_DEFAULT_BPS, idempotencyKey: key }), onSuccess: setPlan });
  const discard = useMutation({ mutationFn: (opId: string) => api.cancelOperation(opId), onSettled: () => setPlan(null) });
  const err = preview.error ?? discard.error;
  const valid = Number.isInteger(percent) && percent >= 1 && percent <= 100;

  return (
    <>
      <Button className="min-h-11" onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-border-dark bg-space sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-ivory">{label}</DialogTitle>
            <DialogDescription>Each asset is sold back to USDC on Solana in your own wallets. You sign every step. Never more than your wallet holds is sold.</DialogDescription>
          </DialogHeader>
          {signing && plan ? <LegProgress operationId={plan.id} /> : plan ? (
            <div className="space-y-4">
              {plan.excluded && plan.excluded.length > 0 && (
                <ul aria-label="Left out of this sale" className="space-y-1 rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm text-ivory">{plan.excluded.map((x) => <li key={x.instrumentId}>{x.notice}</li>)}</ul>
              )}
              <ol className="space-y-3">{plan.legs.map((l) => <LegRow key={l.id} leg={l} buying={false} />)}</ol>
              <FeeLines fees={plan.fees} />
              <p className="text-xs text-stone">{plan.legs[0]?.kind === "network_fee" ? "Fees are paid first from the USDC already in your wallet." : "Fees are taken from your proceeds."}</p>
              <p className="text-sm text-stone">Outputs are estimates, protected by a minimum per step ({SLIPPAGE_DEFAULT_BPS / 100}% slippage). Prices are re-quoted when you sign each step.</p>
              <div className="flex flex-wrap gap-3">
                <Button className="min-h-11" onClick={() => setSigning(true)}>Continue to signing</Button>
                <Button variant="secondary" className="min-h-11" disabled={discard.isPending} onClick={() => discard.mutate(plan.id)}>Back</Button>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); preview.mutate(); }}>
              <Label htmlFor={id} className="text-xs font-medium text-ivory">Share of this position to sell: {valid ? percent : "?"}%</Label>
              <input id={id} type="range" min={1} max={100} value={valid ? percent : 100} className="w-full accent-mint" onChange={(e) => { setPercent(Number(e.target.value)); setKey(crypto.randomUUID()); }} />
              <Input aria-label="Percent to sell" inputMode="numeric" className="min-h-11 w-28" value={Number.isNaN(percent) ? "" : percent} aria-invalid={!valid}
                onChange={(e) => { setPercent(e.target.value === "" ? NaN : Number(e.target.value)); setKey(crypto.randomUUID()); }} />
              <p className="text-xs text-stone">{valid ? "Whole numbers from 1 to 100." : "Enter a whole number from 1 to 100."}</p>
              <Button type="submit" className="min-h-11" disabled={!valid || preview.isPending}>{preview.isPending && <Loader2 aria-hidden className="animate-spin" />}Get preview</Button>
            </form>
          )}
          {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
          {err && !isDeclarationRequired(err) && <ErrorBox error={err} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

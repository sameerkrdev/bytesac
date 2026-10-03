"use client";

import { SLIPPAGE_DEFAULT_BPS, SLIPPAGE_MAX_BPS, type OperationView } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { DeclarationForm, isDeclarationRequired } from "@/components/eligibility/declaration-form";
import { FeeLines } from "@/components/invest/fee-lines";
import { LegProgress, LegRow } from "@/components/invest/leg-progress";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

const micro = (v: string) => { const [w, f = ""] = v.split("."); return BigInt(w!) * 1_000_000n + BigInt(f.padEnd(6, "0")); };

/** Why the amount can't be planned, or null. The server checks the same rules and the wallet balance. */
function amountProblem(amount: string, minimum: string | null, increment: string | null): string | null {
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(amount)) return "Enter an amount in USDC, with up to 6 decimals.";
  const a = micro(amount);
  if (minimum && a < micro(minimum)) return `The minimum is ${minimum} USDC.`;
  if (increment && micro(increment) > 0n && a % micro(increment) !== 0n) return `The amount must be a multiple of ${increment} USDC.`;
  return a > 0n ? null : "Enter an amount above zero.";
}

/** Amount, slippage, preview, then signing leg by leg. */
export function InvestWizard({ basketId, name, minimumUsdc, incrementUsdc, open, onOpenChange }: {
  basketId: string; name: string; minimumUsdc: string | null; incrementUsdc: string | null; open: boolean; onOpenChange(open: boolean): void;
}) {
  const ids = [useId(), useId()];
  const [amount, setAmount] = useState(minimumUsdc ?? "");
  const [slippage, setSlippage] = useState(String(SLIPPAGE_DEFAULT_BPS / 100));
  // A new key per input change: the same key with different inputs is refused, and a repeated click with the same inputs returns the same plan.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [plan, setPlan] = useState<OperationView | null>(null);
  const [signing, setSigning] = useState(false);

  const bps = Math.round(Number(slippage) * 100);
  const problem = amountProblem(amount, minimumUsdc, incrementUsdc);
  const slippageProblem = Number.isFinite(bps) && bps >= 1 && bps <= SLIPPAGE_MAX_BPS ? null : `Slippage must be between 0.01% and ${SLIPPAGE_MAX_BPS / 100}%.`;
  const preview = useMutation({ mutationFn: () => api.investPlan({ basketId, amountUsdc: amount, slippageBps: bps, idempotencyKey: key }), onSuccess: setPlan });
  const discard = useMutation({ mutationFn: (id: string) => api.cancelOperation(id), onSettled: () => setPlan(null) });
  const err = preview.error ?? discard.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-border-dark bg-space sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-ivory">Invest in {name}</DialogTitle>
          <DialogDescription>You sign every step in your own wallets. Bytesac never moves your funds on its own.</DialogDescription>
        </DialogHeader>

        {signing && plan ? <LegProgress operationId={plan.id} /> : plan ? (
          <div className="space-y-4">
            <ol className="space-y-3">{plan.legs.map((l) => <LegRow key={l.id} leg={l} buying />)}</ol>
            <FeeLines fees={plan.fees} />
            <p className="text-sm text-stone">Outputs are estimates; each step is protected by a minimum you will receive ({slippage}% slippage). Prices are re-quoted when you sign each step.</p>
            <div className="flex flex-wrap gap-3">
              <Button className="min-h-11" onClick={() => setSigning(true)}>Continue to signing</Button>
              <Button variant="secondary" className="min-h-11" disabled={discard.isPending} onClick={() => discard.mutate(plan.id)}>Back</Button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); preview.mutate(); }}>
            <div className="space-y-2">
              <Label htmlFor={ids[0]} className="text-xs font-medium text-ivory">Amount (USDC on Solana)</Label>
              <Input id={ids[0]} inputMode="decimal" className="min-h-11" value={amount} aria-invalid={amount !== "" && problem !== null} aria-describedby={`${ids[0]}-help`}
                onChange={(e) => { setAmount(e.target.value.trim()); setKey(crypto.randomUUID()); }} />
              <p id={`${ids[0]}-help`} className="text-xs text-stone">{amount !== "" && problem ? problem : `Minimum ${minimumUsdc ?? "not set"} USDC${incrementUsdc ? `, in steps of ${incrementUsdc} USDC` : ""}. The fees are taken from this amount.`}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids[1]} className="text-xs font-medium text-ivory">Slippage tolerance (%)</Label>
              <Input id={ids[1]} inputMode="decimal" className="min-h-11" value={slippage} aria-invalid={slippageProblem !== null}
                onChange={(e) => { setSlippage(e.target.value.trim()); setKey(crypto.randomUUID()); }} />
              <p className="text-xs text-stone">{slippageProblem ?? "The most a price may move against you per step. Default 1%, at most 3%."}</p>
            </div>
            <Button type="submit" className="min-h-11" disabled={problem !== null || slippageProblem !== null || preview.isPending}>
              {preview.isPending && <Loader2 aria-hidden className="animate-spin" />}Get preview
            </Button>
          </form>
        )}
        {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
        {err && !isDeclarationRequired(err) && <div role="alert" className="rounded-xl border border-danger/40 p-3 text-sm text-ivory"><p className="font-medium">{toDisplayError(err).title}</p><p className="text-stone">{toDisplayError(err).message}</p></div>}
      </DialogContent>
    </Dialog>
  );
}

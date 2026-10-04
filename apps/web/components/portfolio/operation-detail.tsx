"use client";

import { formatUnits, OPERATION_STATUS_LABEL } from "@repo/app-core";
import type { OperationView } from "@repo/validator";
import { useState } from "react";
import { FeeLines } from "@/components/invest/fee-lines";
import { LegProgress, LegRow } from "@/components/invest/leg-progress";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KIND = { invest: "Investment", sell_to_usdc: "Sale to USDC", sell_former: "Sale of former assets", rebalance: "Rebalance", repair: "Buy back" } as const;

/** One operation with its legs and explorer links; an open one can be continued (sign the next leg) or stopped. */
export function OperationDetail({ operation: o, open }: { operation: OperationView; open?: boolean }) {
  const [resume, setResume] = useState(false);
  return (
    <li id={`operation-${o.id}`} className="scroll-mt-24 space-y-3 rounded-card border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="min-w-0"><span className="block font-medium text-ink">{KIND[o.kind]}{o.amountUsdc && ` · ${formatUnits(o.amountUsdc, 6)} USDC`}{o.sellPercent && ` · ${o.sellPercent}%`}</span><span className="block text-xs text-ink-muted">{new Date(o.createdAt).toLocaleString()} · {o.legs.length} {o.legs.length === 1 ? "step" : "steps"}</span></span>
        <StatusBadge {...OPERATION_STATUS_LABEL[o.status]} />
      </div>
      <details>
        <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink-muted hover:text-ink">Steps ({o.legs.length})</summary>
        <ol className="space-y-3">{o.legs.map((l) => <LegRow key={l.id} leg={l} buying={o.kind === "invest"} />)}</ol>
        <div className="pt-2"><FeeLines fees={o.fees} /></div>
      </details>
      {open && <Button onClick={() => setResume(true)}>Continue</Button>}
      {resume && (
        <Dialog open onOpenChange={setResume}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-ink">{KIND[o.kind]}</DialogTitle>
              <DialogDescription>Continue where you left off. You sign every step in your own wallets.</DialogDescription>
            </DialogHeader>
            <LegProgress operationId={o.id} />
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

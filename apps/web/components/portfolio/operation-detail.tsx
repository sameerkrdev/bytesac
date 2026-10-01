"use client";

import { formatUnits, OPERATION_STATUS_LABEL } from "@repo/app-core";
import type { OperationView } from "@repo/validator";
import { useState } from "react";
import { LegProgress, LegRow } from "@/components/invest/leg-progress";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const KIND = { invest: "Investment", sell_to_usdc: "Sale to USDC", sell_former: "Sale of former assets", rebalance: "Rebalance", repair: "Buy back" } as const;

/** One operation with its legs and explorer links; an open one can be continued (sign the next leg) or stopped. */
export function OperationDetail({ operation: o, open }: { operation: OperationView; open?: boolean }) {
  const [resume, setResume] = useState(false);
  return (
    <li className="space-y-3 rounded-xl border border-border-dark p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-ivory">{KIND[o.kind]} · {new Date(o.createdAt).toLocaleString()}{o.amountUsdc && ` · ${formatUnits(o.amountUsdc, 6)} USDC`}{o.sellPercent && ` · ${o.sellPercent}%`}</span>
        <StatusBadge {...OPERATION_STATUS_LABEL[o.status]} />
      </div>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-mint">Steps ({o.legs.length})</summary>
        <ol className="space-y-3">{o.legs.map((l) => <LegRow key={l.id} leg={l} buying={o.kind === "invest"} />)}</ol>
        <p className="pt-2 text-xs text-stone">Network fee: {formatUnits(o.networkFeeUsdc, 6)} USDC, paid to Bytesac for gas.</p>
      </details>
      {open && <Button className="min-h-11" onClick={() => setResume(true)}>Continue</Button>}
      {resume && (
        <Dialog open onOpenChange={setResume}>
          <DialogContent className="max-h-[90vh] overflow-y-auto border-border-dark bg-space sm:max-w-lg">
            <DialogHeader>
              <DialogTitle className="text-ivory">{KIND[o.kind]}</DialogTitle>
              <DialogDescription>Continue where you left off. You sign every step in your own wallets.</DialogDescription>
            </DialogHeader>
            <LegProgress operationId={o.id} />
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

"use client";

import { ApiError } from "@repo/api-client";
import type { AssetItemStatus, OpsAssetDetail } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OpsError } from "@/components/ops/ops-error";

/** What every editor section needs. `locked` = the instrument is under review or retired: read-only. */
export type SectionProps = { a: OpsAssetDetail; locked: boolean; isAdmin: boolean; onChange(d: OpsAssetDetail): void };

export const ITEM_ACTIONS = {
  DRAFT: ["approve", "retire"], APPROVED: ["activate", "retire"], ACTIVE: ["pause", "retire"], PAUSED: ["resume", "retire"], RETIRED: [],
} as const satisfies Record<AssetItemStatus, readonly string[]>;
export type ItemAction = (typeof ITEM_ACTIONS)[AssetItemStatus][number];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A button that asks first. */
export function ConfirmAction({ label, description, destructive, disabled, pending, onConfirm }: {
  label: string; description: string; destructive?: boolean; disabled?: boolean; pending?: boolean; onConfirm(): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={destructive ? "destructive" : "secondary"} className="min-h-11" disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border-dark bg-space">
          <DialogHeader>
            <DialogTitle className="text-ivory">{label}?</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" className="min-h-11" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={destructive ? "destructive" : "default"} className="min-h-11" disabled={pending} onClick={() => { setOpen(false); onConfirm(); }}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Admin buttons for a deployment or route. */
export function ItemActions({ status, disabled, pending, onAct }: { status: AssetItemStatus; disabled: boolean; pending: boolean; onAct(a: ItemAction): void }) {
  return ITEM_ACTIONS[status].map((action) => (
    <ConfirmAction key={action} label={cap(action)} destructive={action === "retire"} disabled={disabled} pending={pending}
      description={action === "retire" ? "Retiring is permanent. Add a new item to replace it." : `${cap(action)} this item. This is recorded in the asset history.`}
      onConfirm={() => onAct(action)} />
  ));
}

/** The API's own message is the useful text for the locked-field and read-only refusals. */
export function AssetError({ error }: { error: unknown }) {
  if (error instanceof ApiError && error.code === "INVALID_TRANSITION") return <p role="alert" className="text-sm text-danger">{error.message}</p>;
  return <OpsError error={error} />;
}

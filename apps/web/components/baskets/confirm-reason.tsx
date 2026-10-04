"use client";

import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** A button that asks first; with `reasonLabel` the dialog also collects a required reason (max 500 characters, as the API allows). */
export function ConfirmReason({ label, description, reasonLabel, destructive, disabled, pending, onConfirm }: {
  label: string; description: string; reasonLabel?: string; destructive?: boolean; disabled?: boolean; pending?: boolean; onConfirm(reason: string): void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const ready = !reasonLabel || reason.trim().length > 0;
  return (
    <>
      <Button type="button" variant={destructive ? "destructive" : "secondary"}  disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-line bg-canvas">
          <DialogHeader>
            <DialogTitle className="text-ink">{label}?</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {reasonLabel && (
            <div className="space-y-2">
              <Label htmlFor={id} className="text-xs font-medium text-ink">{reasonLabel}</Label>
              <Textarea id={id} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary"  onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={destructive ? "destructive" : "default"}  disabled={pending || !ready} onClick={() => { setOpen(false); onConfirm(reason.trim()); setReason(""); }}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

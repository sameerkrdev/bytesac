"use client";

import { AlertTriangle, Clock, Inbox, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { toDisplayError } from "@/lib/errors";

/** Shown while a list or detail loads. */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden className="size-4 animate-spin" />{label}</p>;
}

/** A list or detail with nothing to show; `children` is an optional next action (a link or button). */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-start gap-2 rounded-xl border border-border-dark p-4 text-sm">
      <p className="flex items-center gap-2 text-ivory"><Inbox aria-hidden className="size-4 text-stone" />{title}</p>
      {children}
    </div>
  );
}

/** A failed load, worded from the error, with a retry when the caller can offer one. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, message } = toDisplayError(error);
  return (
    <div role="alert" className="space-y-2 rounded-xl border border-danger/40 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium text-ivory"><AlertTriangle aria-hidden className="size-4 text-danger" />{title}</p>
      {message && <p className="text-stone">{message}</p>}
      {onRetry && <Button variant="secondary" className="min-h-11" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Data that is shown but may be out of date (a refetch failed or it is being refreshed). */
export function StaleNotice({ children = "This may be out of date." }: { children?: ReactNode }) {
  return <p role="status" className="flex items-center gap-2 text-xs text-warning"><Clock aria-hidden className="size-3.5" />{children}</p>;
}

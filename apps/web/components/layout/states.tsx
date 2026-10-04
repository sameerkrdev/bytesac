"use client";

import { AlertTriangle, Clock, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { toDisplayError } from "@/lib/errors";

/** Shown while a list or detail loads: a quiet shimmer with the label for screen readers. */
export function LoadingState({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="h-16 animate-pulse rounded-tile bg-surface-muted" style={{ opacity: 1 - i * 0.22 }} />
      ))}
      <p aria-hidden className="text-xs text-ink-faint">{label}</p>
    </div>
  );
}

/** A list or detail with nothing to show; `children` is an optional next action (a link or button). */
export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div role="status" className="flex flex-col items-start gap-3 rounded-card border border-dashed border-line-strong px-6 py-8 text-sm">
      <span aria-hidden className="grid size-10 place-items-center rounded-full bg-surface-muted text-ink-faint [&_svg]:size-4.5">{icon ?? <Inbox />}</span>
      <p className="text-base text-ink">{title}</p>
      {children && <div className="text-ink-muted">{children}</div>}
    </div>
  );
}

/** A failed load, worded from the error, with a retry when the caller can offer one. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { title, message } = toDisplayError(error);
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-danger/25 bg-danger-soft px-6 py-6 text-sm">
      <p className="flex items-center gap-2 font-medium text-ink"><AlertTriangle aria-hidden className="size-4 text-danger" />{title}</p>
      {message && <p className="text-ink-muted">{message}</p>}
      {onRetry && <Button variant="secondary" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Data that is shown but may be out of date (a refetch failed or it is being refreshed). */
export function StaleNotice({ children = "This may be out of date." }: { children?: ReactNode }) {
  return <p role="status" className="inline-flex items-center gap-2 rounded-pill bg-warning-soft px-3 py-1 text-xs text-warning"><Clock aria-hidden className="size-3.5" />{children}</p>;
}

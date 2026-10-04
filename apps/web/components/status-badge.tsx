import { cn } from "@/lib/utils";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<Tone, { dot: string; pill: string }> = {
  success: { dot: "bg-success", pill: "bg-success-soft text-success" },
  warning: { dot: "bg-warning", pill: "bg-warning-soft text-warning" },
  danger: { dot: "bg-danger", pill: "bg-danger-soft text-danger" },
  info: { dot: "bg-info", pill: "bg-info-soft text-info" },
  neutral: { dot: "bg-ink-faint", pill: "bg-surface-muted text-ink-muted" },
};

/** A pastel status pill with a dot. Tones come from the @repo/app-core label maps; the label carries the meaning, colour only supports it. */
export function StatusBadge({ tone, label, className }: { tone: Tone; label: string; className?: string }) {
  const t = TONES[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs leading-none font-medium whitespace-nowrap", t.pill, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", t.dot)} />
      {label}
    </span>
  );
}

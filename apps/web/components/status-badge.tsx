import { AlertTriangle, CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  success: { icon: CheckCircle2, cls: "text-success border-success/40" },
  warning: { icon: AlertTriangle, cls: "text-warning border-warning/40" },
  danger: { icon: XCircle, cls: "text-danger border-danger/40" },
  neutral: { icon: CircleDashed, cls: "text-muted-foreground border-border" },
} as const;

export function StatusBadge({ tone, label }: { tone: keyof typeof TONES; label: string }) {
  const { icon: Icon, cls } = TONES[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs font-medium", cls)}>
      <Icon aria-hidden className="size-3.5" />
      {label}
    </span>
  );
}

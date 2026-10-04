import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small mono label above a heading or a figure. */
export function Eyebrow({ children, className, as: Tag = "p" }: { children: ReactNode; className?: string; as?: "p" | "span" | "dt" | "h2" | "h3" }) {
  return <Tag className={cn("type-eyebrow text-ink-faint", className)}>{children}</Tag>;
}

/**
 * A money or percentage figure with the minor part muted, e.g. "$12,480" + ".52". Pass an already formatted string;
 * the split is purely visual.
 */
export function Figure({ value, className, size = "md" }: { value: string; className?: string; size?: "sm" | "md" | "lg" | "xl" }) {
  const m = /^(.*?)([.,]\d+)(\D*)$/.exec(value);
  const sizes = { sm: "text-xl", md: "text-3xl", lg: "text-5xl", xl: "text-6xl md:text-7xl" };
  return (
    <span className={cn("type-figure text-ink", sizes[size], className)}>
      {m ? <>{m[1]}<span className="text-ink-faint">{m[2]}</span>{m[3]}</> : value}
    </span>
  );
}

/** A labelled value in a definition list: label above, value below. */
export function Stat({ label, children, hint, className }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <dt className="type-eyebrow text-ink-faint">{label}</dt>
      <dd className="text-ink">{children}</dd>
      {hint && <dd className="text-xs text-ink-muted">{hint}</dd>}
    </div>
  );
}

/** Content width + vertical rhythm for marketing and research sections. */
export function Section({ children, className, id, width = "wide", labelledBy }: { children: ReactNode; className?: string; id?: string; width?: "wide" | "narrow" | "full"; labelledBy?: string }) {
  const w = { wide: "max-w-7xl", narrow: "max-w-3xl", full: "max-w-none" }[width];
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn("mx-auto w-full px-4 sm:px-6 lg:px-10", w, className)}>
      {children}
    </section>
  );
}

/** A soft inset tile for grouped content inside a card or page (one level only). */
export function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-tile bg-surface-muted p-4", className)}>{children}</div>;
}

/** Inline callout for notices that are not errors: explains what happened and what the user can do. */
export function Callout({ tone = "neutral", title, children, icon, className }: { tone?: "neutral" | "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; icon?: ReactNode; className?: string }) {
  const tones = {
    neutral: "border-line bg-surface-muted/70",
    info: "border-info/20 bg-info-soft",
    warning: "border-warning/25 bg-warning-soft",
    danger: "border-danger/25 bg-danger-soft",
    success: "border-success/25 bg-success-soft",
  };
  return (
    <div className={cn("flex gap-3 rounded-tile border p-4 text-sm", tones[tone], className)}>
      {icon && <span aria-hidden className="mt-0.5 shrink-0 text-ink-muted [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium text-ink">{title}</p>}
        {children && <div className="text-ink-muted">{children}</div>}
      </div>
    </div>
  );
}

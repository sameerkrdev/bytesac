import { brandAspect, brandMark, brandWordmark } from "@repo/design-tokens";
import { cn } from "@/lib/utils";

/** The Bytesac mark (two stacked slabs): top slab in the accent, bottom slab in the text colour; `size` is its height. `mono` uses the text colour for both. */
export function Mark({ size = 28, className, mono = false }: { size?: number; className?: string; mono?: boolean }) {
  return (
    <svg height={size} width={Math.round(size * brandAspect.mark)} viewBox={brandMark.viewBox} fill="currentColor" aria-hidden className={cn("shrink-0 text-ink", className)}>
      <path d={brandMark.paths[0]} fill={mono ? "currentColor" : "var(--c-accent)"} />
      <path d={brandMark.paths[1]} />
    </svg>
  );
}

/** The outlined "Bytesac" wordmark (Geist Medium); `size` is the mark height it sits beside. */
export function Wordmark({ size = 28, className }: { size?: number; className?: string }) {
  const h = Math.round(size * 0.78);
  return (
    <svg height={h} width={Math.round(h * brandAspect.wordmark)} viewBox={brandWordmark.viewBox} fill="currentColor" aria-hidden className={cn("shrink-0 text-ink", className)}
      // The box includes the y descender: drop it so the capitals centre on the mark (as in the exported logo).
      style={{ transform: `translateY(${(h * 0.086).toFixed(1)}px)` }}>
      <path d={brandWordmark.path} />
    </svg>
  );
}

/** Mark + wordmark, as in the brand files (apps/web/public/brand). */
export function Logo({ size = 28, className, wordmark = true }: { size?: number; className?: string; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center", className)} style={{ gap: Math.round(size * 0.3) }}>
      <Mark size={size} />
      {wordmark ? <Wordmark size={size} /> : null}
      <span className="sr-only">Bytesac</span>
    </span>
  );
}

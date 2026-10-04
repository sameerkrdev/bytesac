import { cn } from "@/lib/utils";

/**
 * The Bytesac mark: two stacked glass slabs over a half-round bowl, redrawn as a single-colour vector from the
 * brand usage sheet so it stays crisp at 20px and follows the theme. Replace with the official vector when available.
 */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={cn("shrink-0 text-ink", className)}>
      <path d="M11.5 10.2a6.4 6.4 0 0 0 0 12.8z" fill="currentColor" opacity="0.28" />
      <path d="M13.4 2.5h7.9a3 3 0 0 1 3 3v6.1a1.9 1.9 0 0 1-2.7 1.7l-8.6-4A2.4 2.4 0 0 1 11.6 7V4.3a1.8 1.8 0 0 1 1.8-1.8z" fill="currentColor" opacity="0.9" />
      <path d="M11.6 13.6a1.4 1.4 0 0 1 2-1.3l9.2 4.3a2.6 2.6 0 0 1 1.5 2.4v8.5a2 2 0 0 1-2 2h-8.3a2.4 2.4 0 0 1-2.4-2.4z" fill="currentColor" opacity="0.62" />
    </svg>
  );
}

/** Mark + wide-tracked wordmark, as on the brand sheet. */
export function Logo({ size = 28, className, wordmark = true }: { size?: number; className?: string; wordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Mark size={size} />
      {wordmark && <span className="text-[0.8125rem] font-medium tracking-[0.32em] text-ink uppercase">Bytesac</span>}
      {!wordmark && <span className="sr-only">Bytesac</span>}
    </span>
  );
}

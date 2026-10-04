/** Route-level skeleton while a server page loads. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-7xl space-y-6 px-4 pt-28 sm:px-6 lg:px-10">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="h-3 w-24 animate-pulse rounded-pill bg-surface-muted" />
      <div aria-hidden className="h-12 w-2/3 max-w-xl animate-pulse rounded-tile bg-surface-muted" />
      <div aria-hidden className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-card bg-surface-muted" />)}
      </div>
    </div>
  );
}

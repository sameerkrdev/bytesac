"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Bell as BellIcon, GitCompareArrows, PauseCircle, PlayCircle, Scale, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<string, typeof BellIcon> = {
  rebalance_available: GitCompareArrows, drifted: Scale, repair_required: AlertTriangle, execution_incomplete: AlertTriangle, basket_paused: PauseCircle,
  basket_unpaused: PlayCircle, basket_retirement_pending: XCircle, basket_retired: XCircle, lead_changed: UserRound, instrument_not_investable: AlertTriangle,
};
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";
import { PageHeader } from "@/components/layout/page-layout";
import { EmptyState, ErrorState, LoadingState, StaleNotice } from "@/components/layout/states";

/** Kinds that ask the investor to decide something (review, rebalance, repair). */
const NEEDS_YOU = new Set(["rebalance_available", "drifted", "repair_required", "execution_incomplete", "instrument_not_investable"]);
type Filter = "all" | "unread" | "action";
const FILTERS: [Filter, string][] = [["all", "All"], ["unread", "Unread"], ["action", "Needs you"]];
const bucket = (iso: string) => {
  const age = Date.now() - new Date(iso).getTime();
  return age < 86_400_000 ? "Today" : age < 7 * 86_400_000 ? "This week" : "Earlier";
};

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [["day", 86_400_000], ["hour", 3_600_000], ["minute", 60_000]];
const ago = (iso: string) => {
  const diff = new Date(iso).getTime() - Date.now();
  const [unit, ms] = UNITS.find(([, m]) => Math.abs(diff) >= m) ?? ["minute", 60_000];
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(diff / ms), unit);
};

export function Inbox() {
  const qc = useQueryClient();
  const q = useInfiniteQuery({ queryKey: ["notifications", "list"], queryFn: ({ pageParam }) => api.notifications({ cursor: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: (p) => p.nextCursor ?? undefined });
  const read = useMutation({ mutationFn: (b: { ids: string[] } | { all: true }) => api.markNotificationsRead(b), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unreadCount ?? 0;
  const [filter, setFilter] = useState<Filter>("all");
  const shown = items.filter((n) => filter === "all" || (filter === "unread" ? !n.readAt : NEEDS_YOU.has(n.kind)));
  const groups = ["Today", "This week", "Earlier"].map((g) => [g, shown.filter((n) => bucket(n.createdAt) === g)] as const).filter(([, list]) => list.length > 0);

  return (
    <section aria-labelledby="inbox-title" className="space-y-6">
      <PageHeader id="inbox-title" title="Notifications" description="Updates about your baskets. A notification never means a trade happened — only operations you sign move assets."
        actions={unread > 0 ? <Button variant="secondary" disabled={read.isPending} onClick={() => read.mutate({ all: true })}>Mark all read</Button> : undefined} />
      {q.isPending && <LoadingState />}
      {q.isError && !q.data && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && q.data && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      {read.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(read.error).title}</p>}
      {q.data && items.length === 0 && <EmptyState title="Nothing yet." />}
      {items.length > 0 && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-12">
          <div className="min-w-0 space-y-6">
            <div role="tablist" aria-label="Show" className="inline-flex rounded-pill border border-line bg-surface p-1">
              {FILTERS.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                  className={cn("min-h-9 rounded-pill px-4 text-sm text-ink-muted transition-colors hover:text-ink", filter === k && "bg-primary text-primary-ink hover:text-primary-ink")}>
                  {label}{k === "unread" && unread > 0 && <span className="ml-1.5 font-mono text-xs">{unread}</span>}
                </button>
              ))}
            </div>
            {groups.length === 0 && <p className="rounded-card border border-dashed border-line-strong px-6 py-8 text-sm text-ink-muted">{filter === "unread" ? "You're all caught up." : "Nothing needs you right now."}</p>}
            {groups.map(([g, list]) => (
              <section key={g} aria-label={g} className="space-y-2">
                <h2 className="type-eyebrow text-ink-faint">{g}</h2>
                <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {list.map((n) => {
          const Icon = KIND_ICON[n.kind] ?? BellIcon;
          return (
            <li key={n.id}>
              <Link href={n.link} className={cn("flex gap-4 px-5 py-4 transition-colors hover:bg-surface-muted", !n.readAt && "bg-accent-soft/40")} onClick={() => { if (!n.readAt) read.mutate({ ids: [n.id] }); }}>
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-muted text-ink-muted"><Icon className="size-4" /></span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    {!n.readAt && <span role="img" aria-label="Unread" className="size-2 shrink-0 rounded-full bg-accent" />}{n.title}
                  </span>
                  <span className="block text-sm text-ink-muted">{n.body}</span>
                  <span className="block text-xs text-ink-faint">{ago(n.createdAt)}</span>
                </span>
              </Link>
            </li>
          );
        })}
              </ul>
              </section>
            ))}
          </div>
          <aside className="h-fit space-y-3 rounded-card border border-line bg-surface-muted/50 p-6 text-sm">
            <p className="font-medium text-ink">What a notice means</p>
            <p className="text-ink-muted">Notices tell you about a basket: a new version, drift, a pause. They never move assets — only an operation you review and sign does.</p>
            <Link href="/profile#notifications" className="inline-block text-ink underline underline-offset-4">Notification settings</Link>
          </aside>
        </div>
      )}
      {q.hasNextPage && <Button variant="secondary"  disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button>}
    </section>
  );
}

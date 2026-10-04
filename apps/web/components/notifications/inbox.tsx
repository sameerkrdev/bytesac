"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
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

  return (
    <section aria-labelledby="inbox-title" className="space-y-6">
      <PageHeader id="inbox-title" title="Notifications" description="Updates about your baskets. A notification never means a trade happened — only operations you sign move assets."
        actions={unread > 0 ? <Button variant="secondary" disabled={read.isPending} onClick={() => read.mutate({ all: true })}>Mark all read</Button> : undefined} />
      {q.isPending && <LoadingState />}
      {q.isError && !q.data && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
      {q.isError && q.data && <StaleNotice>Could not refresh. Showing what loaded earlier.</StaleNotice>}
      {read.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(read.error).title}</p>}
      {q.data && items.length === 0 && <EmptyState title="Nothing yet." />}
      {items.length > 0 && <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {items.map((n) => {
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
      </ul>}
      {q.hasNextPage && <Button variant="secondary"  disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button>}
    </section>
  );
}

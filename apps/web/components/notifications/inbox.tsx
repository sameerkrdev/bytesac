"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="inbox-title" className="font-display text-3xl font-bold text-ivory md:text-4xl">Notifications</h1>
        {unread > 0 && <Button variant="secondary" className="min-h-11" disabled={read.isPending} onClick={() => read.mutate({ all: true })}>Mark all read</Button>}
      </div>
      {q.isPending && <p role="status" className="text-sm text-stone">Loading…</p>}
      {q.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(q.error).title}</p>}
      {read.isError && <p role="alert" className="text-sm text-danger">{toDisplayError(read.error).title}</p>}
      {q.data && items.length === 0 && <p className="text-sm text-stone">Nothing yet.</p>}
      <ul className="divide-y divide-border-dark">
        {items.map((n) => (
          <li key={n.id} className="py-3">
            <Link href={n.link} className="block space-y-1" onClick={() => { if (!n.readAt) read.mutate({ ids: [n.id] }); }}>
              <p className="flex items-center gap-2 text-sm font-medium text-ivory">
                {!n.readAt && <span role="img" aria-label="Unread" className="size-2 rounded-full bg-mint" />}{n.title}
              </p>
              <p className="text-sm text-stone">{n.body}</p>
              <p className="text-xs text-stone">{ago(n.createdAt)}</p>
            </Link>
          </li>
        ))}
      </ul>
      {q.hasNextPage && <Button variant="secondary" className="min-h-11" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button>}
    </section>
  );
}

"use client";

import type { ApiClient } from "@repo/api-client";
import { BASKET_STATUS_LABEL, BASKET_VERSION_STATUS_LABEL } from "@repo/app-core";
import type { ListOpsBasketsQuery } from "@repo/validator";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OpsError } from "../ops-error";

type Client = Pick<ApiClient, "opsListBaskets">;
type Queue = ListOpsBasketsQuery["queue"];

const TABS: Array<{ queue: Queue; label: string }> = [
  { queue: "review", label: "In review" }, { queue: "escalated", label: "Escalated" }, { queue: "leads", label: "Lead approvals" }, { queue: "retirements", label: "Retirements" },
];

export function BasketsQueue({ client = api }: { client?: Client }) {
  const [queue, setQueue] = useState<Queue>("review");
  const list = useInfiniteQuery({
    queryKey: ["ops", "baskets", queue],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.opsListBaskets({ queue, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold text-ivory">Baskets</h1>
      <div role="group" aria-label="Queue" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.queue} type="button" aria-pressed={queue === t.queue} onClick={() => setQueue(t.queue)}
            className={cn("min-h-11 rounded-lg border border-border-dark px-3 text-sm text-stone hover:text-ivory", queue === t.queue && "bg-slate text-ivory")}>
            {t.label}
          </button>
        ))}
      </div>
      {list.isError ? <OpsError error={list.error} /> : list.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No baskets found.</p>
      ) : (
        <>
          <ul className="divide-y divide-border-dark">
            {items.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <Link href={`/ops/baskets/${b.id}`} className="font-medium text-ivory underline-offset-4 hover:underline">{b.name}</Link>
                <span className="text-sm text-stone">{b.organizationName ?? "Unnamed organization"}</span>
                <StatusBadge {...BASKET_STATUS_LABEL[b.status]} />
                <StatusBadge {...BASKET_VERSION_STATUS_LABEL[b.latestVersionStatus]} label={`Version ${b.latestVersionNumber}: ${BASKET_VERSION_STATUS_LABEL[b.latestVersionStatus].label}`} />
                <span className="text-xs text-stone">updated {new Date(b.updatedAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
          {list.hasNextPage && <Button variant="secondary" className="min-h-11" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button>}
        </>
      )}
    </div>
  );
}

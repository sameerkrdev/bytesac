"use client";

import type { ApiClient } from "@repo/api-client";
import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL } from "@repo/app-core";
import type { MemberReviewSummary, MembershipStatus } from "@repo/validator";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OpsError } from "./ops-error";

type Client = Pick<ApiClient, "opsListMembers">;

// Undefined = the default queue: memberships under review plus active members whose role upgrade is in review.
const FILTERS: Array<MembershipStatus | undefined> = [undefined, "CHANGES_REQUIRED", "PENDING_DOCUMENTS", "ACTIVE", "REJECTED"];

const role = (m: MemberReviewSummary) => (m.requestedRole ? `${MEMBERSHIP_ROLE_LABEL[m.role]} → ${MEMBERSHIP_ROLE_LABEL[m.requestedRole]}` : MEMBERSHIP_ROLE_LABEL[m.role]);
const org = (m: MemberReviewSummary) => m.organization.displayName ?? "Unnamed organization";
const date = (m: MemberReviewSummary) => (m.submittedAt ? new Date(m.submittedAt).toLocaleDateString() : "");

export function MembersTable({ client = api }: { client?: Client }) {
  const [status, setStatus] = useState<MembershipStatus | undefined>();
  const list = useInfiniteQuery({
    queryKey: ["ops", "members", status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.opsListMembers({ status, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold text-ivory">Members</h1>
      <div role="group" aria-label="Filter by status" className="flex flex-wrap items-center gap-2">
        {FILTERS.map((s) => (
          <button key={s ?? "queue"} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}
            className={cn("min-h-11 rounded-lg border border-border-dark px-3 text-sm text-stone hover:text-ivory", status === s && "bg-slate text-ivory")}>
            {s ? MEMBERSHIP_STATUS_LABEL[s].label : "Needs review"}
          </button>
        ))}
      </div>

      {list.isError ? <OpsError error={list.error} /> : list.isPending ? <p role="status" className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members found.</p>
      ) : (
        <>
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="text-xs text-stone">
              <tr><th className="py-2 pr-4 font-medium">Organization</th><th className="pr-4 font-medium">Member</th><th className="pr-4 font-medium">Role</th><th className="pr-4 font-medium">Status</th><th className="font-medium">Submitted</th></tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-t border-border-dark">
                  <td className="py-3 pr-4"><Link href={`/ops/members/${m.id}`} className="font-medium text-ivory underline-offset-4 hover:underline">{org(m)}</Link></td>
                  <td className="pr-4 text-stone">{m.publicDisplayName ?? "—"}</td>
                  <td className="pr-4 text-stone">{role(m)}</td>
                  <td className="pr-4"><StatusBadge {...MEMBERSHIP_STATUS_LABEL[m.status]} /></td>
                  <td className="text-stone">{date(m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="space-y-3 md:hidden">
            {items.map((m) => (
              <li key={m.id}>
                <Link href={`/ops/members/${m.id}`} className="block space-y-2 rounded-xl border border-border-dark bg-slate p-4">
                  <span className="block font-medium text-ivory">{org(m)}</span>
                  <span className="block text-xs text-stone">{m.publicDisplayName ?? "—"} · {role(m)} · {date(m)}</span>
                  <StatusBadge {...MEMBERSHIP_STATUS_LABEL[m.status]} />
                </Link>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button variant="secondary" className="min-h-11" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>Load more</Button>
          )}
        </>
      )}
    </div>
  );
}

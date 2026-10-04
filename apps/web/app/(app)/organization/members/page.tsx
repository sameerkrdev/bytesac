"use client";

import { MEMBERSHIP_ROLE_LABEL } from "@repo/app-core";
import Link from "next/link";
import { Suspense } from "react";
import { ErrorState, LoadingState } from "@/components/layout/states";
import { Members } from "@/components/organization/members";
import { useOrgWorkspace, WorkspaceHeader } from "@/components/organization/workspace";

const ROLES = [
  ["OWNER", "Everything, including profile, payout wallet, admins and earnings."],
  ["ADMIN", "Members, baskets and earnings."],
  ["MANAGER", "Baskets they are assigned to."],
  ["ANALYST", "Read the organization and its analytics."],
  ["VIEWER", "Read the organization."],
] as const;

export default function OrganizationMembersPage() {
  return <Suspense><View /></Suspense>;
}

/** Team and roles. Hiding controls is a convenience; every member action is authorized by the server. */
function View() {
  const { row, active, query, org, switcher } = useOrgWorkspace("/organization/members");
  if (!row || !active) return <p className="text-ink-muted">You need an active membership to see the team. <Link href="/organization" className="text-ink underline underline-offset-4">Go to your organization</Link></p>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!org) return <LoadingState />;
  return (
    <div className="space-y-10">
      <WorkspaceHeader id="members-title" title="Members" org={org} switcher={switcher} crumbs={[{ label: "Workspace", href: `/organization?org=${org.id}` }, { label: "Members" }]} />
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0"><Members org={org} /></div>
        <aside aria-label="Roles" className="space-y-3">
          <h2 className="type-eyebrow text-ink-faint">Roles</h2>
          <dl className="divide-y divide-line rounded-card border border-line bg-surface">
            {ROLES.map(([r, d]) => <div key={r} className="px-4 py-3 text-sm"><dt className="font-medium text-ink">{MEMBERSHIP_ROLE_LABEL[r]}</dt><dd className="mt-0.5 text-xs text-ink-muted">{d}</dd></div>)}
          </dl>
          <p className="text-xs text-ink-faint">Basket-level flags (edit, submit, publish, lifecycle, assign) refine what each manager can do on each basket.</p>
        </aside>
      </div>
    </div>
  );
}

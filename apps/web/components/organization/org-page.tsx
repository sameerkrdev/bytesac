"use client";

import type { OrganizationDetail } from "@repo/validator";
import Link from "next/link";
import type { ReactNode } from "react";
import { ErrorState, LoadingState } from "@/components/layout/states";
import { useOrgWorkspace, WorkspaceHeader } from "@/components/organization/workspace";

type Ctx = ReturnType<typeof useOrgWorkspace> & { org: OrganizationDetail };

/**
 * A manager workspace page: one header, and the same handling everywhere for "no active membership", errors and
 * loading. `children` receives the loaded organization. Access is still decided by the API.
 */
export function OrgPage({ id, title, description, path, actions, children }: {
  id: string; title: string; description?: ReactNode; path: string; actions?: (org: OrganizationDetail) => ReactNode; children(ctx: Ctx): ReactNode;
}) {
  const ws = useOrgWorkspace(path);
  const { row, active, query, org } = ws;
  if (!row || !active) {
    return <p className="text-ink-muted">You need an active membership in an organization to open this page. <Link href="/organization" className="text-ink underline underline-offset-4">Go to your organization</Link></p>;
  }
  return (
    <div className="space-y-10">
      <WorkspaceHeader id={id} title={title} org={org} switcher={ws.switcher} actions={org && actions?.(org)} description={description} />
      {query.isError ? <ErrorState error={query.error} onRetry={() => void query.refetch()} /> : !org ? <LoadingState /> : children({ ...ws, org })}
    </div>
  );
}

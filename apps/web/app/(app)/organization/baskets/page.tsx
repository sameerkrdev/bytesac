"use client";

import Link from "next/link";
import { Suspense } from "react";
import { ErrorState, LoadingState } from "@/components/layout/states";
import { Baskets } from "@/components/organization/baskets";
import { useOrgWorkspace, WorkspaceHeader } from "@/components/organization/workspace";

export default function OrganizationBasketsPage() {
  return <Suspense><View /></Suspense>;
}

/** The organization's baskets by lifecycle stage, with create. Baskets belong to the organization, not to a manager. */
function View() {
  const { row, active, query, org, switcher } = useOrgWorkspace("/organization/baskets");
  if (!row || !active) return <p className="text-ink-muted">You need an active membership to see baskets. <Link href="/organization" className="text-ink underline underline-offset-4">Go to your organization</Link></p>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (!org) return <LoadingState />;
  return (
    <div className="space-y-10">
      <WorkspaceHeader id="baskets-title" title="Baskets" org={org} switcher={switcher} crumbs={[{ label: "Workspace", href: `/organization?org=${org.id}` }, { label: "Baskets" }]} />
      <p className="max-w-2xl text-sm text-ink-muted">Drafts are private. A version becomes public only after Bytesac reviews it and a manager with publish rights publishes it — and published versions never change.</p>
      {org.myPermissions.includes("org.read") ? <Baskets org={org} /> : <p className="text-ink-muted">Your role can&apos;t read this organization&apos;s baskets.</p>}
    </div>
  );
}

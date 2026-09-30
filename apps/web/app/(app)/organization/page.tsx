"use client";

import { ORGANIZATION_STATUS_LABEL } from "@repo/app-core";
import type { OrganizationDetail } from "@repo/validator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChangeRequest } from "@/components/organization/change-request";
import { CreateOrganization } from "@/components/organization/create-organization";
import { OrganizationDocuments } from "@/components/organization/organization-documents";
import { OrganizationFields } from "@/components/organization/organization-fields";
import { PayoutWallet } from "@/components/organization/payout-wallet";
import { SubmitChecklist } from "@/components/organization/submit-checklist";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

const REVIEW_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"];

export default function OrganizationPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const mine = me?.organizations ?? [];
  const id = (mine.find((o) => o.status !== "REJECTED") ?? mine[0])?.id;
  const key = ["organization", id];
  const query = useQuery({ queryKey: key, queryFn: () => api.getOrganization(id as string), enabled: Boolean(id), retry: false });
  const org = query.data;
  const setOrg = (d: OrganizationDetail) => { qc.setQueryData(["organization", d.id], d); void qc.invalidateQueries({ queryKey: ["me"] }); };
  const canCreate = me?.permissions.includes("create_manager_organization");

  const create = canCreate
    ? <CreateOrganization onCreated={setOrg} />
    : <p className="text-base text-ivory">You need approval before you can create an organization. <Link href="/managers/apply" className="text-mint underline">Become a fund manager</Link></p>;

  if (!id) return <Shell>{create}</Shell>;
  if (query.isError) { const e = toDisplayError(query.error); return <Shell><p role="alert" className="text-sm text-danger"><span className="font-medium">{e.title}</span> {e.message}</p></Shell>; }
  if (!org) return <Shell><p role="status" className="text-sm text-muted-foreground">Loading…</p></Shell>;

  const version = org.openVersion ?? org.currentVersion;
  const editable = org.openVersion?.status === "draft" || org.openVersion?.status === "changes_required";
  const label = ORGANIZATION_STATUS_LABEL[org.status];
  const verified = org.status === "VERIFIED";
  const banner =
    REVIEW_STATUSES.includes(org.status) ? "Your organization is being reviewed. It is read-only until we respond."
    : verified && org.openVersion?.status === "in_review" ? "Your profile changes are being reviewed. The public profile stays as it is until they are approved."
    : verified && org.openVersion?.status === "draft" ? "You are editing a change request. The public profile stays as it is until it is approved."
    : org.status === "REJECTED" ? "This organization was not approved."
    : null;
  const message = (org.status === "CHANGES_REQUIRED" || org.openVersion?.status === "changes_required") ? org.latestMessageToOwner : null;

  return (
    <Shell badge={<StatusBadge {...label} />}>
      {banner && <p role="status" className="rounded-xl border border-border-dark bg-slate p-4 text-sm text-ivory">{banner}</p>}
      {message && (
        <div role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm text-ivory">
          <p className="font-medium text-warning">Changes required</p>
          <p className="mt-1 whitespace-pre-wrap">{message}</p>
        </div>
      )}
      {verified && <ChangeRequest org={org} onChange={setOrg} />}
      {version && (
        <>
          <OrganizationFields key={version.id} org={org} version={version} readOnly={!editable} onChange={setOrg} />
          <OrganizationDocuments org={org} version={version} readOnly={!editable} onChange={setOrg} />
        </>
      )}
      <PayoutWallet org={org} onChange={setOrg} />
      {editable && <SubmitChecklist org={org} onChange={setOrg} onIncomplete={() => void qc.invalidateQueries({ queryKey: key })} />}
      {org.status === "REJECTED" && create}
    </Shell>
  );
}

function Shell({ badge, children }: { badge?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="org-title" className="max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 id="org-title" className="font-display text-3xl font-bold text-ivory md:text-4xl">Your organization</h1>
        {badge}
      </div>
      {children}
    </section>
  );
}

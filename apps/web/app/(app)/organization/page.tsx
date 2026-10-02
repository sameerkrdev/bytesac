"use client";

import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL, ORGANIZATION_STATUS_LABEL } from "@repo/app-core";
import type { OrganizationDetail } from "@repo/validator";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Baskets } from "@/components/organization/baskets";
import { ChangeRequest } from "@/components/organization/change-request";
import { CreateOrganization } from "@/components/organization/create-organization";
import { Members } from "@/components/organization/members";
import { OrganizationDocuments } from "@/components/organization/organization-documents";
import { OrganizationFields } from "@/components/organization/organization-fields";
import { PayoutWallet } from "@/components/organization/payout-wallet";
import { SubmitChecklist } from "@/components/organization/submit-checklist";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

const REVIEW_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"];

export default function OrganizationPage() {
  return <Suspense><Workspace /></Suspense>; // useSearchParams needs a Suspense boundary
}

function Workspace() {
  const qc = useQueryClient();
  const router = useRouter();
  const params = useSearchParams();
  const { data: me } = useMe();
  const mine = me?.organizations ?? [];
  // `?org=` picks the workspace; otherwise prefer the ACTIVE organization the user owns, then any ACTIVE one, then one not rejected.
  const row = mine.find((o) => o.id === params.get("org"))
    ?? mine.find((o) => o.role === "OWNER" && o.membershipStatus === "ACTIVE")
    ?? mine.find((o) => o.membershipStatus === "ACTIVE")
    ?? mine.find((o) => o.status !== "REJECTED")
    ?? mine[0];
  const switcher = mine.length > 1 && row && (
    <div className="space-y-2">
      <Label htmlFor="org-switcher" className="text-xs font-medium text-ivory">Organization</Label>
      <Select id="org-switcher" className="min-h-11" value={row.id} onChange={(e) => router.replace(`/organization?org=${e.target.value}`)}>
        {mine.map((o) => <option key={o.id} value={o.id}>{o.displayName ?? "Unnamed organization"} · {MEMBERSHIP_ROLE_LABEL[o.role]} · {MEMBERSHIP_STATUS_LABEL[o.membershipStatus].label}</option>)}
      </Select>
    </div>
  );
  const id = row?.id;
  // Only an ACTIVE membership can read the organization (the API answers 403 otherwise).
  const active = row?.membershipStatus === "ACTIVE";
  const key = ["organization", id];
  const query = useQuery({ queryKey: key, queryFn: () => api.getOrganization(id as string), enabled: Boolean(id) && active, retry: false });
  const org = query.data;
  const setOrg = (d: OrganizationDetail) => { qc.setQueryData(["organization", d.id], d); void qc.invalidateQueries({ queryKey: ["me"] }); };
  const canCreate = me?.permissions.includes("create_manager_organization");

  const create = canCreate
    ? <CreateOrganization onCreated={setOrg} />
    : <p className="text-base text-ivory">You need approval before you can create an organization. <Link href="/managers/apply" className="text-mint underline">Become a fund manager</Link></p>;

  if (!row) return <Shell switcher={switcher}>{create}</Shell>;
  if (!active) {
    return (
      <Shell switcher={switcher} badge={<StatusBadge {...MEMBERSHIP_STATUS_LABEL[row.membershipStatus]} />}>
        <p className="text-base text-ivory">Your membership is not active yet. <Link href={`/organization/membership/${row.membershipId}`} className="text-mint underline">Open your membership</Link></p>
      </Shell>
    );
  }
  if (query.isError) { const e = toDisplayError(query.error); return <Shell switcher={switcher}><p role="alert" className="text-sm text-danger"><span className="font-medium">{e.title}</span> {e.message}</p></Shell>; }
  if (!org) return <Shell switcher={switcher}><p role="status" className="text-sm text-muted-foreground">Loading…</p></Shell>;

  const version = org.openVersion ?? org.currentVersion;
  const canEdit = org.myPermissions.includes("org.edit");
  const editable = canEdit && (org.openVersion?.status === "draft" || org.openVersion?.status === "changes_required");
  const label = ORGANIZATION_STATUS_LABEL[org.status];
  const verified = org.status === "VERIFIED";
  const banner =
    !canEdit ? "You have read-only access to this organization."
    : REVIEW_STATUSES.includes(org.status) ? "Your organization is being reviewed. It is read-only until we respond."
    : verified && org.openVersion?.status === "in_review" ? "Your profile changes are being reviewed. The public profile stays as it is until they are approved."
    : verified && org.openVersion?.status === "draft" ? "You are editing a change request. The public profile stays as it is until it is approved."
    : org.status === "REJECTED" ? "This organization was not approved."
    : null;
  const message = (org.status === "CHANGES_REQUIRED" || org.openVersion?.status === "changes_required") ? org.latestMessageToOwner : null;

  return (
    <Shell switcher={switcher} badge={<StatusBadge {...label} />}>
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
      <Members org={org} />
      {org.myPermissions.includes("org.read") && <Baskets org={org} />}
      {org.myPermissions.includes("earnings.read") && <Link href={`/organization/earnings?org=${org.id}`} className="mr-4 inline-flex min-h-11 items-center text-sm text-mint underline">Earnings</Link>}
      <Link href={`/organization/membership/${row.membershipId}`} className="inline-flex min-h-11 items-center text-sm text-mint underline">Your membership</Link>
    </Shell>
  );
}

function Shell({ badge, switcher, children }: { badge?: ReactNode; switcher?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="org-title" className="max-w-3xl space-y-8">
      <div className="space-y-2">
        <h1 id="org-title" className="font-display text-3xl font-bold text-ivory md:text-4xl">Your organization</h1>
        {badge}
      </div>
      {switcher}
      {children}
    </section>
  );
}

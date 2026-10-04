"use client";

import { MEMBERSHIP_STATUS_LABEL, PAYOUT_WALLET_STATUS_LABEL } from "@repo/app-core";
import type { OrganizationDetail } from "@repo/validator";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Baskets } from "@/components/organization/baskets";
import { ChangeRequest } from "@/components/organization/change-request";
import { CreateOrganization } from "@/components/organization/create-organization";
import { Members } from "@/components/organization/members";
import { OrganizationDocuments } from "@/components/organization/organization-documents";
import { OrganizationFields } from "@/components/organization/organization-fields";
import { PayoutWallet } from "@/components/organization/payout-wallet";
import { SubmitChecklist } from "@/components/organization/submit-checklist";
import { useOrgWorkspace, WorkspaceHeader } from "@/components/organization/workspace";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/kit";
import { toDisplayError } from "@/lib/errors";
import { LoadingState } from "@/components/layout/states";
import { formatDate } from "@/lib/format-date";

const REVIEW_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"];

export default function OrganizationPage() {
  return <Suspense><Workspace /></Suspense>; // useSearchParams needs a Suspense boundary
}

/** A titled workspace block with an anchor for the section index. */
function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-32 space-y-4">
      <h2 className="type-eyebrow text-ink-faint">{title}</h2>
      {children}
    </section>
  );
}

function Workspace() {
  const { me, row, active, query, org, setOrg, switcher, invalidate } = useOrgWorkspace();
  const canCreate = me?.permissions.includes("create_manager_organization");
  const create = canCreate
    ? <CreateOrganization onCreated={setOrg} />
    : <p className="text-base text-ink">You need approval before you can create an organization. <Link href="/managers/apply" className="underline underline-offset-4">Become a fund manager</Link></p>;

  if (!row) return <Shell switcher={switcher}>{create}</Shell>;
  if (!active) {
    return (
      <Shell switcher={switcher} badge={<StatusBadge {...MEMBERSHIP_STATUS_LABEL[row.membershipStatus]} />}>
        <p className="text-base text-ink">Your membership is not active yet. <Link href={`/organization/membership/${row.membershipId}`} className="underline underline-offset-4">Open your membership</Link></p>
      </Shell>
    );
  }
  if (query.isError) { const e = toDisplayError(query.error); return <Shell switcher={switcher}><p role="alert" className="text-sm text-danger"><span className="font-medium">{e.title}</span> {e.message}</p></Shell>; }
  if (!org) return <Shell switcher={switcher}><LoadingState /></Shell>;

  const version = org.openVersion ?? org.currentVersion;
  const canEdit = org.myPermissions.includes("org.edit");
  const editable = canEdit && (org.openVersion?.status === "draft" || org.openVersion?.status === "changes_required");
  const verified = org.status === "VERIFIED";
  const banner =
    !canEdit ? "You have read-only access to this organization."
    : REVIEW_STATUSES.includes(org.status) ? "Your organization is being reviewed. It is read-only until we respond."
    : verified && org.openVersion?.status === "in_review" ? "Your profile changes are being reviewed. The public profile stays as it is until they are approved."
    : verified && org.openVersion?.status === "draft" ? "You are editing a change request. The public profile stays as it is until it is approved."
    : org.status === "REJECTED" ? "This organization was not approved."
    : null;
  const message = (org.status === "CHANGES_REQUIRED" || org.openVersion?.status === "changes_required") ? org.latestMessageToOwner : null;
  const payout = org.payoutWallets[0];
  const index = [
    ["status", "Status"], ...(version ? [["profile", "Profile"]] : []), ["payout", "Payout wallet"], ["team", "Team"],
    ...(org.myPermissions.includes("org.read") ? [["baskets", "Baskets"]] : []),
  ] as [string, string][];

  return (
    <Shell switcher={switcher} org={org} wide
      actions={verified ? <Link href={`/organizations/${org.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Public page<ArrowUpRight /></Link> : undefined}>

      <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-surface p-5"><dt className="text-xs text-ink-faint">Organization</dt><dd className="mt-1 text-ink">{org.type === "firm" ? "Firm" : "Individual"} · {org.jurisdiction}</dd></div>
        <div className="bg-surface p-5"><dt className="text-xs text-ink-faint">Verified</dt><dd className="mt-1 text-ink">{org.verifiedAt ? formatDate(org.verifiedAt) : "Not yet"}</dd></div>
        <div className="bg-surface p-5"><dt className="text-xs text-ink-faint">Payout wallet</dt><dd className="mt-1">{payout ? <StatusBadge {...PAYOUT_WALLET_STATUS_LABEL[payout.status]} /> : <span className="text-ink-muted">Not set</span>}</dd></div>
        <div className="bg-surface p-5"><dt className="text-xs text-ink-faint">Your access</dt><dd className="mt-1 text-ink">{canEdit ? "Can edit" : "Read-only"}</dd></div>
      </dl>

      <div className="grid gap-10 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Workspace sections" className="hidden lg:block">
          <ul className="sticky top-36 space-y-0.5 border-l border-line">
            {index.map(([id, label]) => <li key={id}><a href={`#${id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm text-ink-muted hover:border-ink hover:text-ink">{label}</a></li>)}
            {org.myPermissions.includes("earnings.read") && <li><Link href={`/organization/earnings?org=${org.id}`} className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm text-ink-muted hover:border-ink hover:text-ink">Earnings</Link></li>}
          </ul>
        </nav>
        <div className="min-w-0 space-y-12">
          <Block id="status" title="Status">
            {banner && <p role="status" className="rounded-tile border border-line bg-surface p-4 text-sm text-ink">{banner}</p>}
            {message && (
              <div role="status" className="rounded-tile border border-warning/25 bg-warning-soft p-4 text-sm text-ink">
                <p className="font-medium text-warning">Changes required</p>
                <p className="mt-1 whitespace-pre-wrap">{message}</p>
              </div>
            )}
            {!banner && !message && <Callout tone="success" title="All set">Your organization is verified. Changes to the public profile go through review first.</Callout>}
            {verified && <ChangeRequest org={org} onChange={setOrg} />}
            {editable && <SubmitChecklist org={org} onChange={setOrg} onIncomplete={() => void invalidate()} />}
            {org.status === "REJECTED" && create}
          </Block>
          {version && (
            <Block id="profile" title="Profile">
              <OrganizationFields key={version.id} org={org} version={version} readOnly={!editable} onChange={setOrg} />
              <OrganizationDocuments org={org} version={version} readOnly={!editable} onChange={setOrg} />
            </Block>
          )}
          <Block id="payout" title="Payout wallet"><PayoutWallet org={org} onChange={setOrg} /></Block>
          <Block id="team" title="Team"><Members org={org} /></Block>
          {org.myPermissions.includes("org.read") && <Block id="baskets" title="Baskets"><Baskets org={org} /></Block>}
          <div className="flex flex-wrap gap-2 border-t border-line pt-6">
            {org.myPermissions.includes("earnings.read") && <Link href={`/organization/earnings?org=${org.id}`} className={buttonVariants({ variant: "secondary" })}>Earnings</Link>}
            <Link href={`/organization/membership/${row.membershipId}`} className={buttonVariants({ variant: "ghost" })}>Your membership</Link>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/** One wrapper for every state, so the header (and the organization switcher) keeps its identity while data loads. */
function Shell({ badge, switcher, org, actions, wide = false, children }: { badge?: ReactNode; switcher?: ReactNode; org?: OrganizationDetail; actions?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "space-y-10" : "max-w-3xl space-y-8"}>
      <WorkspaceHeader id="org-title" title="Your organization" badge={badge} switcher={switcher} org={org} actions={actions} />
      {children}
    </div>
  );
}

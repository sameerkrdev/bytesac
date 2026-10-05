"use client";

import { MEMBERSHIP_STATUS_LABEL, PAYOUT_WALLET_STATUS_LABEL } from "@repo/app-core";
import type { OrganizationDetail } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, CheckCircle2, Coins, KeyRound, Layers, Settings2, Users, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CreateOrganization } from "@/components/organization/create-organization";
import { useOrgWorkspace, WorkspaceHeader } from "@/components/organization/workspace";
import { ErrorState, LoadingState } from "@/components/layout/states";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";

const REVIEW_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"];
const PENDING_MEMBER = ["PENDING_WALLET_VERIFICATION", "INVITED", "PENDING_DOCUMENTS", "UNDER_REVIEW", "CHANGES_REQUIRED", "REMOVAL_REQUESTED"];

/** The workspace start page: where the organization stands, what needs attention next, and the way into each area. */
export default function OrganizationPage() {
  const { me, row, active, query, org, setOrg, switcher } = useOrgWorkspace();
  const canCreate = me?.permissions.includes("create_manager_organization");
  const header = (badge?: ReactNode) => <WorkspaceHeader id="org-title" title="Overview" org={org} switcher={switcher} badge={badge}
    actions={org?.status === "VERIFIED" ? <Link href={`/organizations/${org.id}`} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "lg:hidden")}>Public page<ArrowUpRight /></Link> : undefined} />;

  if (!row) {
    return (
      <div className="max-w-2xl space-y-8">
        <WorkspaceHeader id="org-title" title="Create your organization" description="Baskets belong to an organization, not to one person. Start with the basics; the rest comes in short steps." />
        {canCreate ? <CreateOrganization onCreated={setOrg} /> : <p className="text-base text-ink">You need approval before you can create an organization. <Link href="/managers/apply" className="underline underline-offset-4">Become a fund manager</Link></p>}
      </div>
    );
  }
  if (!active) {
    return (
      <div className="space-y-8">
        {header(<StatusBadge {...MEMBERSHIP_STATUS_LABEL[row.membershipStatus]} />)}
        <p className="text-base text-ink">Your membership is not active yet. <Link href={`/organization/membership/${row.membershipId}`} className="underline underline-offset-4">Open your membership</Link></p>
      </div>
    );
  }
  if (query.isError) return <div className="space-y-8">{header()}<ErrorState error={query.error} onRetry={() => void query.refetch()} /></div>;
  if (!org) return <div className="space-y-8">{header()}<LoadingState /></div>;
  return <div className="space-y-12">{header()}<Dashboard org={org} canCreate={Boolean(canCreate)} onCreated={setOrg} /></div>;
}

function Dashboard({ org, canCreate, onCreated }: { org: OrganizationDetail; canCreate: boolean; onCreated(o: OrganizationDetail): void }) {
  const q = `?org=${org.id}`;
  const baskets = useQuery({ queryKey: ["organization", org.id, "baskets"], queryFn: () => api.listOrgBaskets(org.id), retry: false });
  const members = useQuery({ queryKey: ["organization", org.id, "members"], queryFn: () => api.listOrganizationMembers(org.id), retry: false });
  const items = baskets.data?.baskets ?? [];
  const live = items.filter((b) => b.status === "ACTIVE").length;
  const inReview = items.filter((b) => b.openVersionStatus === "in_review" || b.openVersionStatus === "approved").length;
  const changes = items.filter((b) => b.openVersionStatus === "changes_required");
  const team = members.data?.members ?? [];
  const activeTeam = team.filter((m) => m.status === "ACTIVE").length;
  const pendingTeam = team.filter((m) => PENDING_MEMBER.includes(m.status)).length;
  const payout = org.payoutWallets[0];
  const canEdit = org.myPermissions.includes("org.edit");
  const editable = canEdit && (org.openVersion?.status === "draft" || org.openVersion?.status === "changes_required");
  const verified = org.status === "VERIFIED";
  const missing = org.missing ? org.missing.fields.length + org.missing.documents.length + (org.missing.payoutWallet ? 1 : 0) : 0;
  const message = (org.status === "CHANGES_REQUIRED" || org.openVersion?.status === "changes_required") ? org.latestMessageToOwner : null;

  const next: { title: string; body: string; href: string; cta: string; tone?: "warning" }[] = [
    ...(message ? [{ title: "Bytesac asked for changes", body: message, href: `/organization/settings${q}`, cta: "Open settings", tone: "warning" as const }] : []),
    ...(editable && !verified && missing > 0 ? [{ title: "Finish your organization profile", body: `${missing} item${missing === 1 ? "" : "s"} left before you can submit for review.`, href: `/organization/settings${q}`, cta: "Continue" }] : []),
    ...(editable && !verified && missing === 0 ? [{ title: "Ready to submit", body: "Everything required is in place. Submit your organization for review.", href: `/organization/settings${q}#submit`, cta: "Review and submit" }] : []),
    ...(org.myPermissions.includes("payout.manage") && payout?.status !== "VERIFIED" ? [{ title: "Set your payout wallet", body: "Manager fees are paid to a Solana wallet you verify with a signature.", href: `/organization/wallets${q}`, cta: "Set wallet" }] : []),
    ...changes.map((b) => ({ title: `${b.name}: changes required`, body: "Bytesac reviewed this version and asked for changes.", href: `/organization/baskets/${b.id}${q}`, cta: "Open basket", tone: "warning" as const })),
    ...(verified && items.length === 0 && org.myPermissions.includes("baskets.manage") ? [{ title: "Create your first basket", body: "Draft a strategy, add its thesis and files, then submit it for review.", href: `/organization/baskets${q}`, cta: "Go to baskets" }] : []),
  ];

  return (
    <>
      {REVIEW_STATUSES.includes(org.status) && <p role="status" className="rounded-tile border border-line bg-surface p-4 text-sm text-ink">Your organization is being reviewed. It is read-only until Bytesac responds.</p>}

      <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={Layers} label="Baskets" href={`/organization/baskets${q}`} value={baskets.data ? String(live) : "—"} hint={baskets.data ? `live · ${inReview} in review · ${items.length - live - inReview} other` : "Loading…"} />
        <Kpi icon={Users} label="Team" href={`/organization/members${q}`} value={members.data ? String(activeTeam) : "—"} hint={members.data ? `active · ${pendingTeam} pending` : "Loading…"} />
        <Kpi icon={Wallet} label="Payout wallet" href={`/organization/wallets${q}`} value={payout ? <StatusBadge {...PAYOUT_WALLET_STATUS_LABEL[payout.status]} /> : "Not set"} hint="Where manager fees are paid" />
        <Kpi icon={CheckCircle2} label="Verification" href={`/organization/settings${q}`} value={verified ? "Verified" : "Not yet"} hint={org.verifiedAt ? `Since ${formatDate(org.verifiedAt)}` : `${org.type === "firm" ? "Firm" : "Individual"} · ${org.jurisdiction}`} />
      </dl>

      <section aria-labelledby="next-title" className="space-y-4">
        <h2 id="next-title" className="type-heading text-ink">Next steps</h2>
        {next.length === 0 ? (
          <p className="flex items-center gap-3 rounded-card border border-line bg-surface p-5 text-sm text-ink"><CheckCircle2 aria-hidden className="size-5 text-success" />Nothing needs you right now.</p>
        ) : (
          <ul className="space-y-2">
            {next.map((n) => (
              <li key={n.title}>
                <Link href={n.href} className={cn("group flex items-center gap-4 rounded-card border bg-surface p-5 transition-colors hover:border-line-strong", n.tone === "warning" ? "border-warning/40" : "border-line")}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{n.title}</span>
                    <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap text-sm text-ink-muted">{n.body}</span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-1 text-sm text-ink-muted group-hover:text-ink sm:inline-flex">{n.cta}<ArrowRight aria-hidden className="size-4" /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="areas-title" className="space-y-4">
        <h2 id="areas-title" className="type-heading text-ink">Your workspace</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Area icon={Layers} href={`/organization/baskets${q}`} title="Baskets" body="Drafts, reviews, versions and files." />
          <Area icon={Users} href={`/organization/members${q}`} title="Team" body="Invite people and set their role." />
          <Area icon={KeyRound} href={`/organization/roles${q}`} title="Roles & access" body="Who can see and change what." />
          <Area icon={Wallet} href={`/organization/wallets${q}`} title="Wallets" body="The payout wallet for manager fees." />
          <Area icon={Settings2} href={`/organization/settings${q}`} title="Settings" body="Profile, private details and documents." />
          {org.myPermissions.includes("earnings.read") && <Area icon={Coins} href={`/organization/earnings${q}`} title="Earnings" body="Settled fees and exports." />}
        </ul>
      </section>

      {org.status === "REJECTED" && canCreate && (
        <section aria-labelledby="again-title" className="space-y-4 border-t border-line pt-8">
          <h2 id="again-title" className="type-heading text-ink">Start a new organization</h2>
          <CreateOrganization onCreated={onCreated} />
        </section>
      )}
    </>
  );
}

function Kpi({ icon: Icon, label, value, hint, href }: { icon: LucideIcon; label: string; value: ReactNode; hint: string; href: string }) {
  return (
    <div className="relative rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-focus">
      <dt className="flex items-center gap-2 text-xs text-ink-faint"><Icon aria-hidden className="size-3.5" /><Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none">{label}</Link></dt>
      <dd className="mt-3 text-2xl font-light tracking-tight text-ink tabular-nums">{value}</dd>
      <dd className="mt-1 text-xs text-ink-muted">{hint}</dd>
    </div>
  );
}

function Area({ icon: Icon, href, title, body }: { icon: LucideIcon; href: string; title: string; body: string }) {
  return (
    <li>
      <Link href={href} className="group flex h-full items-start gap-4 rounded-card border border-line bg-surface p-5 transition-colors hover:border-line-strong">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-muted text-ink-muted group-hover:text-ink"><Icon className="size-4.5" /></span>
        <span className="min-w-0"><span className="block font-medium text-ink">{title}</span><span className="mt-0.5 block text-sm text-ink-muted">{body}</span></span>
      </Link>
    </li>
  );
}

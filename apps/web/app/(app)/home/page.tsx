"use client";

import { MEMBERSHIP_ROLE_LABEL, MEMBERSHIP_STATUS_LABEL, ORGANIZATION_STATUS_LABEL } from "@repo/app-core";
import { useQuery } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import Link from "next/link";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { PageLayout } from "@/components/layout/page-layout";

export default function HomePage() {
  const { data: me } = useMe();
  const approved = me?.permissions.includes("create_manager_organization");
  const orgs = me?.organizations ?? [];
  const org = orgs.find((o) => o.status !== "REJECTED") ?? orgs[0];
  const invitations = useQuery({ queryKey: ["invitations"], queryFn: () => api.myInvitations(), retry: false }).data?.invitations ?? [];
  return (
    <PageLayout id="home-title" title="Home">
      <Card className="rounded-2xl border-border-dark bg-slate">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Compass aria-hidden className="size-10 text-mint" />
          <p className="text-base text-ivory">You&apos;re signed in.</p>
          <Link href="/baskets" className="inline-flex min-h-11 items-center text-sm text-mint underline">Discover baskets</Link>
        </CardContent>
      </Card>
      {invitations.map((i) => (
        <Link key={i.membershipId} href={`/invitations/${i.membershipId}`} className="block min-h-11 rounded-2xl border border-mint/40 bg-slate p-6 hover:border-mint">
          <span className="block font-display text-xl font-semibold text-ivory">Invitation from {i.organization.displayName ?? "an organization"}</span>
          <span className="mt-2 block text-sm text-stone">Join as {MEMBERSHIP_ROLE_LABEL[i.role]}</span>
        </Link>
      ))}
      {org ? (
        <Link href="/organization" className="block min-h-11 rounded-2xl border border-border-dark bg-slate p-6 hover:border-mint">
          <span className="block font-display text-xl font-semibold text-ivory">Your organization</span>
          <span className="mt-2 block"><StatusBadge {...(org.membershipStatus === "ACTIVE" ? ORGANIZATION_STATUS_LABEL[org.status] : MEMBERSHIP_STATUS_LABEL[org.membershipStatus])} /></span>
        </Link>
      ) : approved ? (
        <Card className="rounded-2xl border-border-dark bg-slate">
          <CardContent className="space-y-3 py-6">
            <p className="text-base text-ivory">You&apos;re approved to create a manager organization.</p>
            <Link href="/organization" className="inline-flex min-h-11 items-center text-sm text-mint underline">Create your organization</Link>
          </CardContent>
        </Card>
      ) : (
        <Link href="/managers/apply" className="inline-flex min-h-11 items-center text-sm text-stone underline hover:text-ivory">Become a fund manager</Link>
      )}
    </PageLayout>
  );
}

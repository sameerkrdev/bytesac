"use client";

import { ORGANIZATION_STATUS_LABEL } from "@repo/app-core";
import { Compass } from "lucide-react";
import Link from "next/link";
import { useMe } from "@/components/me-context";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";

export default function HomePage() {
  const { data: me } = useMe();
  const approved = me?.permissions.includes("create_manager_organization");
  const orgs = me?.organizations ?? [];
  const org = orgs.find((o) => o.status !== "REJECTED") ?? orgs[0];
  return (
    <section aria-labelledby="home-title" className="space-y-6">
      <h1 id="home-title" className="font-display text-3xl font-bold text-ivory md:text-4xl">Home</h1>
      <Card className="rounded-2xl border-border-dark bg-slate">
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <Compass aria-hidden className="size-10 text-mint" />
          <p className="text-base text-ivory">You&apos;re signed in. Basket discovery arrives soon.</p>
        </CardContent>
      </Card>
      {org ? (
        <Link href="/organization" className="block min-h-11 rounded-2xl border border-border-dark bg-slate p-6 hover:border-mint">
          <span className="block font-display text-xl font-semibold text-ivory">Your organization</span>
          <span className="mt-2 block"><StatusBadge {...ORGANIZATION_STATUS_LABEL[org.status]} /></span>
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
    </section>
  );
}

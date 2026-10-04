"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useMe } from "@/components/me-context";
import { Earnings } from "@/components/organization/earnings";

export default function EarningsPage() {
  return <Suspense><Page /></Suspense>; // useSearchParams needs a Suspense boundary
}

function Page() {
  const { data: me } = useMe();
  const params = useSearchParams();
  const orgs = (me?.organizations ?? []).filter((o) => o.membershipStatus === "ACTIVE");
  const org = orgs.find((o) => o.id === params.get("org")) ?? orgs[0];
  return org ? <Earnings orgId={org.id} /> : <p className="text-base text-ink">Earnings are for fund manager organizations. <Link href="/organization" className="text-ink underline underline-offset-4">Your organization</Link></p>;
}

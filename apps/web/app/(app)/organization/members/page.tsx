"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";
import { Members } from "@/components/organization/members";
import { OrgPage } from "@/components/organization/org-page";
import { buttonVariants } from "@/components/ui/button";

/** The team. Hiding controls is a convenience; every member action is authorized by the server. */
export default function OrganizationMembersPage() {
  return (
    <OrgPage id="members-title" title="Team" path="/organization/members" description="Everyone in the organization, their role, and what it lets them do."
      actions={(org) => <Link href={`/organization/roles?org=${org.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}><KeyRound />Roles & access</Link>}>
      {({ org }) => (
        <div className="space-y-4">
          <Members org={org} />
          <p className="text-xs text-ink-faint">Basket-level flags (edit, submit, publish, lifecycle, assign) refine what each manager can do on each basket.</p>
        </div>
      )}
    </OrgPage>
  );
}

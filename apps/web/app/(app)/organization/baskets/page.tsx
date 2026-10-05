"use client";

import { Baskets } from "@/components/organization/baskets";
import { OrgPage } from "@/components/organization/org-page";

/** The organization's baskets by lifecycle stage, with create. Baskets belong to the organization, not to a manager. */
export default function OrganizationBasketsPage() {
  return (
    <OrgPage id="baskets-title" title="Baskets" path="/organization/baskets"
      description="Drafts are private. A version becomes public only after Bytesac reviews it and a manager with publish rights publishes it — published versions never change.">
      {({ org }) => (org.myPermissions.includes("org.read") ? <Baskets org={org} /> : <p className="text-ink-muted">Your role can&apos;t read this organization&apos;s baskets.</p>)}
    </OrgPage>
  );
}

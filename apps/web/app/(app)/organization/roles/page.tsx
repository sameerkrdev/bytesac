"use client";

import { OrgPage } from "@/components/organization/org-page";
import { Roles } from "@/components/organization/roles";

/** Roles & access: the permission matrix and the organization's custom roles (ADR-019). */
export default function OrganizationRolesPage() {
  return (
    <OrgPage id="roles-title" title="Roles & access" path="/organization/roles" description="Who can see what, and who can change what, in this organization.">
      {({ org }) => <Roles org={org} />}
    </OrgPage>
  );
}

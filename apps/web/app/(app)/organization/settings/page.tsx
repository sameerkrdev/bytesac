"use client";

import { ChangeRequest } from "@/components/organization/change-request";
import { OrganizationDocuments } from "@/components/organization/organization-documents";
import { OrganizationFields } from "@/components/organization/organization-fields";
import { OrgPage } from "@/components/organization/org-page";
import { SubmitChecklist } from "@/components/organization/submit-checklist";
import { PageSection } from "@/components/layout/page-layout";

/** The organization's profile, private details and documents, edited as a draft and reviewed by Bytesac. */
export default function OrganizationSettingsPage() {
  return (
    <OrgPage id="settings-title" title="Settings" path="/organization/settings" description="Your organization's profile and documents. Changes are drafts until Bytesac reviews them.">
      {({ org, setOrg, invalidate }) => {
        const version = org.openVersion ?? org.currentVersion;
        const canEdit = org.myPermissions.includes("org.edit");
        const editable = canEdit && (org.openVersion?.status === "draft" || org.openVersion?.status === "changes_required");
        return (
          <div className="space-y-12">
            {org.status === "VERIFIED" && canEdit && <ChangeRequest org={org} onChange={setOrg} />}
            {!canEdit && <p role="status" className="rounded-tile border border-line bg-surface p-4 text-sm text-ink">You have read-only access. Only the owner edits the organization.</p>}
            {version && (
              <PageSection id="profile" title="Profile and details" description={editable ? "Three short steps: public profile, private details, review." : undefined}>
                <OrganizationFields key={version.id} org={org} version={version} readOnly={!editable} onChange={setOrg} />
              </PageSection>
            )}
            {version && (
              <PageSection id="documents" title="Documents" description="Private. Only you and the Bytesac review team can open them.">
                <OrganizationDocuments org={org} version={version} readOnly={!editable} onChange={setOrg} />
              </PageSection>
            )}
            {editable && <PageSection id="submit" title="Submit for review"><SubmitChecklist org={org} onChange={setOrg} onIncomplete={() => void invalidate()} /></PageSection>}
          </div>
        );
      }}
    </OrgPage>
  );
}

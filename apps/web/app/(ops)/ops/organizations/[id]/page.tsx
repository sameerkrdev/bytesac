import { OrganizationReviewView } from "@/components/ops/organization-review";

export default async function OpsOrganizationPage({ params }: { params: Promise<{ id: string }> }) {
  return <OrganizationReviewView id={(await params).id} />;
}

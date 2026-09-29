import { ApplicationDetailView } from "@/components/ops/application-detail";

export default async function OpsApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  return <ApplicationDetailView id={(await params).id} />;
}

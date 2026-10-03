import { CreateAssetForm } from "@/components/ops/assets/asset-form";
import { PageHeader } from "@/components/layout/page-layout";

export default function OpsNewAssetPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="New asset" breadcrumb={[{ label: "Ops", href: "/ops/applications" }, { label: "Assets", href: "/ops/assets" }]} />
      <CreateAssetForm />
    </div>
  );
}

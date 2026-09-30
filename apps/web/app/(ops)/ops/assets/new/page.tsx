import { CreateAssetForm } from "@/components/ops/assets/asset-form";

export default function OpsNewAssetPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold text-ivory">New asset</h1>
      <CreateAssetForm />
    </div>
  );
}

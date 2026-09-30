import { AssetEditor } from "@/components/ops/assets/asset-editor";

export default async function OpsAssetPage({ params }: { params: Promise<{ id: string }> }) {
  return <AssetEditor id={(await params).id} />;
}

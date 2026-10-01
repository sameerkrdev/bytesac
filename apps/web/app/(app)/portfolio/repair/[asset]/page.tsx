import { RepairPanel } from "@/components/portfolio/repair-panel";

export default async function RepairPage({ params }: { params: Promise<{ asset: string }> }) {
  return <RepairPanel asset={(await params).asset} />;
}

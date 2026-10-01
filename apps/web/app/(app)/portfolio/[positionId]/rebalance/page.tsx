import { RebalanceReview } from "@/components/portfolio/rebalance-review";

export default async function RebalancePage({ params, searchParams }: { params: Promise<{ positionId: string }>; searchParams: Promise<{ target?: string }> }) {
  const [{ positionId }, { target }] = await Promise.all([params, searchParams]);
  return <RebalanceReview positionId={positionId} target={target === "applied" ? "applied" : "latest"} />;
}

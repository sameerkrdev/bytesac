import { BasketReview } from "@/components/ops/baskets/basket-review";

export default async function OpsBasketPage({ params }: { params: Promise<{ bid: string }> }) {
  return <BasketReview bid={(await params).bid} />;
}

import { z } from "@repo/validator";
import { notFound } from "next/navigation";
import { BasketWizard } from "@/components/baskets/basket-wizard";

export default async function BasketPage({ params }: { params: Promise<{ bid: string }> }) {
  const { bid } = await params;
  if (!z.uuid().safeParse(bid).success) notFound();
  return <BasketWizard bid={bid} />;
}

import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { InvestWizard } from "@/components/invest/invest-wizard";
import { ErrorState, LoadingState } from "@/components/states/states";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";

export default function InvestScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const inv = useQuery({ queryKey: ["investability", slug], queryFn: () => api.getInvestability(slug), retry: false });
  const basket = useQuery({ queryKey: ["basket", slug], queryFn: () => api.getPublicBasket(slug) });
  const b = basket.data && !("redirectTo" in basket.data) ? basket.data : null;
  return (
    <Screen edges={["left", "right"]}>
      {(inv.isPending || basket.isPending) && <LoadingState />}
      {inv.isError && <ErrorState error={inv.error} onRetry={() => void inv.refetch()} />}
      {basket.isError && <ErrorState error={basket.error} onRetry={() => void basket.refetch()} />}
      {inv.data && b && (
        <InvestWizard basketId={inv.data.basketId} name={b.version.name} minimumUsdc={b.version.minimumInvestmentUsdc} incrementUsdc={b.version.minimumIncrementUsdc}
          assets={b.allocation.map((a) => ({ instrumentId: a.instrumentId, symbol: a.symbol, name: a.name, bps: a.targetWeightBps, logoUrl: a.logoUrl }))} />
      )}
    </Screen>
  );
}

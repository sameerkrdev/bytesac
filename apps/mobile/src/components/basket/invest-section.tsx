import { INELIGIBLE_ACTION } from "@repo/app-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { View } from "react-native";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

const ROUTE = { profile: "/(app)/(tabs)/profile", portfolio: "/(app)/(tabs)/portfolio" } as const;

/** Invest when the basket is investable and the user is eligible; otherwise the reason, with a button to fix it. The server decides; this only shows it. */
export function InvestSection({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const inv = useQuery({ queryKey: ["investability", slug], queryFn: () => api.getInvestability(slug), retry: false });
  if (inv.isPending) return <LoadingState />;
  if (!inv.data) return <Button disabled onPress={() => undefined}>Investing is unavailable right now</Button>;
  const { investable, reasons, eligibility } = inv.data;
  if (!investable) {
    return (
      <View className="gap-2">
        <Button disabled onPress={() => undefined}>Not investable yet</Button>
        {reasons.map((r) => <AppText key={`${r.instrumentId ?? ""}${r.code}`} tone="stone">{r.message}</AppText>)}
      </View>
    );
  }
  if (!eligibility || eligibility.eligible) return <Button onPress={() => router.push(`/invest/${slug}`)}>Invest</Button>;
  const seen = new Set<string>();
  return (
    <View className="gap-3">
      <Button disabled onPress={() => undefined}>Invest</Button>
      {eligibility.reasons.map((r) => {
        if (r.code === "DECLARATION_REQUIRED") {
          if (seen.has(r.code)) return null;
          seen.add(r.code);
          return (
            <View key={r.code} className="gap-3">
              <AppText tone="stone">{r.message}</AppText>
              <DeclarationForm onSaved={() => void qc.invalidateQueries({ queryKey: ["investability", slug] })} />
            </View>
          );
        }
        const a = INELIGIBLE_ACTION[r.code];
        return a
          ? <Button key={`${r.instrumentId ?? ""}${r.code}`} variant="secondary" onPress={() => router.push(ROUTE[a.target])}>{a.label}</Button>
          : <AppText key={`${r.instrumentId ?? ""}${r.code}`} tone="stone">{r.message}</AppText>;
      })}
    </View>
  );
}

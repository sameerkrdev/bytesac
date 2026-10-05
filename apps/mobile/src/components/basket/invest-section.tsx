import { INELIGIBLE_ACTION } from "@repo/app-core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { View } from "react-native";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const ROUTE = { profile: "/(app)/(tabs)/profile", portfolio: "/(app)/(tabs)/portfolio" } as const;

/** The server's verdict on investing in this basket for this user (shared by the sticky bar and the blockers card). */
export const useInvestability = (slug: string) => useQuery({ queryKey: ["investability", slug], queryFn: () => api.getInvestability(slug), retry: false });

/** The sticky footer: minimum and the Invest action. Disabled, with a short reason, when the server says no. The server decides; this only shows it. */
export function InvestBar({ slug, minimum }: { slug: string; minimum: string | null }) {
  const inv = useInvestability(slug);
  const ready = inv.data?.investable && (!inv.data.eligibility || inv.data.eligibility.eligible);
  const label = inv.isPending ? "Checking…" : !inv.data ? "Investing is unavailable right now" : !inv.data.investable ? "Not investable yet" : "Invest";
  return (
    <View className="flex-row items-center gap-4">
      <View className="gap-0.5">
        <AppText variant="micro" tone="faint">Minimum</AppText>
        <AppText className="font-medium">{minimum ? `${minimum} USDC` : "Not set"}</AppText>
      </View>
      <Button size="lg" className="flex-1" disabled={!ready} loading={inv.isPending} onPress={() => router.push(`/invest/${slug}`)}>{label}</Button>
    </View>
  );
}

/** Why you cannot invest yet, with a button to fix each reason (or the declaration form inline). Nothing when you can. */
export function InvestBlockers({ slug }: { slug: string }) {
  const { colors } = useTheme();
  const qc = useQueryClient();
  const inv = useInvestability(slug);
  if (!inv.data) return null;
  const { investable, reasons, eligibility } = inv.data;
  const items = !investable ? reasons : eligibility && !eligibility.eligible ? eligibility.reasons : [];
  if (items.length === 0) return null;
  const seen = new Set<string>();
  return (
    <View accessibilityLabel="Before you can invest" className="gap-3 rounded-card border border-warning/30 bg-warning-soft p-5">
      <View className="flex-row items-center gap-2">
        <ShieldAlert size={16} color={colors.warning} />
        <AppText variant="heading" accessibilityRole="header">{investable ? "Before you can invest" : "Not open for investment"}</AppText>
      </View>
      {items.map((r) => {
        const key = `${r.instrumentId ?? ""}${r.code}`;
        if (!investable) return <AppText key={key} tone="muted">{r.message}</AppText>;
        if (r.code === "DECLARATION_REQUIRED") {
          if (seen.has(r.code)) return null;
          seen.add(r.code);
          return (
            <View key={r.code} className="gap-3">
              <AppText tone="muted">{r.message}</AppText>
              <DeclarationForm onSaved={() => void qc.invalidateQueries({ queryKey: ["investability", slug] })} />
            </View>
          );
        }
        const a = INELIGIBLE_ACTION[r.code];
        return a
          ? <Button key={key} variant="secondary" onPress={() => router.push(ROUTE[a.target])}>{a.label}</Button>
          : <AppText key={key} tone="muted">{r.message}</AppText>;
      })}
    </View>
  );
}

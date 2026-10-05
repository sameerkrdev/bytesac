import { positionValue, usd } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, type OperationView } from "@repo/validator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { PlanFlow } from "@/components/operation/plan-flow";
import { ErrorState, ErrorText, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { AssetStack } from "@/components/ui/asset-mark";
import { Screen } from "@/components/ui/screen";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { isDeclarationRequired } from "@/lib/errors";
import { newKey } from "@/lib/idempotency";

const PRESETS = [25, 50, 75, 100] as const;

/** Sell part or all of a position back to USDC ("Sell to USDC" for an open one, "Sell former assets" for a closed one). The plan lists tokenized assets it leaves out. */
export default function SellScreen() {
  const { positionId } = useLocalSearchParams<{ positionId: string }>();
  const [percent, setPercent] = useState("100");
  const [key, setKey] = useState(newKey);
  const [plan, setPlan] = useState<OperationView | null>(null);
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const position = [...(portfolio.data?.positions ?? []), ...(portfolio.data?.formerPositions ?? [])].find((p) => p.id === positionId);
  const n = Number(percent);
  const valid = /^\d{1,3}$/.test(percent) && n >= 1 && n <= 100;
  const preview = useMutation({ mutationFn: () => api.sellPlan({ positionId, percent: n, slippageBps: SLIPPAGE_DEFAULT_BPS, idempotencyKey: key }), onSuccess: setPlan });
  const change = (v: string) => { setPercent(v.trim()); setKey(newKey()); };

  if (portfolio.isPending) return <Screen edges={["left", "right"]}><LoadingState /></Screen>;
  if (!position) return <Screen edges={["left", "right"]}><ErrorState error={portfolio.error ?? new Error("not found")} onRetry={() => void portfolio.refetch()} /></Screen>;
  const label = position.status === "OPEN" ? "Sell to USDC" : "Sell former assets";
  const value = positionValue(position);
  return (
    <Screen edges={["left", "right"]} eyebrow={position.basketName} title={label}
      description="Each asset is sold back to USDC on Solana in your own wallets. You sign every step. Never more than your wallet holds is sold.">
      {plan ? (
        <PlanFlow plan={plan} onDiscarded={() => setPlan(null)}
          extra={<AppText variant="label" tone="faint">{plan.legs[0]?.kind === "network_fee" ? "Fees are paid first from the USDC already in your wallet." : "Fees are taken from your proceeds."}</AppText>}
          note={`Outputs are estimates, protected by a minimum per step (${SLIPPAGE_DEFAULT_BPS / 100}% slippage). Prices are re-quoted when you sign each step.`} />
      ) : (
        <View className="gap-6">
          <View className="gap-4 rounded-card border border-line bg-surface p-5">
            <View className="flex-row items-center justify-between gap-3">
              <AssetStack symbols={position.holdings.map((h) => h.symbol)} size={30} max={4} />
              {value !== null && valid ? (
                <View className="items-end gap-0.5">
                  <AppText variant="micro" tone="faint">About, at current prices</AppText>
                  <AppText variant="heading">{usd((value * n) / 100)}</AppText>
                </View>
              ) : null}
            </View>
            <View accessibilityRole="radiogroup" className="flex-row gap-2">
              {PRESETS.map((v) => {
                const on = percent === String(v);
                return (
                  <Pressable key={v} accessibilityRole="button" accessibilityLabel={`${v}%`} accessibilityState={{ selected: on }} onPress={() => change(String(v))}
                    className={`min-h-14 flex-1 items-center justify-center rounded-tile border ${on ? "border-primary bg-primary" : "border-line bg-surface-muted"}`}>
                    <AppText variant="heading" tone={on ? "primaryInk" : "ink"}>{`${v}%`}</AppText>
                  </Pressable>
                );
              })}
            </View>
            <TextField label="Percent to sell" value={percent} keyboardType="number-pad" error={valid ? null : "Enter a whole number from 1 to 100."} onChangeText={change} />
          </View>
          <Button size="lg" disabled={!valid} loading={preview.isPending} onPress={() => preview.mutate()}>Get preview</Button>
          <AppText variant="micro" tone="faint" className="text-center">The preview lists every sale, the minimum you receive and the fees. Nothing is sold until you sign.</AppText>
        </View>
      )}
      {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
      {!isDeclarationRequired(preview.error) && <ErrorText error={preview.error} />}
    </Screen>
  );
}


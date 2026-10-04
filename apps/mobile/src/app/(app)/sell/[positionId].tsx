import { SLIPPAGE_DEFAULT_BPS, type OperationView } from "@repo/validator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { PlanFlow } from "@/components/operation/plan-flow";
import { ErrorState, ErrorText, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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

  if (portfolio.isPending) return <Screen><LoadingState /></Screen>;
  if (!position) return <Screen><ErrorState error={portfolio.error ?? new Error("not found")} onRetry={() => void portfolio.refetch()} /></Screen>;
  const label = position.status === "OPEN" ? "Sell to USDC" : "Sell former assets";
  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">{label}</AppText>
      <AppText tone="faint">{position.basketName}. Each asset is sold back to USDC on Solana in your own wallets. You sign every step. Never more than your wallet holds is sold.</AppText>
      {plan ? (
        <PlanFlow plan={plan} onDiscarded={() => setPlan(null)}
          extra={<AppText variant="label" tone="faint">{plan.legs[0]?.kind === "network_fee" ? "Fees are paid first from the USDC already in your wallet." : "Fees are taken from your proceeds."}</AppText>}
          note={`Outputs are estimates, protected by a minimum per step (${SLIPPAGE_DEFAULT_BPS / 100}% slippage). Prices are re-quoted when you sign each step.`} />
      ) : (
        <View className="gap-4">
          <View className="flex-row flex-wrap gap-2">{PRESETS.map((v) => <Chip key={v} label={`${v}%`} selected={percent === String(v)} onPress={() => change(String(v))} />)}</View>
          <TextField label="Percent to sell" value={percent} keyboardType="number-pad" error={valid ? null : "Enter a whole number from 1 to 100."} onChangeText={change} />
          <Button disabled={!valid} loading={preview.isPending} onPress={() => preview.mutate()}>Get preview</Button>
        </View>
      )}
      {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
      {!isDeclarationRequired(preview.error) && <ErrorText error={preview.error} />}
    </Screen>
  );
}

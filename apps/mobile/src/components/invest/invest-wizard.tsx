import { investAmountProblem } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, SLIPPAGE_MAX_BPS, type OperationView } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { PlanFlow } from "@/components/operation/plan-flow";
import { ErrorText } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { isDeclarationRequired } from "@/lib/errors";
import { newKey } from "@/lib/idempotency";

/** Amount and slippage, then the plan preview (legs, route fees, price impact, minimums, fees), then signing leg by leg. Nothing is signed before the preview. */
export function InvestWizard({ basketId, name, minimumUsdc, incrementUsdc }: { basketId: string; name: string; minimumUsdc: string | null; incrementUsdc: string | null }) {
  const [amount, setAmount] = useState(minimumUsdc ?? "");
  const [slippage, setSlippage] = useState(String(SLIPPAGE_DEFAULT_BPS / 100));
  // A new key per input change: the same key with different inputs is refused, and a repeated tap with the same inputs returns the same plan.
  const [key, setKey] = useState(newKey);
  const [plan, setPlan] = useState<OperationView | null>(null);

  const bps = Math.round(Number(slippage) * 100);
  const problem = investAmountProblem(amount, minimumUsdc, incrementUsdc);
  const slippageProblem = Number.isFinite(bps) && bps >= 1 && bps <= SLIPPAGE_MAX_BPS ? null : `Slippage must be between 0.01% and ${SLIPPAGE_MAX_BPS / 100}%.`;
  const preview = useMutation({ mutationFn: () => api.investPlan({ basketId, amountUsdc: amount, slippageBps: bps, idempotencyKey: key }), onSuccess: setPlan });

  return (
    <View className="gap-5">
      <AppText variant="title" accessibilityRole="header">Invest in {name}</AppText>
      <AppText tone="faint">You sign every step in your own wallets. Bytesac never moves your funds on its own.</AppText>
      {plan ? (
        <PlanFlow plan={plan} onDiscarded={() => setPlan(null)}
          note={`Outputs are estimates; each step is protected by a minimum you will receive (${slippage}% slippage). Prices are re-quoted when you sign each step.`} />
      ) : (
        <View className="gap-4">
          <TextField label="Amount (USDC on Solana)" value={amount} keyboardType="decimal-pad" error={amount !== "" ? problem : null}
            helper={`Minimum ${minimumUsdc ?? "not set"} USDC${incrementUsdc ? `, in steps of ${incrementUsdc} USDC` : ""}. The fees are taken from this amount.`}
            onChangeText={(t) => { setAmount(t.trim()); setKey(newKey()); }} />
          <TextField label="Slippage tolerance (%)" value={slippage} keyboardType="decimal-pad" error={slippageProblem}
            helper="The most a price may move against you per step. Default 1%, at most 3%."
            onChangeText={(t) => { setSlippage(t.trim()); setKey(newKey()); }} />
          <Button disabled={problem !== null || slippageProblem !== null} loading={preview.isPending} onPress={() => preview.mutate()}>Get preview</Button>
        </View>
      )}
      {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
      {!isDeclarationRequired(preview.error) && <ErrorText error={preview.error} />}
    </View>
  );
}

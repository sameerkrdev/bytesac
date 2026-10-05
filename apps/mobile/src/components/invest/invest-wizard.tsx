import { formatBps, investAmountProblem } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, SLIPPAGE_MAX_BPS, type OperationView } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { PlanFlow } from "@/components/operation/plan-flow";
import { ErrorText } from "@/components/states/states";
import { useSliceColor } from "@/components/ui/allocation-ring";
import { AppText } from "@/components/ui/app-text";
import { AssetMark } from "@/components/ui/asset-mark";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { isDeclarationRequired } from "@/lib/errors";
import { newKey } from "@/lib/idempotency";

export type WizardAsset = { instrumentId: string; symbol: string; name: string; bps: number; logoUrl: string | null };

const STEPS = ["Amount", "Review", "Sign"] as const;
const SLIPPAGES = ["0.5", "1", "2", "3"] as const;

/** Where you are: amount, then the plan review, then signing (the plan screen hands over to signing itself). */
function Stepper({ at }: { at: 0 | 1 | 2 }) {
  return (
    <View accessibilityLabel={`Step ${at + 1} of 3, ${STEPS[at]}`} className="flex-row gap-2">
      {STEPS.map((s, i) => (
        <View key={s} className="flex-1 gap-1.5">
          <View className={`h-1 rounded-pill ${i <= at ? "bg-primary" : "bg-line-strong"}`} />
          <AppText variant="micro" tone={i === at ? "ink" : "faint"}>{s}</AppText>
        </View>
      ))}
    </View>
  );
}

/** A quick amount is offered only when the shared rule accepts it (minimum and increment). */
function quickAmounts(min: string | null, inc: string | null) {
  const base = Number(min ?? "0") || 100;
  return [1, 2, 5, 10].map((k) => String(base * k)).filter((a) => investAmountProblem(a, min, inc) === null);
}

/** The basket's target split applied to the amount: an illustration before fees; the preview has the real routes and amounts. */
function SplitPreview({ assets, amount }: { assets: WizardAsset[]; amount: number }) {
  const color = useSliceColor();
  return (
    <View accessibilityLabel="Target split of your amount" className="gap-3 rounded-card border border-line bg-surface p-5">
      <View className="gap-1">
        <AppText variant="eyebrow" tone="faint">Target split</AppText>
        <AppText variant="label" tone="muted">How the basket's target weights divide this amount, before fees. The preview shows the exact routes and minimums.</AppText>
      </View>
      <View className="h-2 flex-row overflow-hidden rounded-pill">
        {assets.map((a, i) => <View key={a.instrumentId} style={{ flex: a.bps, backgroundColor: color(i) }} />)}
      </View>
      {assets.map((a, i) => (
        <View key={a.instrumentId} className="flex-row items-center gap-3">
          <AssetMark symbol={a.symbol} logoUrl={a.logoUrl} size={26} index={i} />
          <AppText className="flex-1" numberOfLines={1}>{a.name} <AppText tone="faint">{formatBps(a.bps)}</AppText></AppText>
          <AppText className="font-medium">{`≈ ${((amount * a.bps) / 10_000).toFixed(2)} USDC`}</AppText>
        </View>
      ))}
    </View>
  );
}

/** Amount and slippage, then the plan preview (legs, route fees, price impact, minimums, fees), then signing leg by leg. Nothing is signed before the preview. */
export function InvestWizard({ basketId, name, minimumUsdc, incrementUsdc, assets = [] }: { basketId: string; name: string; minimumUsdc: string | null; incrementUsdc: string | null; assets?: WizardAsset[] }) {
  const [amount, setAmount] = useState(minimumUsdc ?? "");
  const [slippage, setSlippage] = useState(String(SLIPPAGE_DEFAULT_BPS / 100));
  const [custom, setCustom] = useState(false);
  // A new key per input change: the same key with different inputs is refused, and a repeated tap with the same inputs returns the same plan.
  const [key, setKey] = useState(newKey);
  const [plan, setPlan] = useState<OperationView | null>(null);
  const [signing, setSigning] = useState(false);

  const bps = Math.round(Number(slippage) * 100);
  const problem = investAmountProblem(amount, minimumUsdc, incrementUsdc);
  const slippageProblem = Number.isFinite(bps) && bps >= 1 && bps <= SLIPPAGE_MAX_BPS ? null : `Slippage must be between 0.01% and ${SLIPPAGE_MAX_BPS / 100}%.`;
  const preview = useMutation({ mutationFn: () => api.investPlan({ basketId, amountUsdc: amount, slippageBps: bps, idempotencyKey: key }), onSuccess: setPlan });
  const setAmountTo = (t: string) => { setAmount(t.trim()); setKey(newKey()); };
  const setSlippageTo = (t: string) => { setSlippage(t.trim()); setKey(newKey()); };

  return (
    <View className="gap-6">
      <Stepper at={signing ? 2 : plan ? 1 : 0} />
      <View className="gap-1">
        <AppText variant="title" accessibilityRole="header">Invest in {name}</AppText>
        <AppText tone="muted">You sign every step in your own wallets. Bytesac never moves your funds on its own.</AppText>
      </View>
      {plan ? (
        <PlanFlow plan={plan} onDiscarded={() => setPlan(null)} onSigning={() => setSigning(true)}
          note={`Outputs are estimates; each step is protected by a minimum you will receive (${slippage}% slippage). Prices are re-quoted when you sign each step.`} />
      ) : (
        <View className="gap-6">
          <View className="gap-3">
            <TextField size="lg" label="Amount (USDC on Solana)" value={amount} keyboardType="decimal-pad" error={amount !== "" ? problem : null}
              helper={`Minimum ${minimumUsdc ?? "not set"} USDC${incrementUsdc ? `, in steps of ${incrementUsdc} USDC` : ""}. The fees are taken from this amount.`}
              onChangeText={setAmountTo} />
            <View className="flex-row flex-wrap gap-2">
              {quickAmounts(minimumUsdc, incrementUsdc).map((a) => <Chip key={a} label={`${a} USDC`} selected={amount === a} onPress={() => setAmountTo(a)} />)}
            </View>
          </View>

          {assets.length > 0 && problem === null ? <SplitPreview assets={assets} amount={Number(amount)} /> : null}

          <View className="gap-3">
            <View className="flex-row items-center justify-between">
              <AppText variant="label">Slippage tolerance</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel={custom ? "Use a preset slippage" : "Enter a custom slippage"} onPress={() => setCustom(!custom)} className="min-h-11 justify-center">
                <AppText variant="label" tone="accent">{custom ? "Presets" : "Custom"}</AppText>
              </Pressable>
            </View>
            {custom ? (
              <TextField label="Slippage tolerance (%)" value={slippage} keyboardType="decimal-pad" error={slippageProblem}
                helper="The most a price may move against you per step. Default 1%, at most 3%." onChangeText={setSlippageTo} />
            ) : (
              <>
                <View className="flex-row gap-2">
                  {SLIPPAGES.map((p) => <Chip key={p} label={`${p}%`} selected={slippage === p} onPress={() => setSlippageTo(p)} />)}
                </View>
                <AppText variant="micro" tone="faint">The most a price may move against you per step. Default 1%, at most 3%.</AppText>
              </>
            )}
          </View>

          <Button size="lg" disabled={problem !== null || slippageProblem !== null} loading={preview.isPending} onPress={() => preview.mutate()}>Get preview</Button>
          <AppText variant="micro" tone="faint" className="text-center">The preview creates an unsigned plan. Nothing is sent until you approve each step in your wallet.</AppText>
        </View>
      )}
      {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
      {!isDeclarationRequired(preview.error) && <ErrorText error={preview.error} />}
    </View>
  );
}

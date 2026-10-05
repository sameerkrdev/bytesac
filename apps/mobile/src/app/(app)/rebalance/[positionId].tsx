import { ApiError } from "@repo/api-client";
import { formatBps } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, type OperationView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ArrowRight, CircleCheck, Quote } from "lucide-react-native";
import { View } from "react-native";
import { diffLines } from "@/components/basket/basket-sections";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { PlanFlow } from "@/components/operation/plan-flow";
import { ErrorState, ErrorText, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { AssetMark } from "@/components/ui/asset-mark";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { isDeclarationRequired } from "@/lib/errors";
import { newKey } from "@/lib/idempotency";
import { useTheme } from "@/lib/theme";

const pct = (bps: number | null) => (bps === null ? "n/a" : formatBps(bps));

/** Now (filled) against target (outlined marker) on one 0–100% track. */
function WeightDiff({ now, target }: { now: number | null; target: number | null }) {
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="h-2 rounded-pill bg-surface-muted">
      <View className="h-2 rounded-pill bg-ink-faint" style={{ width: `${Math.min((now ?? 0) / 100, 100)}%` }} />
      {target !== null ? <View className="absolute -top-1 h-4 w-1 rounded-pill bg-primary" style={{ left: `${Math.min(target / 100, 99)}%` }} /> : null}
    </View>
  );
}

/** Review a basket update (latest) or a rebalance to the version already applied (applied), then plan it and sign every step. Nothing is created until "Create plan". */
export default function RebalanceScreen() {
  const { positionId, target: raw } = useLocalSearchParams<{ positionId: string; target?: string }>();
  const target = raw === "applied" ? "applied" : "latest";
  const qc = useQueryClient();
  const { colors } = useTheme();
  const [key] = useState(newKey);
  const [plan, setPlan] = useState<OperationView | null>(null);
  const [aligned, setAligned] = useState(false);
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  const create = useMutation({
    mutationFn: () => api.rebalance({ positionId, target, slippageBps: SLIPPAGE_DEFAULT_BPS, idempotencyKey: key }),
    onSuccess: (r) => { if ("aligned" in r) { setAligned(true); void qc.invalidateQueries({ queryKey: ["portfolio"] }); } else setPlan(r); },
  });
  const skip = useMutation({
    mutationFn: (versionId: string) => api.skipVersion(positionId, { versionId }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["portfolio"] }); router.replace("/(app)/(tabs)/portfolio"); },
  });

  if (portfolio.isPending) return <Screen edges={["left", "right"]}><LoadingState /></Screen>;
  const p = portfolio.data?.positions.find((x) => x.id === positionId);
  if (!p) return <Screen edges={["left", "right"]}><ErrorState error={portfolio.error ?? new ApiError("NOT_FOUND", 404, "Position not found.")} onRetry={() => void portfolio.refetch()} /></Screen>;
  const latest = p.latestVersion;
  const names = Object.fromEntries(p.holdings.map((h) => [h.instrumentId, h.symbol]));
  const repairAsset = portfolio.data?.repairs.find((r) => r.positions.some((x) => x.positionId === positionId))?.asset ?? "cash";
  const repairNeeded = create.error instanceof ApiError && create.error.code === "REPAIR_REQUIRED";
  const feeLeg = plan?.legs.find((l) => l.kind === "network_fee");
  const fromCash = (feeLeg?.routeSummary as { fromCash?: boolean } | null)?.fromCash === true;
  const lines = latest ? diffLines(latest.diff, names) : [];

  return (
    <Screen edges={["left", "right"]} eyebrow={p.basketName} title={target === "latest" ? "Review update" : "Rebalance to target"}
      description={target === "latest" ? "Your manager published a new version. You decide whether your basket follows it." : "Your holdings moved away from the version you applied. Bring them back, step by step."}>
      {target === "latest" && latest && (
        <Card className="gap-3">
          <View className="flex-row items-center gap-2">
            <AppText variant="heading">Version {p.appliedVersionNumber} to version {latest.number}</AppText>
          </View>
          {latest.rationale ? (
            <View className="flex-row gap-3 rounded-tile bg-surface-muted p-4">
              <Quote size={16} color={colors.inkFaint} />
              <AppText className="flex-1">{"Manager's reason: "}{latest.rationale}</AppText>
            </View>
          ) : null}
          {lines.length === 0 ? <AppText tone="muted">No changes.</AppText> : lines.map((l) => <AppText key={l} tone="muted">{`• ${l}`}</AppText>)}
        </Card>
      )}

      <View className="gap-3">
        <View className="gap-1">
          <AppText variant="heading" accessibilityRole="header">Current and target weights</AppText>
          <AppText variant="micro" tone="faint">Grey is what your wallet holds now; the blue mark is the target.</AppText>
        </View>
        <Card className="py-1">
          {p.holdings.map((h, i) => (
            <View key={h.deploymentId} accessible accessibilityLabel={`${h.symbol}: now ${pct(h.actualBps)}, target ${pct(h.targetBps)}`}
              className={`gap-2.5 py-3.5 ${i > 0 ? "border-t border-line" : ""}`}>
              <View className="flex-row items-center gap-3">
                <AssetMark symbol={h.symbol} size={28} index={i} />
                <AppText className="flex-1 font-medium">{h.symbol}</AppText>
                <AppText tone="muted">{pct(h.actualBps)}</AppText>
                <ArrowRight size={14} color={colors.inkFaint} />
                <AppText className="font-medium">{pct(h.targetBps)}</AppText>
              </View>
              <WeightDiff now={h.actualBps} target={h.targetBps} />
            </View>
          ))}
        </Card>
      </View>

      {aligned ? (
        <View className="flex-row gap-3 rounded-card border border-success/30 bg-success-soft p-4">
          <CircleCheck size={16} color={colors.success} style={{ marginTop: 3 }} />
          <AppText className="flex-1">Already aligned with this version — recorded.</AppText>
        </View>
      ) : plan ? (
        <PlanFlow plan={plan} onDiscarded={() => setPlan(null)}
          extra={feeLeg ? <AppText variant="label" tone="faint">{`Fees are ${fromCash ? "paid from this basket's sale proceeds" : "paid from your free USDC"}.`}</AppText> : null}
          note={`Sells run first, buys are resized to what your sales actually return. Outputs are estimates, protected by a minimum per step (${SLIPPAGE_DEFAULT_BPS / 100}% slippage). Prices are re-quoted when you sign each step.`} />
      ) : (
        <View className="gap-3 rounded-card border border-line bg-surface p-5">
          <AppText variant="eyebrow" tone="faint">Your choice</AppText>
          <AppText tone="muted">{target === "latest" ? "Create a plan to see the exact trades and fees first, or skip this version and keep your basket as it is." : "Create a plan to see the exact trades and fees first. Nothing is signed until you approve each step."}</AppText>
          <Button size="lg" loading={create.isPending} onPress={() => create.mutate()}>Create plan</Button>
          {target === "latest" && latest && <Button variant="secondary" loading={skip.isPending} onPress={() => skip.mutate(latest.id)}>Skip this version</Button>}
          {target === "latest" && <AppText variant="label" tone="faint" className="text-center">Skipping changes nothing in your wallet.</AppText>}
        </View>
      )}

      {isDeclarationRequired(create.error) && <DeclarationForm onSaved={() => create.mutate()} />}
      {!isDeclarationRequired(create.error) && <ErrorText error={create.error ?? skip.error} />}
      {repairNeeded && <Button variant="secondary" onPress={() => router.push(`/repair/${repairAsset}`)}>Go to repair</Button>}
    </Screen>
  );
}


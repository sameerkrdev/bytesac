import { ApiError } from "@repo/api-client";
import { formatBps } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, type OperationView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { diffLines } from "@/components/basket/basket-sections";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { PlanFlow } from "@/components/operation/plan-flow";
import { ErrorState, ErrorText, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { api } from "@/lib/api";
import { isDeclarationRequired } from "@/lib/errors";
import { newKey } from "@/lib/idempotency";

/** Review a basket update (latest) or a rebalance to the version already applied (applied), then plan it and sign every step. Nothing is created until "Create plan". */
export default function RebalanceScreen() {
  const { positionId, target: raw } = useLocalSearchParams<{ positionId: string; target?: string }>();
  const target = raw === "applied" ? "applied" : "latest";
  const qc = useQueryClient();
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

  if (portfolio.isPending) return <Screen><LoadingState /></Screen>;
  const p = portfolio.data?.positions.find((x) => x.id === positionId);
  if (!p) return <Screen><ErrorState error={portfolio.error ?? new ApiError("NOT_FOUND", 404, "Position not found.")} onRetry={() => void portfolio.refetch()} /></Screen>;
  const latest = p.latestVersion;
  const names = Object.fromEntries(p.holdings.map((h) => [h.instrumentId, h.symbol]));
  const repairAsset = portfolio.data?.repairs.find((r) => r.positions.some((x) => x.positionId === positionId))?.asset ?? "cash";
  const repairNeeded = create.error instanceof ApiError && create.error.code === "REPAIR_REQUIRED";
  const feeLeg = plan?.legs.find((l) => l.kind === "network_fee");
  const fromCash = (feeLeg?.routeSummary as { fromCash?: boolean } | null)?.fromCash === true;
  const lines = latest ? diffLines(latest.diff, names) : [];

  return (
    <Screen>
      <AppText variant="title" accessibilityRole="header">{target === "latest" ? "Review update" : "Rebalance to target"}</AppText>
      <AppText tone="faint">{p.basketName}</AppText>

      {target === "latest" && latest && (
        <Card className="gap-2">
          <AppText variant="heading">Version {p.appliedVersionNumber} to version {latest.number}</AppText>
          {latest.rationale ? <AppText>{"Manager's reason: "}{latest.rationale}</AppText> : null}
          {lines.length === 0 ? <AppText tone="faint">No changes.</AppText> : lines.map((l) => <AppText key={l}>{`• ${l}`}</AppText>)}
        </Card>
      )}

      <View className="gap-2">
        <AppText variant="heading">Current and target weights</AppText>
        {p.holdings.map((h) => (
          <View key={h.deploymentId} className="flex-row justify-between gap-2">
            <AppText>{h.symbol}</AppText>
            <AppText tone="faint">now {h.actualBps === null ? "n/a" : formatBps(h.actualBps)} · target {h.targetBps === null ? "n/a" : formatBps(h.targetBps)}</AppText>
          </View>
        ))}
      </View>

      {aligned ? <AppText className="rounded-control border border-line p-3">Already aligned with this version — recorded.</AppText> : plan ? (
        <PlanFlow plan={plan} onDiscarded={() => setPlan(null)}
          extra={feeLeg ? <AppText variant="label" tone="faint">{`Fees are ${fromCash ? "paid from this basket's sale proceeds" : "paid from your free USDC"}.`}</AppText> : null}
          note={`Sells run first, buys are resized to what your sales actually return. Outputs are estimates, protected by a minimum per step (${SLIPPAGE_DEFAULT_BPS / 100}% slippage). Prices are re-quoted when you sign each step.`} />
      ) : (
        <View className="gap-3">
          <Button loading={create.isPending} onPress={() => create.mutate()}>Create plan</Button>
          {target === "latest" && latest && <Button variant="secondary" loading={skip.isPending} onPress={() => skip.mutate(latest.id)}>Skip this version</Button>}
          {target === "latest" && <AppText variant="label" tone="faint">Skipping changes nothing in your wallet.</AppText>}
        </View>
      )}

      {isDeclarationRequired(create.error) && <DeclarationForm onSaved={() => create.mutate()} />}
      {!isDeclarationRequired(create.error) && <ErrorText error={create.error ?? skip.error} />}
      {repairNeeded && <Button variant="secondary" onPress={() => router.push(`/repair/${repairAsset}`)}>Go to repair</Button>}
    </Screen>
  );
}

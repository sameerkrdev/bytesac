import { ApiError } from "@repo/api-client";
import { formatUnits, validateSyncSplit } from "@repo/app-core";
import { SLIPPAGE_DEFAULT_BPS, type OperationView, type Repair } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { TriangleAlert } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { DeclarationForm } from "@/components/eligibility/declaration-form";
import { PlanFlow } from "@/components/operation/plan-flow";
import { ErrorState, ErrorText, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { AssetMark } from "@/components/ui/asset-mark";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api";
import { isDeclarationRequired } from "@/lib/errors";
import { newKey } from "@/lib/idempotency";
import { useTheme } from "@/lib/theme";

const exact = (raw: string, decimals: number) => formatUnits(raw, decimals, decimals);

function BuyBack({ repair, decimals }: { repair: Repair; decimals: number }) {
  const [key] = useState(newKey);
  const [plan, setPlan] = useState<OperationView | null>(null);
  const preview = useMutation({ mutationFn: () => api.repair({ deploymentId: repair.asset, slippageBps: SLIPPAGE_DEFAULT_BPS, idempotencyKey: key }), onSuccess: setPlan });
  return (
    <View className="gap-4">
      <AppText tone="muted">Buy back {exact(repair.totalShortfall, decimals)} {repair.symbol} with USDC from your wallet so every basket is fully backed again. You review the cost and sign each step.</AppText>
      {plan
        ? <PlanFlow plan={plan} onDiscarded={() => setPlan(null)} note="Prices are re-quoted when you sign each step." />
        : <Button size="lg" loading={preview.isPending} onPress={() => preview.mutate()}>Get cost preview</Button>}
      {isDeclarationRequired(preview.error) && <DeclarationForm onSaved={() => preview.mutate()} />}
      {!isDeclarationRequired(preview.error) && <ErrorText error={preview.error} />}
    </View>
  );
}

/** Each short basket gives up part of its record so the total matches what the wallet holds. Prefilled with the server's pro-rata shares; Save needs the exact total. */
function Sync({ repair, decimals, onChanged }: { repair: Repair; decimals: number; onChanged(changed: boolean): void }) {
  const [key] = useState(newKey);
  const [text, setText] = useState(() => Object.fromEntries(repair.positions.map((x) => [x.positionId, exact(x.shortfall, decimals)])));
  const { raw, sum, total, valid } = validateSyncSplit(repair.positions.map((x) => text[x.positionId] ?? ""), repair.positions.map((x) => x.ledger), repair.totalShortfall, decimals);
  const save = useMutation({
    mutationFn: () => api.sync({ asset: repair.asset === "cash" ? "cash" : { deploymentId: repair.asset }, split: repair.positions.map((x, n) => ({ positionId: x.positionId, quantity: raw[n]!.toString() })), idempotencyKey: key }),
    onSuccess: () => onChanged(false),
    onError: (e) => { if (e instanceof ApiError && e.code === "SHORTFALL_CHANGED") onChanged(true); },
  });
  const stale = save.error instanceof ApiError && save.error.code === "SHORTFALL_CHANGED";
  return (
    <View className="gap-4">
      <AppText tone="muted">Use this if you moved {repair.symbol} out of your wallet on purpose. Your baskets will record less {repair.symbol}; nothing is bought or sold.</AppText>
      {repair.positions.map((x, n) => (
        <TextField key={x.positionId} label={`${x.basketSlug}: reduce by (${repair.symbol})`} value={text[x.positionId] ?? ""} keyboardType="decimal-pad"
          error={raw[n] === null ? "Enter a number within the decimals of this asset." : null} onChangeText={(t) => setText({ ...text, [x.positionId]: t })} />
      ))}
      <AppText variant="label" tone={sum === total ? "success" : "faint"}>Must add up to {exact(repair.totalShortfall, decimals)} {repair.symbol}</AppText>
      <Button size="lg" disabled={!valid} loading={save.isPending} onPress={() => save.mutate()}>Save</Button>
      {save.isSuccess && <AppText tone="success">Saved. Your baskets now match your wallet.</AppText>}
      {!stale && <ErrorText error={save.error} />}
    </View>
  );
}

/** One short asset (or basket cash) across all the baskets it affects: buy it back, or sync the baskets to the wallet. */
export function RepairPanel({ asset }: { asset: string }) {
  const qc = useQueryClient();
  const { colors } = useTheme();
  const [tab, setTab] = useState<"buy" | "sync">("buy");
  const [changed, setChanged] = useState(false);
  const portfolio = useQuery({ queryKey: ["portfolio"], queryFn: () => api.getPortfolio() });
  if (portfolio.isPending) return <LoadingState />;
  if (portfolio.isError) return <ErrorState error={portfolio.error} onRetry={() => void portfolio.refetch()} />;
  const repair = portfolio.data.repairs.find((r) => r.asset === asset);
  if (!repair) return <View className="gap-4 pt-4"><AppText variant="title">Nothing needs repair here.</AppText><Button variant="secondary" onPress={() => router.replace("/(app)/(tabs)/portfolio")}>Back to portfolio</Button></View>;
  const decimals = repair.asset === "cash" ? 6 : (portfolio.data.positions.flatMap((p) => p.holdings).find((h) => h.deploymentId === repair.asset)?.decimals ?? 0);
  const active = repair.asset === "cash" ? "sync" : tab;
  // Reset the forms when the server's figures change.
  const figures = repair.positions.map((x) => x.shortfall).join(",");

  const modes = [...(repair.asset !== "cash" ? [["buy", "Buy back"] as const] : []), ["sync", "Sync"] as const];

  return (
    <View className="gap-6">
      <View className="gap-3">
        <AssetMark symbol={repair.symbol} size={44} />
        <AppText variant="eyebrow" tone="faint">Repair</AppText>
        <AppText variant="display" accessibilityRole="header">Repair {repair.symbol}</AppText>
        <AppText tone="muted">Your wallet holds {exact(repair.totalShortfall, decimals)} {repair.symbol} less than your baskets record.</AppText>
      </View>
      {changed && (
        <View accessibilityRole="alert" className="flex-row gap-3 rounded-card border border-warning/30 bg-warning-soft p-4">
          <TriangleAlert size={16} color={colors.warning} style={{ marginTop: 3 }} />
          <AppText className="flex-1">Your holdings changed — review the new figures</AppText>
        </View>
      )}
      <View className="rounded-card border border-line bg-surface px-5 py-1">
        {repair.positions.map((x, i) => (
          <View key={x.positionId} className={`gap-1 py-3.5 ${i > 0 ? "border-t border-line" : ""}`}>
            <View className="flex-row items-center justify-between gap-3">
              <AppText className="font-medium">{x.basketSlug}</AppText>
              <AppText tone="danger" className="font-medium">{`−${exact(x.shortfall, decimals)}`}</AppText>
            </View>
            <AppText variant="label" tone="faint">Recorded {exact(x.ledger, decimals)} · allocated {exact((BigInt(x.ledger) - BigInt(x.shortfall)).toString(), decimals)} · short {exact(x.shortfall, decimals)}</AppText>
          </View>
        ))}
      </View>
      {modes.length > 1 ? (
        <View accessibilityRole="radiogroup" className="flex-row rounded-pill bg-surface-muted p-1">
          {modes.map(([k, l]) => (
            <Pressable key={k} accessibilityRole="button" accessibilityLabel={l} accessibilityState={{ selected: active === k }} onPress={() => setTab(k)}
              className={`min-h-11 flex-1 items-center justify-center rounded-pill ${active === k ? "bg-surface shadow-sm" : ""}`}>
              <AppText variant="label" tone={active === k ? "ink" : "muted"}>{l}</AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
      {active === "buy"
        ? <BuyBack key={figures} repair={repair} decimals={decimals} />
        : <Sync key={figures} repair={repair} decimals={decimals} onChanged={(c) => { setChanged(c); void qc.invalidateQueries({ queryKey: ["portfolio"] }); }} />}
    </View>
  );
}

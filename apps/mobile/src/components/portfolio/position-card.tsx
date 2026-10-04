import { ASSET_CHAINS, type Portfolio } from "@repo/validator";
import { formatBps, formatUnits, HEADLINE_LABEL, isSkipped, positionActions, type PositionAction } from "@repo/app-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert, Pressable, View } from "react-native";
import { ErrorText } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";

type Position = Portfolio["positions"][number];

const Bar = ({ label, bps, color }: { label: string; bps: number | null; color: string }) => (
  <View className="flex-row items-center gap-2">
    <AppText variant="label" tone="faint" className="w-14">{label}</AppText>
    <View accessibilityElementsHidden importantForAccessibility="no" className="h-2 flex-1 rounded bg-line"><View className={`h-2 rounded ${color}`} style={{ width: `${Math.min((bps ?? 0) / 100, 100)}%` }} /></View>
    <AppText variant="label" className="w-14 text-right">{bps === null ? "n/a" : formatBps(bps)}</AppText>
  </View>
);

/**
 * One open or former position: value, headline state with its action, actual against target weights, reconciliation notices and exit actions.
 * Nothing here moves assets: every plan is reviewed and signed on its own screen; leave and close make no transaction.
 */
export function PositionCard({ position: p, former = false, repairAsset, openOperationId }: { position: Position; former?: boolean; repairAsset?: string; openOperationId?: string }) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["portfolio"] });
  const keep = useMutation({ mutationFn: () => api.keepCustom(p.id), onSuccess: done });
  const revert = useMutation({ mutationFn: () => api.revertCustom(p.id), onSuccess: done });
  const leave = useMutation({ mutationFn: () => api.leavePosition(p.id), onSuccess: done });
  const close = useMutation({ mutationFn: () => api.closePosition(p.id), onSuccess: done });

  const values = p.holdings.map((h) => h.valueUsd);
  const total = values.length > 0 && values.every((v) => v !== null) ? values.reduce((s, v) => s + Number(v), 0).toFixed(2) : null;
  const short = p.holdings.filter((h) => h.reconciliation === "SHORT");
  const surplus = p.holdings.filter((h) => h.reconciliation === "SURPLUS");
  const dust = !former && total !== null && Number(total) + Number(p.cashMicro) / 1e6 < 1;
  const h = HEADLINE_LABEL[p.headline];
  const skipped = isSkipped(p);
  const confirm = (title: string, body: string, run: () => void) => Alert.alert(title, body, [{ text: "Cancel", style: "cancel" }, { text: title, onPress: run }]);

  const action = (a: PositionAction) => {
    switch (a.kind) {
      case "review": case "rebalance": case "continue": return <Button key={a.kind} variant="secondary" onPress={() => router.push(`/rebalance/${p.id}?target=${a.target}`)}>{a.label}</Button>;
      case "keepCustom": return <Button key={a.kind} variant="secondary" loading={keep.isPending} onPress={() => keep.mutate()}>{a.label}</Button>;
      case "revertCustom": return <Button key={a.kind} variant="secondary" loading={revert.isPending} onPress={() => revert.mutate()}>{a.label}</Button>;
      case "repair": return <Button key={a.kind} variant="secondary" onPress={() => router.push(`/repair/${repairAsset ?? "cash"}`)}>{a.label}</Button>;
      case "viewOperation": return <Button key={a.kind} variant="secondary" onPress={() => router.push(openOperationId ? `/operation/${openOperationId}` : "/(app)/(tabs)/portfolio")}>{a.label}</Button>;
    }
  };

  return (
    <Card className="gap-4">
      <View className="gap-1">
        <Pressable accessibilityRole="link" className="min-h-11 justify-center" onPress={() => router.push(`/basket/${p.basketSlug}`)}>
          <AppText variant="heading" tone="accent" className="underline">{p.basketName}</AppText>
        </Pressable>
        <AppText tone="faint">{former ? `Left ${new Date(p.closedAt ?? p.openedAt).toLocaleDateString()} · assets are in your wallets, outside the basket` : `Opened ${new Date(p.openedAt).toLocaleDateString()}`}</AppText>
        <AppText variant="bodyLarge">{total === null ? "Value unavailable" : `$${total}`}</AppText>
      </View>

      {!former && (
        <View className="gap-3">
          <StatusBadge tone={h.tone === "info" ? "neutral" : h.tone} label={h.label} />
          {skipped && p.latestVersion ? <AppText variant="label" tone="faint">You skipped version {p.latestVersion.number}</AppText> : null}
          <AppText variant="label" tone="faint">Applied version {p.appliedVersionNumber}</AppText>
          {positionActions(p).map(action)}
        </View>
      )}

      {short.length > 0 && <AppText className="rounded-control border border-warning/40 p-3">Your wallet holds less {short.map((x) => x.symbol).join(", ")} than Bytesac recorded for this basket, so part of it may have been moved. Shortfalls are shared across your baskets in proportion. Nothing is bought or sold automatically.</AppText>}
      {surplus.length > 0 && <AppText tone="faint" className="rounded-control border border-line p-3">Extra {surplus.map((x) => x.symbol).join(", ")} in your wallet is outside your baskets.</AppText>}

      <View className="gap-3">
        {p.holdings.map((x) => (
          <View key={x.deploymentId} className="gap-1 border-t border-line pt-3">
            <View className="flex-row flex-wrap justify-between gap-2">
              <AppText>{x.symbol} <AppText tone="faint">on {ASSET_CHAINS[x.chain].label}</AppText></AppText>
              <AppText>{formatUnits(x.quantity, x.decimals)} {x.symbol}{x.valueUsd !== null ? ` · $${x.valueUsd}` : ""}</AppText>
            </View>
            {!former && <><Bar label="Actual" bps={x.actualBps} color="bg-primary" /><Bar label="Target" bps={x.targetBps} color="bg-ink-faint" /></>}
            {x.reconciliation === "SHORT" && <StatusBadge tone="warning" label="Wallet holds less than recorded" />}
            {x.reconciliation === "SURPLUS" && <StatusBadge tone="neutral" label="Extra outside baskets" />}
          </View>
        ))}
        {BigInt(p.cashMicro) > 0n && (
          <View className="flex-row justify-between gap-2 border-t border-line pt-3"><AppText>Cash (USDC)</AppText><AppText>{formatUnits(p.cashMicro, 6)} USDC</AppText></View>
        )}
      </View>

      <View className="gap-3">
        <Button onPress={() => router.push(`/sell/${p.id}`)}>{former ? "Sell former assets" : "Sell to USDC"}</Button>
        {!former && <Button variant="secondary" loading={leave.isPending} onPress={() => confirm("Leave basket", "Your assets stay in your wallets. No transaction is made and nothing is sold. Bytesac stops tracking this basket for you, so it will not be rebalanced or updated. You can sell the former assets to USDC later from your portfolio.", () => leave.mutate())}>Leave basket (keep assets)</Button>}
        {dust && <Button variant="secondary" loading={close.isPending} onPress={() => confirm("Close position", "Remaining tokens stay in your wallet outside this basket.", () => close.mutate())}>Close position</Button>}
      </View>
      <ErrorText error={keep.error ?? revert.error ?? leave.error ?? close.error} />
    </Card>
  );
}

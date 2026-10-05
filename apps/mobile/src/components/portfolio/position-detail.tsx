import { formatBps, formatUnits, HEADLINE_HELP, HEADLINE_LABEL, isSkipped, positionActions, type PositionAction } from "@repo/app-core";
import { ASSET_CHAINS, type Portfolio } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Check, Layers, ScanLine, Target } from "lucide-react-native";
import { Alert, View } from "react-native";
import { ErrorText } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { AssetMark } from "@/components/ui/asset-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/screen";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

type Position = Portfolio["positions"][number];

/** Actual weight against the target, as a track with a target tick. */
function WeightTrack({ actual, target }: { actual: number | null; target: number | null }) {
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="h-2 flex-1 rounded-pill bg-surface-muted">
      <View className="h-2 rounded-pill bg-primary" style={{ width: `${Math.min((actual ?? 0) / 100, 100)}%` }} />
      {target !== null ? <View className="absolute -top-1 h-4 w-0.5 rounded-pill bg-ink-faint" style={{ left: `${Math.min(target / 100, 100)}%` }} /> : null}
    </View>
  );
}

const LAYERS = [
  { Icon: Target, title: "Strategy target", body: "The weights in the version you applied. They change only when you accept a new version." },
  { Icon: Layers, title: "Your basket allocation", body: "How Bytesac attributes your holdings to this basket, kept per basket so several can share a wallet." },
  { Icon: ScanLine, title: "Verified holdings", body: "What your wallets actually hold, read from each chain. Shortfalls and surpluses are flagged per asset." },
];

/**
 * One position: its state explained before any action, weights against target, verified holdings and the exits.
 * Nothing here moves assets: every plan is reviewed and signed on its own screen; leave and close make no transaction.
 */
export function PositionDetail({ position: p, former = false, repairAsset, openOperationId }: { position: Position; former?: boolean; repairAsset?: string; openOperationId?: string }) {
  const { colors } = useTheme();
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

  const action = (a: PositionAction, i: number) => {
    const variant = i === 0 ? "primary" : "secondary";
    switch (a.kind) {
      case "review": case "rebalance": case "continue": return <Button key={a.kind} variant={variant} onPress={() => router.push(`/rebalance/${p.id}?target=${a.target}`)}>{a.label}</Button>;
      case "keepCustom": return <Button key={a.kind} variant={variant} loading={keep.isPending} onPress={() => keep.mutate()}>{a.label}</Button>;
      case "revertCustom": return <Button key={a.kind} variant={variant} loading={revert.isPending} onPress={() => revert.mutate()}>{a.label}</Button>;
      case "repair": return <Button key={a.kind} variant={variant} onPress={() => router.push(`/repair/${repairAsset ?? "cash"}`)}>{a.label}</Button>;
      case "viewOperation": return <Button key={a.kind} variant={variant} onPress={() => router.push(openOperationId ? `/operation/${openOperationId}` : "/(app)/(tabs)/portfolio")}>{a.label}</Button>;
    }
  };

  return (
    <View className="gap-6">
      {!former && (
        <Card className="gap-3">
          <StatusBadge tone={h.tone} label={h.label} />
          <AppText tone="muted">{HEADLINE_HELP[p.headline]}</AppText>
          {skipped && p.latestVersion ? <AppText variant="label" tone="faint">You skipped version {p.latestVersion.number}</AppText> : null}
          <AppText variant="label" tone="faint">Applied version {p.appliedVersionNumber}</AppText>
          <View className="gap-2 pt-1">{positionActions(p).map(action)}</View>
        </Card>
      )}

      {short.length > 0 && <AppText className="rounded-card border border-warning/40 bg-warning-soft p-4">Your wallet holds less {short.map((x) => x.symbol).join(", ")} than Bytesac recorded for this basket, so part of it may have been moved. Shortfalls are shared across your baskets in proportion. Nothing is bought or sold automatically.</AppText>}
      {surplus.length > 0 && <AppText tone="muted" className="rounded-card border border-line p-4">Extra {surplus.map((x) => x.symbol).join(", ")} in your wallet is outside your baskets.</AppText>}

      <Section title={former ? "What was left in your wallets" : "Holdings against the target"} eyebrow={former ? undefined : "Bar: your weight · tick: target"}>
        <Card className="gap-0 p-0">
          {p.holdings.map((x, i) => (
            <View key={x.deploymentId} className={`gap-3 px-5 py-4 ${i > 0 ? "border-t border-line" : ""}`}>
              <View className="flex-row items-center gap-3">
                <AssetMark symbol={x.symbol} size={30} index={i} />
                <View className="flex-1">
                  <AppText className="font-medium">{x.symbol}</AppText>
                  <AppText variant="micro" tone="faint">on {ASSET_CHAINS[x.chain].label}</AppText>
                </View>
                <View className="items-end">
                  <AppText>{formatUnits(x.quantity, x.decimals)} {x.symbol}{x.valueUsd !== null ? ` · $${x.valueUsd}` : ""}</AppText>
                  {x.reconciliation === "OK" ? <View className="flex-row items-center gap-1"><Check size={11} color={colors.success} /><AppText variant="micro" tone="success">Verified in wallet</AppText></View> : null}
                </View>
              </View>
              {!former && (
                <View className="flex-row items-center gap-3">
                  <WeightTrack actual={x.actualBps} target={x.targetBps} />
                  <AppText variant="label" className="font-mono">{x.actualBps === null ? "n/a" : formatBps(x.actualBps)}</AppText>
                  <AppText variant="label" tone="faint" className="font-mono">{x.targetBps === null ? "n/a" : formatBps(x.targetBps)}</AppText>
                </View>
              )}
              {x.reconciliation === "SHORT" && <StatusBadge tone="warning" label="Wallet holds less than recorded" />}
              {x.reconciliation === "SURPLUS" && <StatusBadge tone="neutral" label="Extra outside baskets" />}
            </View>
          ))}
          {BigInt(p.cashMicro) > 0n && (
            <View className="flex-row justify-between gap-2 border-t border-line px-5 py-4"><AppText>Cash (USDC)</AppText><AppText>{formatUnits(p.cashMicro, 6)} USDC</AppText></View>
          )}
        </Card>
      </Section>

      {!former && (
        <Section title="Three layers, never the same">
          <View className="gap-3">
            {LAYERS.map(({ Icon, title, body }) => (
              <View key={title} className="flex-row gap-3">
                <View className="size-9 items-center justify-center rounded-full bg-surface-muted"><Icon size={16} color={colors.inkMuted} /></View>
                <View className="flex-1 gap-0.5"><AppText className="font-medium">{title}</AppText><AppText variant="label" tone="muted">{body}</AppText></View>
              </View>
            ))}
          </View>
        </Section>
      )}

      <Section title="Exit">
        <View className="gap-2">
          <Button variant="secondary" onPress={() => router.push(`/sell/${p.id}`)}>{former ? "Sell former assets" : "Sell to USDC"}</Button>
          {!former && <Button variant="ghost" loading={leave.isPending} onPress={() => confirm("Leave basket", "Your assets stay in your wallets. No transaction is made and nothing is sold. Bytesac stops tracking this basket for you, so it will not be rebalanced or updated. You can sell the former assets to USDC later from your portfolio.", () => leave.mutate())}>Leave basket (keep assets)</Button>}
          {dust && <Button variant="ghost" loading={close.isPending} onPress={() => confirm("Close position", "Remaining tokens stay in your wallet outside this basket.", () => close.mutate())}>Close position</Button>}
        </View>
      </Section>
      <ErrorText error={keep.error ?? revert.error ?? leave.error ?? close.error} />
    </View>
  );
}

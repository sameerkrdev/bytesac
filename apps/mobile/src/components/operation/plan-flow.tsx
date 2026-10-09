import { uncoveredChains } from "@repo/app-core";
import { ASSET_CHAINS, type OperationView } from "@repo/validator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PenLine } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Switch, View } from "react-native";
import { ErrorText } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { legBuys } from "@/lib/leg-direction";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { FeeLines } from "./fee-lines";
import { LegFlow } from "./leg-flow";
import { LegTrack } from "./leg-row";

/**
 * A created plan: the legs, the fees (paid from the amount or the proceeds) and any assets left out are shown first; "Continue to signing" hands over to the
 * leg-by-leg flow, where each step shows its fresh quote before the wallet opens. "Back" cancels the unsigned plan.
 */
export function PlanFlow({ plan, note, extra, onDiscarded, onSigning }: {
  plan: OperationView; note: string; extra?: ReactNode; onDiscarded(): void; onSigning?(): void;
}) {
  const { colors } = useTheme();
  const [signing, setSigning] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me() });
  const discard = useMutation({ mutationFn: () => api.cancelOperation(plan.id), onSettled: onDiscarded });
  // D-119: chains in this plan the linked wallet cannot sign. Investing still proceeds (only Solana signs); exits on those chains need another wallet.
  const uncovered = uncoveredChains(plan.legs.filter((l) => l.kind !== "network_fee").flatMap((l) => [l.fromChain, l.toChain]), me.data?.wallet?.addresses ?? []);
  const names = uncovered.map((c) => ASSET_CHAINS[c].label).join(", ");
  const needsAck = plan.kind === "invest" && uncovered.length > 0;
  if (signing) return <LegFlow operationId={plan.id} />;
  const steps = plan.legs.length;
  return (
    <View className="gap-5">
      <View className="gap-1">
        <AppText variant="eyebrow" tone="faint">Preview · nothing signed yet</AppText>
        <AppText variant="title" accessibilityRole="header">What you will sign</AppText>
        <AppText tone="muted">{`${steps} ${steps === 1 ? "step" : "steps"}, each approved separately in your wallet.`}</AppText>
      </View>
      {plan.excluded && plan.excluded.length > 0 && (
        <View accessibilityLabel="Left out of this sale" className="gap-1 rounded-card border border-warning/30 bg-warning-soft p-4">
          <AppText className="font-medium">Left out of this sale</AppText>
          {plan.excluded.map((x) => <AppText key={x.instrumentId} variant="label">{x.notice}</AppText>)}
        </View>
      )}
      <LegTrack legs={plan.legs} buying={(l) => legBuys(plan.kind, l)} />
      <FeeLines fees={plan.fees} />
      {extra}
      {uncovered.length > 0 && (
        <View accessibilityRole="alert" className="gap-3 rounded-card border border-warning/30 bg-warning-soft p-4">
          <AppText className="font-medium">{`Your wallet can't sign on ${names}`}</AppText>
          <AppText variant="label">
            {plan.kind === "invest"
              ? `You will still receive these assets at your same address. To sell them later you need a wallet that signs on ${names}, for example by importing your recovery phrase into a wallet that supports it.`
              : `Steps on ${names} need a wallet that signs there. Connect one for the same address (for example by importing your recovery phrase into a wallet that supports it) before those steps.`}
          </AppText>
          {needsAck && (
            <View className="flex-row items-center gap-3">
              <Switch accessibilityLabel={`I understand that selling assets on ${names} needs another wallet`} value={acknowledged} onValueChange={setAcknowledged}
                trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor={colors.surface} />
              <AppText variant="label" className="flex-1">I understand</AppText>
            </View>
          )}
        </View>
      )}
      <View className="flex-row gap-3 rounded-card bg-surface-muted p-4">
        <PenLine size={16} color={colors.inkMuted} style={{ marginTop: 3 }} />
        <AppText variant="label" tone="muted" className="flex-1">{note}</AppText>
      </View>
      <View className="gap-2">
        <Button size="lg" disabled={needsAck && !acknowledged} onPress={() => { setSigning(true); onSigning?.(); }}>Continue to signing</Button>
        <Button variant="ghost" loading={discard.isPending} onPress={() => discard.mutate()}>Back</Button>
      </View>
      <ErrorText error={discard.error} />
    </View>
  );
}

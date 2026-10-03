import type { OperationView } from "@repo/validator";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { ErrorText } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { legBuys } from "@/lib/leg-direction";
import { api } from "@/lib/api";
import { FeeLines } from "./fee-lines";
import { LegFlow } from "./leg-flow";
import { LegRow } from "./leg-row";

/**
 * A created plan: the legs, the fees (paid from the amount or the proceeds) and any assets left out are shown first; "Continue to signing" hands over to the
 * leg-by-leg flow, where each step shows its fresh quote before the wallet opens. "Back" cancels the unsigned plan.
 */
export function PlanFlow({ plan, note, extra, onDiscarded }: {
  plan: OperationView; note: string; extra?: ReactNode; onDiscarded(): void;
}) {
  const [signing, setSigning] = useState(false);
  const discard = useMutation({ mutationFn: () => api.cancelOperation(plan.id), onSettled: onDiscarded });
  if (signing) return <LegFlow operationId={plan.id} />;
  return (
    <View className="gap-4">
      {plan.excluded && plan.excluded.length > 0 && (
        <View accessibilityLabel="Left out of this sale" className="gap-1 rounded-xl border border-warning/40 p-3">
          <AppText className="font-sans-semibold">Left out of this sale</AppText>
          {plan.excluded.map((x) => <AppText key={x.instrumentId}>{x.notice}</AppText>)}
        </View>
      )}
      {plan.legs.map((l) => <LegRow key={l.id} leg={l} buying={legBuys(plan.kind, l)} />)}
      <FeeLines fees={plan.fees} />
      {extra}
      <AppText tone="stone">{note}</AppText>
      <Button onPress={() => setSigning(true)}>Continue to signing</Button>
      <Button variant="secondary" loading={discard.isPending} onPress={() => discard.mutate()}>Back</Button>
      <ErrorText error={discard.error} />
    </View>
  );
}

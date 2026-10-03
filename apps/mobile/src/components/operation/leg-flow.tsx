import { describeError, formatUnits, LEG_ACTIVE, LEG_IN_FLIGHT, LEG_STEP_LABEL, legAmounts, legRoute, legTitle, nextLeg, OPERATION_STATUS_LABEL } from "@repo/app-core";
import type { OperationView } from "@repo/validator";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Linking, View } from "react-native";
import { ErrorState, ErrorText, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { webUrl } from "@/lib/web-url";
import { legBuys } from "@/lib/leg-direction";
import { useLegRunner } from "@/lib/use-leg-runner";
import { FeeLines } from "./fee-lines";
import { LegRow } from "./leg-row";

/** Wallet and gas-drop failures carry their own sentence; API codes use the shared copy. */
function failureCopy(code: string, message: string): { title: string; message?: string } {
  if (code === "QUOTE_EXPIRED") return { title: "Quote expired", message: "Get a new quote, then sign again. Nothing was submitted." };
  if (code === "GAS_DROP_UNCONFIRMED") return { title: message };
  if (code === "WRONG_WALLET") return { title: "Wrong wallet", message };
  if (code === "VALIDATION_FAILED") return { title: message };
  return describeError(code as Parameters<typeof describeError>[0]) ?? describeError("INTERNAL");
}

/**
 * Signs and tracks every leg of one operation, one at a time. The server prepares each transaction and checks what comes back; nothing here retries a submitted leg.
 * The fresh quote (estimate and minimum) is shown first; the wallet opens only after the user taps "Approve".
 */
export function LegFlow({ operationId }: { operationId: string }) {
  const qc = useQueryClient();
  const runner = useLegRunner(operationId);
  const op = useQuery({
    queryKey: ["operation", operationId], queryFn: () => api.getOperation(operationId),
    refetchInterval: (q) => (q.state.data && !LEG_ACTIVE.includes(q.state.data.status) ? false : 4000),
  });
  const stop = useMutation({
    mutationFn: () => api.cancelOperation(operationId),
    onSuccess: (o: OperationView) => { qc.setQueryData(["operation", operationId], o); void qc.invalidateQueries({ queryKey: ["portfolio"] }); },
  });
  if (op.isPending) return <LoadingState />;
  if (!op.data) return <ErrorState error={op.error} onRetry={() => void op.refetch()} />;
  const o = op.data;
  const { state } = runner;
  const next = nextLeg(o.legs);
  const inFlight = o.legs.some((l) => LEG_IN_FLIGHT.includes(l.status));
  const active = LEG_ACTIVE.includes(o.status);
  const busy = state.kind === "quoting" || state.kind === "awaitingGasDrop" || state.kind === "signing" || state.kind === "submitting" || state.kind === "tracking";
  const fresh = state.kind === "confirmPrice" && runner.leg ? runner.leg : null;
  const freshAmounts = fresh && state.kind === "confirmPrice" && state.estimatedOut
    ? legAmounts({ ...fresh, minOut: state.minOut, routeSummary: { ...legRoute(fresh), estimatedOut: state.estimatedOut } }, legBuys(o.kind, fresh)) : null;
  const expired = state.kind === "failed" && state.code === "QUOTE_EXPIRED";
  const done = o.legs.some((l) => l.kind !== "network_fee" && l.status === "SETTLED");
  const unknown = o.legs.some((l) => l.status === "UNKNOWN");
  const feePaid = o.legs.some((l) => l.kind === "network_fee" && l.status === "SETTLED");
  const remaining = o.legs.filter((l) => l.status === "PLANNED");
  const s = OPERATION_STATUS_LABEL[o.status];
  // A leg that spends Bitcoin needs a PSBT signature, which mobile does not offer: it is continued on the web, with no quote fetched here.
  const btcNext = next?.fromChain === "bitcoin";
  const handoff = state.kind === "handoffWeb" ? state.url : btcNext ? webUrl(`/portfolio#operation-${operationId}`) : null;
  const failure = state.kind === "failed" ? failureCopy(state.code, state.message) : null;

  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-2"><AppText>Status</AppText><StatusBadge tone={s.tone} label={s.label} /></View>
      {o.legs.map((l) => <LegRow key={l.id} leg={l} buying={legBuys(o.kind, l)} />)}

      {failure && (
        <View accessibilityRole="alert" className="gap-1 rounded-xl border border-danger/40 p-3">
          <AppText className="font-sans-semibold">{failure.title}</AppText>
          {failure.message ? <AppText tone="stone">{failure.message}</AppText> : null}
        </View>
      )}
      <ErrorText error={stop.error} />
      {busy && <AppText accessibilityRole="progressbar" tone="stone">{LEG_STEP_LABEL[state.kind] ?? "Working"}…</AppText>}
      {fresh && (
        <View className="gap-1 rounded-xl border border-border-dark p-3">
          <AppText className="font-sans-semibold">Fresh quote for step {fresh.sequence}</AppText>
          {freshAmounts
            ? <AppText tone="stone">{freshAmounts.in} → about {freshAmounts.estimatedOut} (at least {freshAmounts.minOut})</AppText>
            : <AppText tone="stone">Fee transfer of {formatUnits(fresh.amountIn, 6)} USDC (all fees together).</AppText>}
          <AppText variant="label" tone="stone">The quote is valid for about a minute. {fresh.recoveryOf ? "You sign this quote: the amounts above are what you get, at least." : "If the price moves against you the server refuses it and nothing is sent."}</AppText>
        </View>
      )}
      {handoff && active && (
        <View className="gap-2 rounded-xl border border-border-dark p-3">
          <AppText>This step involves Bitcoin, which is signed on the web.</AppText>
          <Button onPress={() => void Linking.openURL(handoff)}>Continue on web</Button>
        </View>
      )}
      {active && inFlight && !busy && <AppText tone="stone">Waiting for the network to confirm. This screen updates by itself.</AppText>}

      {active && !busy && (
        <View className="gap-3">
          {fresh ? (
            <>
              <Button onPress={runner.approve}>{`Approve step ${fresh.sequence} in your wallet`}</Button>
              <Button variant="secondary" onPress={runner.decline}>Not now</Button>
            </>
          ) : next && !handoff ? (
            <Button onPress={() => void runner.run(next)}>{expired ? "Get a new quote" : next.recoveryOf ? "Complete swap" : `Review step ${next.sequence}`}</Button>
          ) : null}
          {!inFlight && !fresh && <Button variant="secondary" loading={stop.isPending} onPress={() => stop.mutate()}>{done || unknown || o.legs.some((l) => l.recoveryToken) ? "Stop here" : "Cancel"}</Button>}
        </View>
      )}

      {o.status === "COMPLETED" && <AppText>All steps are settled.{o.kind === "invest" ? " Your basket is in your wallet and shown in your portfolio." : ""}</AppText>}
      {(o.status === "PARTIAL" || o.status === "FAILED") && (
        <AppText>
          {o.status === "PARTIAL" ? "Some steps settled and some did not run. What you received is in your wallet." : "No assets were bought or sold."}
          {unknown ? " A step is still being checked with the chain; its result is added to your portfolio when it settles." : ""}
          {feePaid ? " The fees were already paid and are not refunded." : ""}
          {remaining.length > 0 ? ` Not run: ${remaining.map((l) => legTitle(l, legBuys(o.kind, l))).join(", ")}.` : ""} Start a new plan to continue. Unspent USDC stays in your wallet.
        </AppText>
      )}
      {o.status === "CANCELLED" && <AppText>Cancelled. Nothing was submitted.</AppText>}
      <FeeLines fees={o.fees} />
    </View>
  );
}

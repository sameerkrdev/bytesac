import { explorerTxUrl, formatUnits, LEG_STATUS_LABEL, legAmounts, legTitle, PRICE_IMPACT_WARNING } from "@repo/app-core";
import { ASSET_CHAINS, type Leg } from "@repo/validator";
import { Check, ExternalLink, X } from "lucide-react-native";
import { Linking, Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { StatusBadge } from "@/components/ui/status-badge";
import { useTheme } from "@/lib/theme";

const Link = ({ label, url }: { label: string; url: string }) => {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={label} className="min-h-11 flex-row items-center gap-1.5 self-start" onPress={() => void Linking.openURL(url)}>
      <AppText variant="label" tone="accent">{label}</AppText>
      <ExternalLink size={13} color={colors.accent} />
    </Pressable>
  );
};

/** The numbered dot of a step: a check once settled, a cross when it failed, the number otherwise. */
function StepDot({ leg: l }: { leg: Leg }) {
  const { colors } = useTheme();
  if (l.status === "SETTLED") return <View className="size-7 items-center justify-center rounded-pill bg-success"><Check size={15} color={colors.primaryInk} strokeWidth={2.5} /></View>;
  if (l.status === "FAILED") return <View className="size-7 items-center justify-center rounded-pill bg-danger"><X size={15} color={colors.primaryInk} strokeWidth={2.5} /></View>;
  const live = l.status !== "PLANNED";
  return (
    <View className={`size-7 items-center justify-center rounded-pill border ${live ? "border-info bg-info-soft" : "border-line-strong bg-surface"}`}>
      <AppText variant="micro" tone={live ? "ink" : "muted"} className="font-medium">{l.sequence}</AppText>
    </View>
  );
}

/** One leg as a step on a vertical track: what it does, chains, amounts and route fees from the plan, status and explorer links. */
export function LegRow({ leg: l, buying, last = true }: { leg: Leg; buying: boolean; last?: boolean }) {
  const a = legAmounts(l, buying);
  const btc = l.fromChain === "bitcoin" || l.toChain === "bitcoin";
  const fees = l.routeFees.filter((f) => f.included).reduce((s, f) => s + f.amountUsd, 0);
  const t = l.recoveryToken;
  const refunded = l.providerSubstatus === "REFUNDED";
  const refunding = l.providerSubstatus === "NOT_PROCESSABLE_REFUND_NEEDED" || l.providerSubstatus === "REFUND_IN_PROGRESS";
  const s = LEG_STATUS_LABEL[l.status];
  const highImpact = l.priceImpact !== null && l.priceImpact >= PRICE_IMPACT_WARNING;
  const chains = l.fromChain === l.toChain ? ASSET_CHAINS[l.fromChain].label : `${ASSET_CHAINS[l.fromChain].label} → ${ASSET_CHAINS[l.toChain].label}`;
  return (
    <View className="flex-row gap-3">
      <View className="items-center">
        <StepDot leg={l} />
        {!last ? <View className="my-1 w-px flex-1 bg-line-strong" /> : null}
      </View>
      <View className={`flex-1 gap-1.5 ${last ? "" : "pb-5"}`}>
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-0.5">
            <AppText className="font-medium" accessibilityLabel={`Step ${l.sequence}, ${l.recoveryOf ? "Complete swap" : legTitle(l, buying)}`}>{l.recoveryOf ? "Complete swap" : legTitle(l, buying)}</AppText>
            <AppText variant="micro" tone="faint">{chains}</AppText>
          </View>
          <StatusBadge tone={s.tone} label={s.label} />
        </View>
        <AppText tone="muted">{l.recoveryOf ? "Swap what arrived: " : ""}{a.in}{a.estimatedOut ? ` → about ${a.estimatedOut}` : ""}{a.minOut ? ` (at least ${a.minOut})` : ""}</AppText>
        {l.recoveryOf && l.status === "PLANNED" && <AppText variant="label" tone="faint">You sign a fresh quote first; the figures above are an estimate.</AppText>}
        {l.status === "PLANNED" && fees > 0 && <AppText variant="label" tone="faint">{`Route fees (LI.FI, DEX, bridge): $${fees.toFixed(2)} — included in the estimate`}</AppText>}
        {l.status === "PLANNED" && l.priceImpact !== null && (
          <AppText variant="label" tone={highImpact ? "danger" : "faint"}>
            {`Price impact ${(l.priceImpact * 100).toFixed(2)}%${highImpact ? " — higher than usual" : ""}`}
          </AppText>
        )}
        {l.feeOnTransfer && l.status === "PLANNED" && <AppText variant="label" tone="faint">This token charges a transfer tax; amounts are estimates.</AppText>}
        {refunding && <AppText variant="label" tone="warning">{"Refund in progress (the route couldn't complete)."}</AppText>}
        {l.status === "FAILED" && refunded && <AppText variant="label">Funds returned to your wallet.</AppText>}
        {t && <View className="rounded-tile bg-warning-soft p-3"><AppText variant="label">Arrived as {formatUnits(t.amount, t.decimals)} {t.symbol} on {ASSET_CHAINS[t.chain].label}. Complete the swap below, or stop here and keep it in your wallet.</AppText></View>}
        {btc && l.status !== "SETTLED" && <AppText variant="label" tone="faint">Bitcoin needs 2 confirmations, about 20 minutes.{l.fromChain === "bitcoin" ? " Bitcoin steps are signed on the web." : ""}</AppText>}
        {l.status === "UNKNOWN" && <View className="rounded-tile bg-warning-soft p-3"><AppText variant="label">We are checking this with the chain. Do not sign it again. You can stop here; the check continues and the result is added to your portfolio.</AppText></View>}
        {l.failureReason && !t ? <AppText variant="label" tone="danger">{l.failureReason}</AppText> : null}
        {l.sourceTx || l.destinationTx ? (
          <View className="flex-row flex-wrap gap-x-4">
            {l.sourceTx ? <Link label="Source transaction" url={explorerTxUrl(l.fromChain, l.sourceTx)} /> : null}
            {l.destinationTx ? <Link label="Destination transaction" url={explorerTxUrl(l.toChain, l.destinationTx)} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The legs of a plan or operation as one card with a continuous track. */
export function LegTrack({ legs, buying }: { legs: Leg[]; buying(l: Leg): boolean }) {
  return (
    <View className="rounded-card border border-line bg-surface p-5">
      {legs.map((l, i) => <LegRow key={l.id} leg={l} buying={buying(l)} last={i === legs.length - 1} />)}
    </View>
  );
}

import { explorerTxUrl, formatUnits, LEG_STATUS_LABEL, legAmounts, legTitle, PRICE_IMPACT_WARNING } from "@repo/app-core";
import { ASSET_CHAINS, type Leg } from "@repo/validator";
import { Linking, Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { StatusBadge } from "@/components/ui/status-badge";

const Link = ({ label, url }: { label: string; url: string }) => (
  <Pressable accessibilityRole="link" accessibilityLabel={label} className="min-h-11 justify-center" onPress={() => void Linking.openURL(url)}>
    <AppText variant="label" tone="accent" className="underline">{label}</AppText>
  </Pressable>
);

/** One leg: what it does, amounts and route fees from the plan, status and explorer links. */
export function LegRow({ leg: l, buying }: { leg: Leg; buying: boolean }) {
  const a = legAmounts(l, buying);
  const btc = l.fromChain === "bitcoin" || l.toChain === "bitcoin";
  const fees = l.routeFees.filter((f) => f.included).reduce((s, f) => s + f.amountUsd, 0);
  const t = l.recoveryToken;
  const refunded = l.providerSubstatus === "REFUNDED";
  const refunding = l.providerSubstatus === "NOT_PROCESSABLE_REFUND_NEEDED" || l.providerSubstatus === "REFUND_IN_PROGRESS";
  const s = LEG_STATUS_LABEL[l.status];
  const highImpact = l.priceImpact !== null && l.priceImpact >= PRICE_IMPACT_WARNING;
  return (
    <View className="gap-1 rounded-control border border-line p-3">
      <View className="flex-row items-center justify-between gap-2">
        <AppText className="flex-1 font-semibold">{l.sequence}. {l.recoveryOf ? "Complete swap" : legTitle(l, buying)}</AppText>
        <StatusBadge tone={s.tone} label={s.label} />
      </View>
      <AppText tone="faint">{l.recoveryOf ? "Swap what arrived: " : ""}{a.in}{a.estimatedOut ? ` → about ${a.estimatedOut}` : ""}{a.minOut ? ` (at least ${a.minOut})` : ""}</AppText>
      {l.recoveryOf && l.status === "PLANNED" && <AppText variant="label" tone="faint">You sign a fresh quote first; the figures above are an estimate.</AppText>}
      {l.status === "PLANNED" && fees > 0 && <AppText variant="label" tone="faint">{`Route fees (LI.FI, DEX, bridge): $${fees.toFixed(2)} — included in the estimate`}</AppText>}
      {l.status === "PLANNED" && l.priceImpact !== null && (
        <AppText variant="label" tone={highImpact ? "danger" : "faint"}>
          {`Price impact ${(l.priceImpact * 100).toFixed(2)}%${highImpact ? " — higher than usual" : ""}`}
        </AppText>
      )}
      {l.feeOnTransfer && l.status === "PLANNED" && <AppText variant="label" tone="faint">This token charges a transfer tax; amounts are estimates.</AppText>}
      {refunding && <AppText variant="label" tone="faint">{"Refund in progress (the route couldn't complete)."}</AppText>}
      {l.status === "FAILED" && refunded && <AppText variant="label">Funds returned to your wallet.</AppText>}
      {t && <AppText variant="label">Arrived as {formatUnits(t.amount, t.decimals)} {t.symbol} on {ASSET_CHAINS[t.chain].label}. Complete the swap below, or stop here and keep it in your wallet.</AppText>}
      {btc && l.status !== "SETTLED" && <AppText variant="label" tone="faint">Bitcoin needs 2 confirmations, about 20 minutes.{l.fromChain === "bitcoin" ? " Bitcoin steps are signed on the web." : ""}</AppText>}
      {l.status === "UNKNOWN" && <AppText variant="label" tone="faint">We are checking this with the chain. Do not sign it again. You can stop here; the check continues and the result is added to your portfolio.</AppText>}
      {l.failureReason && !t ? <AppText variant="label" tone="danger">{l.failureReason}</AppText> : null}
      {l.sourceTx ? <Link label="Source transaction" url={explorerTxUrl(l.fromChain, l.sourceTx)} /> : null}
      {l.destinationTx ? <Link label="Destination transaction" url={explorerTxUrl(l.toChain, l.destinationTx)} /> : null}
    </View>
  );
}

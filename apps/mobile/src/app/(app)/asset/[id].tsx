import { ASSET_TYPE_LABEL, shortAddress } from "@repo/app-core";
import { ASSET_CHAINS } from "@repo/validator";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Clock, ExternalLink, ShieldAlert } from "lucide-react-native";
import { Fragment } from "react";
import { Linking, Pressable, RefreshControl, View } from "react-native";
import { ErrorState, LoadingState } from "@/components/states/states";
import { AppText } from "@/components/ui/app-text";
import { AssetMark } from "@/components/ui/asset-mark";
import { Card } from "@/components/ui/card";
import { Screen, Section } from "@/components/ui/screen";
import { StatusBadge } from "@/components/ui/status-badge";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";

const METHOD: Record<string, string> = {
  swap: "Swap", subscription: "Issuer subscription", secondary_market: "Secondary market", platform_inventory: "Platform inventory", redemption: "Issuer redemption", cross_chain_transfer: "Cross-chain transfer",
};
const STANDARD: Record<string, string> = { native: "Native", erc20: "ERC-20", spl: "SPL", spl_token_2022: "SPL Token-2022", other: "Other" };
const money = (v: string) => `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 })}`;

/**
 * One instrument: price, then where it lives (deployments per network) and how Bytesac can trade it (routes).
 * Tokenized assets carry issuer and restriction notes; Bytesac buys and sells them on secondary markets only.
 */
export default function AssetScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["asset", id], queryFn: () => api.getAsset(id) });
  if (q.isPending) return <Screen edges={["left", "right"]}><LoadingState /></Screen>;
  if (q.isError) return <Screen edges={["left", "right"]}><ErrorState error={q.error} onRetry={() => void q.refetch()} /></Screen>;
  const a = q.data;
  const rwa = a.assetType.startsWith("TOKENIZED_");
  const market = a.prices.find((p) => p.kind === "market");
  const nav = a.prices.find((p) => p.kind === "nav");
  const website = a.issuer?.website?.startsWith("https://") ? a.issuer.website : null;
  return (
    <Screen edges={["left", "right"]} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.ink} />}>
      <View className="gap-3">
        <AssetMark symbol={a.symbol} logoUrl={a.logoUrl} size={52} />
        <AppText variant="eyebrow" tone="faint">{ASSET_TYPE_LABEL[a.assetType]}</AppText>
        <AppText variant="display" accessibilityRole="header">{a.name}</AppText>
        <AppText tone="muted">{a.symbol}</AppText>
      </View>

      <Card className="gap-2">
        <AppText variant="eyebrow" tone="faint">Market price</AppText>
        <AppText variant="figure">{market?.status === "ok" && market.value ? money(market.value) : "Unavailable"}</AppText>
        {market?.stale ? <View className="flex-row"><StatusBadge tone="warning" label="Price may be out of date" /></View> : null}
        {market?.observedAt ? <AppText variant="micro" tone="faint">{`Observed ${new Date(market.observedAt).toLocaleString()}`}</AppText> : null}
        {nav ? (
          <View className="gap-0.5 border-t border-line pt-3">
            <AppText tone="muted">{`Issuer NAV ${nav.value ? money(nav.value) : "unavailable"}`}</AppText>
            <AppText variant="micro" tone="faint">Display only — trades use market prices.</AppText>
          </View>
        ) : null}
      </Card>

      {a.description ? <AppText variant="lede">{a.description}</AppText> : null}

      {rwa ? (
        <View className="flex-row gap-3 rounded-card border border-warning/30 bg-warning-soft p-4">
          <ShieldAlert size={16} color={colors.warning} style={{ marginTop: 3 }} />
          <View className="flex-1 gap-1">
            <AppText className="font-medium">Tokenized real-world asset</AppText>
            <AppText variant="label" tone="muted">{`Depends on its issuer${a.issuer ? ` (${a.issuer.name})` : ""} and may be restricted by region or investor status. Bytesac buys and sells it on secondary markets only — it never subscribes to or redeems with the issuer, and settlement is not instant redemption.`}</AppText>
          </View>
        </View>
      ) : null}

      <Section eyebrow="Where it lives" title="Deployments">
        <Card className="py-1">
          {a.deployments.map((d, i) => (
            <Fragment key={`${d.chain}-${d.address}`}>
              {i > 0 ? <View className="h-px bg-line" /> : null}
              <View className="flex-row items-center justify-between gap-3 py-3.5">
                <AppText className="font-medium">{ASSET_CHAINS[d.chain].label}</AppText>
                <AppText variant="label" tone="muted" className="font-mono">{`${STANDARD[d.tokenStandard] ?? d.tokenStandard} · ${d.decimals} dp${d.address ? ` · ${shortAddress(d.address)}` : ""}`}</AppText>
              </View>
            </Fragment>
          ))}
        </Card>
        <AppText variant="micro" tone="faint">The same asset on different networks is a different token contract. Bytesac tracks each deployment separately.</AppText>
      </Section>

      <Section eyebrow="How it is traded" title="Execution routes">
        {a.routes.length === 0 ? <AppText tone="muted">No active route — this asset can’t be traded through Bytesac right now.</AppText> : a.routes.map((r, i) => (
          <Card key={i} className="gap-2 p-4">
            <View className="flex-row items-center justify-between gap-2">
              <AppText className="font-medium">{ASSET_CHAINS[r.chain].label}</AppText>
              <AppText variant="micro" tone="faint">{r.providerName}</AppText>
            </View>
            <AppText>{METHOD[r.method] ?? r.method}{r.settlementSymbol ? <AppText tone="muted">{` · settles in ${r.settlementSymbol}`}</AppText> : null}</AppText>
            <View className="flex-row items-center gap-1.5">
              {r.processingModel === "async" ? <Clock size={13} color={colors.inkMuted} /> : null}
              <AppText variant="label" tone="muted">{r.processingModel === "async" ? "Asynchronous — settlement can take time" : "Settles in one transaction"}</AppText>
            </View>
          </Card>
        ))}
      </Section>

      {a.riskNotes ? <Section title="Risk notes"><AppText tone="muted">{a.riskNotes}</AppText></Section> : null}

      {a.issuer ? (
        <Section eyebrow="Issuer" title={a.issuer.name}>
          {website ? (
            <Pressable accessibilityRole="link" accessibilityLabel={`${a.issuer.name} website`} onPress={() => void Linking.openURL(website)} className="min-h-11 flex-row items-center gap-1.5 self-start">
              <AppText tone="accent">Website</AppText><ExternalLink size={14} color={colors.accent} />
            </Pressable>
          ) : null}
        </Section>
      ) : null}
    </Screen>
  );
}

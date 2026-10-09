import { shortAddress } from "@repo/app-core";
import { ASSET_CHAINS, type AssetChain } from "@repo/validator";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { WalletHelpLink } from "@/components/help/wallet-help-sheet";
import { AppText } from "@/components/ui/app-text";
import { useTheme } from "@/lib/theme";

export type Choice = { chain: AssetChain; state: "available" | "linked-here" | "linked-elsewhere"; walletName: string | null; preselected: boolean };

/** D-120: which chains this wallet serves; one signature links the ticked ones. */
export function ChainPicker({ walletName, address, choices, onChange }: { walletName: string | null; address: string; choices: Choice[]; onChange(chains: AssetChain[]): void }) {
  const { colors } = useTheme();
  const [picked, setPicked] = useState<AssetChain[]>(() => choices.filter((c) => c.preselected).map((c) => c.chain));
  useEffect(() => { onChange(picked); }, [picked, onChange]);
  return (
    <View className="gap-2 rounded-tile bg-surface-muted p-4">
      <AppText className="font-medium">{`Use ${walletName ?? "this wallet"} (${shortAddress(address)}) for:`}</AppText>
      {choices.map((c) => (
        <View key={c.chain} className="min-h-11 flex-row items-center gap-3">
          <Switch accessibilityLabel={ASSET_CHAINS[c.chain].label} disabled={c.state !== "available"} accessibilityState={{ disabled: c.state !== "available" }}
            value={c.state === "linked-here" || picked.includes(c.chain)}
            onValueChange={(on) => setPicked((p) => (on ? [...p, c.chain] : p.filter((x) => x !== c.chain)))}
            trackColor={{ true: colors.primary, false: colors.lineStrong }} thumbColor={colors.surface} />
          <AppText className="flex-1">{ASSET_CHAINS[c.chain].label}</AppText>
          {c.state === "linked-elsewhere" && <AppText variant="label" tone="faint">{`linked to ${c.walletName ?? "another wallet"}`}</AppText>}
          {c.state === "linked-here" && <AppText variant="label" tone="faint">already linked</AppText>}
        </View>
      ))}
      <WalletHelpLink topic="several-wallets" />
    </View>
  );
}

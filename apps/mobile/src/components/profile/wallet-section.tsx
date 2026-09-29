import { canAddChainAccount } from "@repo/api-client";
import { CHAINS, type MeResponse } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Modal, View } from "react-native";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { StatusBadge } from "@/components/ui/status-badge";
import { shortAddress } from "@/lib/format";

const METHOD = { eoa_ecdsa: "Key signature", erc1271: "Smart wallet", erc6492: "Smart wallet (not yet deployed)", ed25519: "Key signature" } as const;

export function WalletSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const onVerified = useCallback(() => { setOpen(false); void qc.invalidateQueries({ queryKey: ["me"] }); }, [qc]);
  return (
    <Card className="gap-4">
      <AppText variant="h3" accessibilityRole="header">Investment wallet</AppText>
      <AppText tone="muted">{me.wallet.walletProvider ?? "Wallet"} · one wallet, one address per network</AppText>
      {me.wallet.addresses.map((a) => (
        <View key={`${a.chain}:${a.address}`} className="gap-1 border-t border-border-dark pt-3">
          <View className="flex-row items-center justify-between">
            <AppText className="font-sans-medium">{CHAINS[a.chain].label}</AppText>
            <StatusBadge tone={a.status === "active" ? "success" : "danger"} label={a.status === "active" ? "Active" : "Disabled"} />
          </View>
          <AppText tone="stone">{shortAddress(a.address)} · {METHOD[a.verificationMethod]}</AppText>
        </View>
      ))}
      {canAddChainAccount(me) && <Button variant="secondary" onPress={() => setOpen(true)}>Add chain account</Button>}
      <AppText variant="label" tone="stone">Lost access to a wallet? Contact support.</AppText>
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <Screen>
          <AppText variant="h2" accessibilityRole="header">Add chain account</AppText>
          <AppText tone="muted">Connect the other network in your wallet, then sign to prove you control it.</AppText>
          {open && <WalletVerification purpose="add_chain_account" linkedAddresses={me.wallet.addresses} onVerified={onVerified} />}
          <Button variant="ghost" onPress={() => setOpen(false)}>Close</Button>
        </Screen>
      </Modal>
    </Card>
  );
}

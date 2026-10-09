import { canAddChainAccount, shortAddress } from "@repo/app-core";
import { CHAINS, type MeResponse, type WalletAddressView } from "@repo/validator";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Modal, View } from "react-native";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { WalletHelpLink } from "@/components/help/wallet-help-sheet";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { StatusBadge } from "@/components/ui/status-badge";

/** Sheet guidance names the family the account is missing; a wallet only offers the families it supports (MetaMask: EVM only). */
function addChainHint(me: MeResponse): string {
  if (!me.wallet.addresses.some((a) => a.chainFamily === "solana"))
    return "Add your Solana address. Connect a wallet that supports Solana (for example Phantom, Solflare or Trust Wallet), or pick Solana with Choose network if your wallet already supports it, then sign.";
  if (!me.wallet.addresses.some((a) => a.chainFamily === "evm"))
    return "Add your EVM address (Ethereum, Base, BNB Chain, Arbitrum). Connect a wallet that supports EVM (for example MetaMask or Trust Wallet), or pick an EVM network with Choose network, then sign.";
  return "Connect the missing network in your wallet, then sign to prove you control it.";
}

const METHOD = { eoa_ecdsa: "Key signature", erc1271: "Smart wallet", erc6492: "Smart wallet (not yet deployed)", ed25519: "Key signature", bip322: "Bitcoin signature", bip137: "Bitcoin signature" } as const;

export function WalletSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState<WalletAddressView | null>(null);
  const onVerified = useCallback(() => { setOpen(false); setMoving(null); void qc.invalidateQueries({ queryKey: ["me"] }); }, [qc]);
  return (
    <Card className="gap-4">
      <AppText variant="heading" accessibilityRole="header">Investment wallet</AppText>
      <AppText tone="muted">One address per network. Each can come from the same wallet or a different one.</AppText>
      {me.wallet.addresses.filter((a) => a.status !== "replaced").map((a) => (
        <View key={`${a.chain}:${a.address}`} className="gap-1 border-t border-line pt-3">
          <View className="flex-row items-center justify-between">
            <AppText className="font-medium">{CHAINS[a.chain].label}</AppText>
            <StatusBadge tone={a.status === "active" ? "success" : "danger"} label={a.status === "active" ? "Active" : "Disabled"} />
          </View>
          <AppText tone="faint">{a.walletName ?? "Wallet"} · {shortAddress(a.address)} · {METHOD[a.verificationMethod]}</AppText>
          {a.status === "active" && (
            <Button variant="ghost" accessibilityLabel={`Move ${CHAINS[a.chain].label} to another wallet`} onPress={() => setMoving(a)}>Move to another wallet</Button>
          )}
        </View>
      ))}
      {canAddChainAccount(me) && <Button variant="secondary" onPress={() => setOpen(true)}>Add chain account</Button>}
      <AppText variant="label" tone="faint">Lost access to a wallet? Contact support.</AppText>
      <WalletHelpLink topic="move-chain" />
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <Screen>
          <AppText variant="title" accessibilityRole="header">Add chain account</AppText>
          <AppText tone="muted">{addChainHint(me)}</AppText>
          {open && <WalletVerification purpose="add_chain_account" linkedAddresses={me.wallet.addresses} onVerified={onVerified} />}
          <Button variant="ghost" onPress={() => setOpen(false)}>Close</Button>
        </Screen>
      </Modal>
      <Modal visible={moving !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setMoving(null)}>
        <Screen>
          <AppText variant="title" accessibilityRole="header">{`Move ${moving ? CHAINS[moving.chain].label : ""} to another wallet`}</AppText>
          <AppText tone="muted">{`Only possible when you hold nothing on ${moving ? CHAINS[moving.chain].label : "this chain"}. Connect the new wallet and sign, then approve in the current one to confirm.`}</AppText>
          {moving && <WalletVerification purpose="reassign_chain" linkedAddresses={me.wallet.addresses} reassign={{ chain: moving.chain, previous: { address: moving.address, walletName: moving.walletName ?? null } }} onVerified={onVerified} />}
          <Button variant="ghost" onPress={() => setMoving(null)}>Close</Button>
        </Screen>
      </Modal>
    </Card>
  );
}

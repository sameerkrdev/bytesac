import { describeError, type ConnectedAccount, type VerifyState } from "@repo/api-client";
import { CHAINS } from "@repo/contracts";
import { palette } from "@repo/design-tokens";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, PenLine, ShieldCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { shortAddress } from "@/lib/format";

export interface LinkedAddress {
  chain: string;
  address: string;
}

interface Props {
  account: ConnectedAccount | null;
  network: "supported" | "unsupported" | "none";
  state: VerifyState;
  /** Addresses already linked to this user; signing for one of them is pointless. */
  linkedAddresses?: readonly LinkedAddress[];
  onSign(): void;
  onRetry(): void;
  onRestart(): void;
  onDisconnect(): void;
  onSwitchNetwork(): void;
  onChooseNetwork(): void;
  onReauthenticate(): void;
  /** Abandon a pending sign/verify request (e.g. the wallet never answered). */
  onCancel(): void;
  onConnect(): void;
}

const ALREADY_LINKED_HINT = "This account is already linked. Choose another network or account in your wallet.";

function sameAddress(chain: string, a: string, b: string): boolean {
  return chain === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

function Step({ n, done, label }: { n: number; done: boolean; label: string }) {
  return (
    <View accessible className="flex-row items-center gap-2" accessibilityLabel={`${label}${done ? ", complete" : ""}`}>
      <View className={`h-6 w-6 items-center justify-center rounded-full border ${done ? "border-sage bg-sage" : "border-border-dark"}`}>
        {done ? <Check size={14} color={palette.space} /> : <AppText variant="label" tone="stone">{String(n)}</AppText>}
      </View>
      <AppText variant="body" tone={done ? "ivory" : "stone"}>{label}</AppText>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <AppText tone="stone">{label}</AppText>
      <AppText className="font-sans-medium">{value}</AppText>
    </View>
  );
}

/** Try again button that stays disabled until the server-provided retry delay has elapsed. */
function RetryButton({ waitSec, onPress }: { waitSec: number; onPress(): void }) {
  const [remaining, setRemaining] = useState(waitSec);
  const active = remaining > 0;
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  return (
    <>
      {remaining > 0 ? <AppText tone="muted" accessibilityLiveRegion="polite">{`Try again in ${remaining} s.`}</AppText> : null}
      <Button onPress={onPress} disabled={remaining > 0}>Try again</Button>
    </>
  );
}

export function VerifyWalletCard(p: Props) {
  const busy = p.state.step === "signing" || p.state.step === "verifying";
  const err = p.state.step === "error" ? describeError(p.state.code) : null;
  const retryAfterSec = p.state.step === "error" ? p.state.retryAfterSec ?? 0 : 0;
  const alreadyLinked =
    p.account !== null &&
    (p.linkedAddresses ?? []).some((l) => l.chain === p.account!.chain && sameAddress(l.chain, l.address, p.account!.address));

  let primary: React.ReactNode;
  if (err?.recovery === "restart") primary = <Button onPress={p.onRestart}>Start again</Button>;
  else if (err?.recovery === "reauthenticate") primary = <Button onPress={p.onReauthenticate}>Sign in again</Button>;
  else if (err?.recovery === "retry") primary = <Button onPress={p.onRetry}>Try again</Button>;
  else if (err?.recovery === "wait") primary = <RetryButton waitSec={retryAfterSec} onPress={p.onRetry} />;
  else if (err?.recovery === "fix-input") primary = null; // Disconnect + Choose network below are the recovery actions
  else {
    primary = (
      <>
        {alreadyLinked ? <AppText tone="muted" accessibilityRole="alert">{ALREADY_LINKED_HINT}</AppText> : null}
        <Button
          onPress={p.onSign}
          loading={busy}
          disabled={p.state.step === "done" || alreadyLinked}
          icon={busy ? undefined : <PenLine size={16} color={palette.space} />}
        >
          {p.state.step === "signing" ? "Waiting for wallet…" : p.state.step === "verifying" ? "Verifying…" : "Sign message"}
        </Button>
      </>
    );
  }

  return (
    <Card className="gap-5">
      <View className="flex-row gap-4">
        <Step n={1} done={p.network !== "none"} label="Connected" />
        <Step n={2} done={p.state.step === "done"} label="Sign to verify" />
      </View>
      <AppText variant="h3" accessibilityRole="header">Verify your wallet</AppText>

      {p.network === "unsupported" ? (
        <View accessibilityRole="alert" className="gap-3 rounded-xl border border-warning p-4">
          <AppText>{"Your wallet is on a network Bytesac doesn't support yet. Switch to a supported network: Ethereum, Base, BNB Chain, Arbitrum or Solana."}</AppText>
          <Button onPress={p.onSwitchNetwork}>Switch network</Button>
        </View>
      ) : p.account ? (
        <>
          <View className="gap-2">
            <Row label="Wallet" value={p.account.walletName ?? "Wallet"} />
            <Row label="Network" value={CHAINS[p.account.chain].label} />
            <View className="flex-row items-center justify-between">
              <AppText tone="stone">Address</AppText>
              <View className="flex-row items-center gap-1">
                <AppText className="font-sans-medium">{shortAddress(p.account.address)}</AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy address"
                  className="min-h-11 min-w-11 items-center justify-center"
                  onPress={() => void Clipboard.setStringAsync(p.account!.address)}
                >
                  <Copy size={16} color={palette.stone} />
                </Pressable>
              </View>
            </View>
          </View>
          <View className="flex-row gap-3 rounded-xl border border-border-dark bg-space p-4">
            <ShieldCheck size={20} color={palette.mint} />
            <AppText className="flex-1">{"You're signing a message to prove you control this address. It does not authorize any transaction or spending."}</AppText>
          </View>
          {err && (
            <View accessibilityRole="alert" className="gap-1 rounded-xl border border-danger p-4">
              <AppText className="font-sans-semibold">{err.title}</AppText>
              <AppText tone="muted">{err.message}</AppText>
            </View>
          )}
          {primary}
          {busy ? <Button variant="secondary" onPress={p.onCancel}>Cancel</Button> : null}
          <Button variant="secondary" onPress={p.onChooseNetwork}>Choose network</Button>
        </>
      ) : p.network === "none" ? (
        <Button onPress={p.onConnect}>Connect wallet</Button>
      ) : null}
      <Button variant="ghost" onPress={p.onDisconnect}>Disconnect</Button>
    </Card>
  );
}

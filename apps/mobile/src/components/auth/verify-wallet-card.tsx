import { describeError, type ConnectedAccount, type VerifyState, shortAddress } from "@repo/app-core";
import { CHAINS } from "@repo/validator";
import * as Clipboard from "expo-clipboard";
import { Check, Copy, PenLine, ShieldCheck } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui/app-text";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTheme } from "@/lib/theme";

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
  /** D-120 chain switches; when present Sign needs at least one ticked chain (signDisabled). */
  picker?: ReactNode;
  signDisabled?: boolean;
  /** Guidance from the verification hook, e.g. the second step of a move. */
  notice?: { kind: "info" | "error"; text: string } | null;
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
  /** Add chain account only: drop the current wallet connection and pick another wallet (the Bytesac session stays). */
  onUseDifferentWallet?(): void;
}

const ALREADY_LINKED_HINT = "This account is already linked. Choose another network or account in your wallet.";

function sameAddress(chain: string, a: string, b: string): boolean {
  return chain === "solana" ? a === b : a.toLowerCase() === b.toLowerCase();
}

function Step({ n, done, label }: { n: number; done: boolean; label: string }) {
  const { colors } = useTheme();
  return (
    <View accessible className="flex-1 flex-row items-center gap-2" accessibilityLabel={`${label}${done ? ", complete" : ""}`}>
      <View className={`size-7 items-center justify-center rounded-pill border ${done ? "border-success bg-success" : "border-line-strong bg-surface"}`}>
        {done ? <Check size={14} color={colors.primaryInk} strokeWidth={2.5} /> : <AppText variant="micro" tone="muted">{String(n)}</AppText>}
      </View>
      <AppText variant="label" tone={done ? "ink" : "muted"}>{label}</AppText>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-11 flex-row items-center justify-between">
      <AppText tone="muted">{label}</AppText>
      <AppText className="font-medium">{value}</AppText>
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
  const { colors } = useTheme();
  const busy = p.state.step === "signing" || p.state.step === "verifying";
  const err = p.state.step === "error" ? describeError(p.state.code) : null;
  const retryAfterSec = p.state.step === "error" ? p.state.retryAfterSec ?? 0 : 0;
  // Without the chain picker (a move), signing for an address that is already linked is pointless.
  const alreadyLinked =
    !p.picker && p.account !== null &&
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
          disabled={p.state.step === "done" || alreadyLinked || p.signDisabled}
          size="lg"
          icon={busy ? undefined : <PenLine size={16} color={colors.primaryInk} />}
        >
          {p.state.step === "signing" ? "Waiting for wallet…" : p.state.step === "verifying" ? "Verifying…" : "Sign message"}
        </Button>
      </>
    );
  }

  return (
    <Card className="gap-5">
      <View className="flex-row items-center gap-3">
        <Step n={1} done={p.network !== "none"} label="Connected" />
        <View className="h-px w-6 bg-line-strong" />
        <Step n={2} done={p.state.step === "done"} label="Sign to verify" />
      </View>
      <AppText variant="heading" accessibilityRole="header">Verify your wallet</AppText>

      {p.notice && (
        <View accessibilityRole={p.notice.kind === "error" ? "alert" : undefined} accessibilityLiveRegion="polite" className="rounded-tile border border-info/25 bg-surface-muted p-4">
          <AppText>{p.notice.text}</AppText>
        </View>
      )}

      {p.network === "unsupported" ? (
        <View accessibilityRole="alert" className="gap-3 rounded-tile border border-warning/30 bg-warning-soft p-4">
          <AppText>{"Your wallet is on a network Bytesac doesn't support yet. Switch to a supported network: Ethereum, Base, BNB Chain, Arbitrum or Solana."}</AppText>
          <Button onPress={p.onSwitchNetwork}>Switch network</Button>
        </View>
      ) : p.account ? (
        <>
          <View className="rounded-tile bg-surface-muted px-4">
            <Row label="Wallet" value={p.account.walletName ?? "Wallet"} />
            <Row label="Network" value={CHAINS[p.account.chain].label} />
            <View className="flex-row items-center justify-between">
              <AppText tone="muted">Address</AppText>
              <View className="flex-row items-center gap-1">
                <AppText className="font-medium">{shortAddress(p.account.address)}</AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Copy address"
                  className="min-h-11 min-w-11 items-center justify-center"
                  onPress={() => void Clipboard.setStringAsync(p.account!.address)}
                >
                  <Copy size={16} color={colors.inkMuted} />
                </Pressable>
              </View>
            </View>
          </View>
          <View className="flex-row gap-3 rounded-tile border border-success/30 bg-success-soft p-4">
            <ShieldCheck size={20} color={colors.success} />
            <AppText className="flex-1">{"You're signing a message to prove you control this address. It does not authorize any transaction or spending."}</AppText>
          </View>
          {p.picker}
          {err && (
            <View accessibilityRole="alert" className="gap-1 rounded-tile border border-danger/30 bg-danger-soft p-4">
              <AppText className="font-medium">{err.title}</AppText>
              <AppText tone="muted">{err.message}</AppText>
            </View>
          )}
          {primary}
          {busy ? <Button variant="secondary" onPress={p.onCancel}>Cancel</Button> : null}
          <Button variant="ghost" onPress={p.onChooseNetwork}>Choose network</Button>
          {p.onUseDifferentWallet ? <Button variant="ghost" onPress={p.onUseDifferentWallet}>Use a different wallet</Button> : null}
        </>
      ) : p.network === "none" ? (
        <Button size="lg" onPress={p.onConnect}>Connect wallet</Button>
      ) : null}
      <Button variant="ghost" onPress={p.onDisconnect}>Disconnect</Button>
    </Card>
  );
}

"use client";

import type { ApiClient } from "@repo/api-client";
import { describeError, PAYOUT_WALLET_STATUS_LABEL, shortAddress, WalletRejectedError } from "@repo/app-core";
import type { OrganizationDetail } from "@repo/validator";
import { Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { toDisplayError, type DisplayError } from "@/lib/errors";
import { useWalletConnector } from "@/lib/wallet/use-wallet-connector";

type Client = Pick<ApiClient, "enterPayoutWallet" | "createPayoutChallenge" | "verifyPayoutWallet">;

export function PayoutWallet({ org, onChange, client = api }: { org: OrganizationDetail; onChange(org: OrganizationDetail): void; client?: Client }) {
  const id = useId();
  const wallet = useWalletConnector();
  const [address, setAddress] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);

  const active = org.payoutWallets.find((w) => w.status === "VERIFIED");
  const pending = org.payoutWallets.find((w) => w.status === "UNVERIFIED" || w.status === "VERIFYING" || w.status === "REPLACEMENT_PENDING");
  // Wallet changes are refused by the API while the organization is under review.
  const canEdit = org.myPermissions.includes("payout.manage") && (org.status === "DRAFT" || org.status === "CHANGES_REQUIRED" || org.status === "VERIFIED");
  const toSign = canEdit && pending && pending.status !== "REPLACEMENT_PENDING" ? pending : undefined;
  const otherNetwork = wallet.account !== null && wallet.account.chain !== "solana";
  const showEntry = canEdit && pending?.status !== "REPLACEMENT_PENDING" && (!active || changing);
  const connected = toSign && wallet.account?.chain === "solana" && wallet.account.address === toSign.address;

  async function run(fn: () => Promise<OrganizationDetail>, done?: () => void) {
    setBusy(true);
    setError(null);
    try { onChange(await fn()); done?.(); } catch (e) {
      setError(e instanceof WalletRejectedError ? describeError("WALLET_REJECTED") : toDisplayError(e));
    } finally { setBusy(false); }
  }

  const sign = () => run(async () => {
    const ch = await client.createPayoutChallenge(org.id);
    const signature = await wallet.signMessage(ch.message);
    return client.verifyPayoutWallet(org.id, { challengeId: ch.challengeId, signature });
  }, () => setChanging(false));

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4">
      <div>
        <h3 id={`${id}-h`} className="font-display text-lg font-semibold text-ivory">Payout wallet</h3>
        <p className="text-xs text-muted-foreground">A Solana wallet you control. You prove it by signing a message; signing does not sign you in or authorize any transfer.</p>
      </div>

      {pending?.status === "REPLACEMENT_PENDING" && (
        <p role="status" className="rounded-xl border border-warning/40 bg-warning/5 p-3 text-sm text-ivory">
          Your new payout wallet <span className="font-mono">{shortAddress(pending.address)}</span> is awaiting review. The current wallet stays active until it is approved.
        </p>
      )}

      {showEntry && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run(() => client.enterPayoutWallet(org.id, { address: address.trim() }), () => setAddress("")); }}>
          <Label htmlFor={`${id}-a`} className="text-xs font-medium text-ivory">Solana wallet address</Label>
          <Input id={`${id}-a`} value={address} autoComplete="off" spellCheck={false} className="min-h-11 bg-space font-mono text-ivory" onChange={(e) => setAddress(e.target.value)} />
          <p className="text-xs text-muted-foreground">Entering an address does not prove ownership. You will sign next.</p>
          <Button type="submit" variant="secondary" className="min-h-11" disabled={!address.trim() || busy}>Save address</Button>
        </form>
      )}

      {toSign && (
        <div className="space-y-2 rounded-xl border border-border-dark p-3">
          <p className="text-sm text-ivory">Sign with <span className="font-mono">{shortAddress(toSign.address)}</span> to verify it.</p>
          {!connected && <p className="text-xs text-muted-foreground">Connect a Solana wallet with exactly this address.</p>}
          <Button className="min-h-11" disabled={busy} onClick={() => void (connected ? sign() : otherNetwork ? wallet.chooseNetwork() : wallet.connect())}>
            {busy && <Loader2 aria-hidden className="animate-spin" />}{connected ? "Sign message" : otherNetwork ? "Switch to Solana" : "Connect & sign"}
          </Button>
        </div>
      )}

      {canEdit && active && !changing && pending?.status !== "REPLACEMENT_PENDING" && !toSign && (
        <Button variant="secondary" className="min-h-11" onClick={() => setChanging(true)}>Change payout wallet</Button>
      )}
      {error && <p role="alert" className="text-sm text-danger"><span className="font-medium">{error.title}</span> {error.message}</p>}

      {org.payoutWallets.length > 0 && (
        <ul className="divide-y divide-border-dark" aria-label="Payout wallet history">
          {org.payoutWallets.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <span className="font-mono text-ivory" title={w.address}>{shortAddress(w.address)}</span>
              <StatusBadge {...PAYOUT_WALLET_STATUS_LABEL[w.status]} />
              <span className="text-xs text-stone">
                {w.activatedAt ? `Active since ${new Date(w.activatedAt).toLocaleDateString()}` : `Added ${new Date(w.createdAt).toLocaleDateString()}`}
                {w.deactivatedAt && ` · replaced ${new Date(w.deactivatedAt).toLocaleDateString()}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

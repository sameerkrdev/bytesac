"use client";

import { canAddChainAccount, shortAddress } from "@repo/app-core";
import { CHAINS, type MeResponse, type WalletAddressView } from "@repo/validator";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const METHOD_LABEL = { eoa_ecdsa: "Key signature", erc1271: "Smart wallet", erc6492: "Smart wallet (not yet deployed)", ed25519: "Key signature", bip322: "Bitcoin signature (BIP-322)", bip137: "Bitcoin signature (BIP-137)" } as const;

export function WalletSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState<WalletAddressView | null>(null);
  const onVerified = useCallback(() => { setOpen(false); setMoving(null); void qc.invalidateQueries({ queryKey: ["me"] }); }, [qc]);

  return (
    <section aria-labelledby="wallet-title" className="space-y-4 rounded-card border border-line bg-surface p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="wallet-title" className="type-heading text-ink">Investment wallet</h2>
          <p className="text-sm text-ink-muted">{me.wallet.walletProvider ?? "Wallet"} · one address per network</p>
        </div>
        {canAddChainAccount(me) && <Button variant="secondary"  onClick={() => setOpen(true)}><Plus aria-hidden />Add chain account</Button>}
      </div>
      <ul className="divide-y divide-line">
        {me.wallet.addresses.filter((a) => a.status !== "replaced").map((a) => (
          <li key={`${a.chain}:${a.address}`} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="w-28 rounded-control border border-line px-2 py-0.5 text-center text-xs text-ink">{CHAINS[a.chain].label}</span>
            <span className="text-ink-muted">{a.walletName ?? "Wallet"}</span>
            <span className="font-mono text-ink" title={a.address}>{shortAddress(a.address)}</span>
            <StatusBadge tone={a.status === "active" ? "success" : "danger"} label={a.status === "active" ? "Active" : "Disabled"} />
            <span className="text-xs text-ink-muted">{METHOD_LABEL[a.verificationMethod]}</span>
            {a.status === "active" && (
              <Button variant="ghost" className="ml-auto min-h-11" aria-label={`Move ${CHAINS[a.chain].label} to another wallet`} onClick={() => setMoving(a)}>Move to another wallet</Button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">Lost access to a wallet? Contact support.</p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-line bg-canvas">
          <DialogHeader>
            <DialogTitle className="text-ink">Add chain account</DialogTitle>
            <DialogDescription>Connect the other network in your wallet, then sign to prove you control it.</DialogDescription>
          </DialogHeader>
          {open && <WalletVerification purpose="add_chain_account" linkedAddresses={me.wallet.addresses} onVerified={onVerified} />}
        </DialogContent>
      </Dialog>
      <Dialog open={moving !== null} onOpenChange={(o) => !o && setMoving(null)}>
        <DialogContent className="border-line bg-canvas">
          <DialogHeader>
            <DialogTitle className="text-ink">{`Move ${moving ? CHAINS[moving.chain].label : ""} to another wallet`}</DialogTitle>
            <DialogDescription>{`Only possible when you hold nothing on ${moving ? CHAINS[moving.chain].label : "this chain"}. Connect the new wallet and sign, then approve in the current one to confirm.`}</DialogDescription>
          </DialogHeader>
          {moving && <WalletVerification purpose="reassign_chain" linkedAddresses={me.wallet.addresses} reassign={{ chain: moving.chain, previous: { address: moving.address, walletName: moving.walletName ?? null } }} onVerified={onVerified} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

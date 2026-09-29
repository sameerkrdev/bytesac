"use client";

import { canAddChainAccount } from "@repo/api-client";
import { CHAINS, type MeResponse } from "@repo/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { WalletVerification } from "@/components/auth/wallet-verification";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { shortAddress } from "@/lib/format";

const METHOD_LABEL = { eoa_ecdsa: "Key signature", erc1271: "Smart wallet", erc6492: "Smart wallet (not yet deployed)", ed25519: "Key signature" } as const;

export function WalletSection({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const onVerified = useCallback(() => { setOpen(false); void qc.invalidateQueries({ queryKey: ["me"] }); }, [qc]);

  return (
    <section aria-labelledby="wallet-title" className="space-y-4 rounded-2xl border border-border-dark bg-slate p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 id="wallet-title" className="font-display text-xl font-semibold text-ivory">Investment wallet</h2>
          <p className="text-sm text-muted-foreground">{me.wallet.walletProvider ?? "Wallet"} · one wallet, one address per network</p>
        </div>
        {canAddChainAccount(me) && <Button variant="secondary" className="min-h-11" onClick={() => setOpen(true)}><Plus aria-hidden />Add chain account</Button>}
      </div>
      <ul className="divide-y divide-border-dark">
        {me.wallet.addresses.map((a) => (
          <li key={`${a.chain}:${a.address}`} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="w-28 rounded-lg border border-border-dark px-2 py-0.5 text-center text-xs text-ivory">{CHAINS[a.chain].label}</span>
            <span className="font-mono text-ivory" title={a.address}>{shortAddress(a.address)}</span>
            <StatusBadge tone={a.status === "active" ? "success" : "danger"} label={a.status === "active" ? "Active" : "Disabled"} />
            <span className="text-xs text-stone">{METHOD_LABEL[a.verificationMethod]}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone">Lost access to a wallet? Contact support.</p>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border-border-dark bg-space">
          <DialogHeader>
            <DialogTitle className="font-display text-ivory">Add chain account</DialogTitle>
            <DialogDescription>Connect the other network in your wallet, then sign to prove you control it.</DialogDescription>
          </DialogHeader>
          {open && <WalletVerification purpose="add_chain_account" linkedAddresses={me.wallet.addresses} onVerified={onVerified} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

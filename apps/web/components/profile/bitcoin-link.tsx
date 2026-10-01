"use client";

import type { BitcoinConnector } from "@reown/appkit-adapter-bitcoin";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { isUserRejection, shortAddress, WalletRejectedError } from "@repo/app-core";
import type { MeResponse } from "@repo/validator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bitcoin, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toDisplayError } from "@/lib/errors";

/** Wallets return message signatures as base64 or hex; the API takes base64. */
const toBase64 = (sig: string) => (/^[0-9a-f]{130}$/i.test(sig) ? btoa(String.fromCharCode(...sig.match(/../g)!.map((h) => parseInt(h, 16)))) : sig);

/**
 * Links a Bitcoin address after sign-in (never a sign-in method). The server builds the BIP-322 `to_sign` PSBT with the challenge; the wallet only signs it
 * (`signPSBT`). Wallets that cannot (Reown's `signMessage` ignores the BIP-322 protocol) fall back to a BIP-137 message signature.
 */
export function BitcoinLink({ me }: { me: MeResponse }) {
  const qc = useQueryClient();
  const { open } = useAppKit();
  const account = useAppKitAccount({ namespace: "bip122" });
  const { walletProvider } = useAppKitProvider<BitcoinConnector>("bip122");
  const linked = me.wallet.addresses.find((a) => a.chain === "bitcoin" && a.status === "active");

  const link = useMutation({
    mutationFn: async (address: string) => {
      if (!walletProvider) throw new Error("Bitcoin wallet unavailable");
      const challenge = await api.createBitcoinChallenge({ address });
      let signature: string;
      let method: "bip322" | "bip137" = "bip322";
      try {
        const signed = await walletProvider.signPSBT({
          psbt: challenge.toSignPsbt, signInputs: [{ address, index: 0, sighashTypes: [address.startsWith("bc1p") ? 0 : 1] }], broadcast: false,
        });
        signature = signed.psbt;
      } catch (err) {
        if (isUserRejection(err)) throw new WalletRejectedError();
        // BIP-137 covers legacy and SegWit addresses; Taproot has no BIP-137.
        if (address.startsWith("bc1p")) throw err;
        method = "bip137";
        try {
          signature = toBase64(await walletProvider.signMessage({ message: challenge.message, address, protocol: "ecdsa" }));
        } catch (err2) {
          throw isUserRejection(err2) ? new WalletRejectedError() : err2;
        }
      }
      return api.verifyBitcoin({ challengeId: challenge.challengeId, address, signature, method });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const error = link.error ? toDisplayError(link.error) : null;

  return (
    <section aria-labelledby="bitcoin-title" className="space-y-4 rounded-2xl border border-border-dark bg-slate p-6">
      <div>
        <h2 id="bitcoin-title" className="font-display text-xl font-semibold text-ivory">Bitcoin wallet</h2>
        <p className="text-sm text-muted-foreground">Needed to invest in baskets that hold Bitcoin. You prove you control the address by signing a message. Nothing is spent.</p>
      </div>
      {linked ? (
        <p role="status" className="flex items-center gap-2 text-sm text-ivory"><CheckCircle2 aria-hidden className="size-4 text-success" />Linked <span className="font-mono" title={linked.address}>{shortAddress(linked.address)}</span></p>
      ) : account.isConnected && account.address ? (
        <div className="space-y-3">
          <p className="text-sm text-ivory">Connected <span className="font-mono" title={account.address}>{shortAddress(account.address)}</span></p>
          <Button className="min-h-11" disabled={link.isPending} onClick={() => link.mutate(account.address!)}>
            {link.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <Bitcoin aria-hidden />}Link this Bitcoin wallet
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="min-h-11" onClick={() => void open({ view: "Connect", namespace: "bip122" })}><Bitcoin aria-hidden />Connect a Bitcoin wallet</Button>
      )}
      {error && <div role="alert" className="rounded-xl border border-danger/40 p-4 text-sm text-ivory"><p className="font-medium">{error.title}</p>{error.message && <p className="text-stone">{error.message}</p>}</div>}
    </section>
  );
}

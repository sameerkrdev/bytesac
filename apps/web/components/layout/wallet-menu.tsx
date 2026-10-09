"use client";

import { Menu } from "@base-ui/react/menu";
import { useAppKit, useAppKitConnections, useDisconnect } from "@reown/appkit/react";
import { shortAddress } from "@repo/app-core";
import { ASSET_CHAINS, type MeResponse } from "@repo/validator";
import { Plug, Wallet } from "lucide-react";
import { same } from "@/lib/wallet/use-wallet-for-chain";

const item = "flex min-h-11 w-full cursor-default items-center gap-3 rounded-control px-3 text-sm text-ink outline-none select-none data-[highlighted]:bg-surface-muted";

/** Header menu of the wallets connected in this browser (Reown Multiwallet), with Reconnect for linked addresses that are not connected. */
export function WalletMenu({ me }: { me: MeResponse }) {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const eip155 = useAppKitConnections("eip155").connections;
  const solana = useAppKitConnections("solana").connections;
  const bip122 = useAppKitConnections("bip122").connections;
  const connections = [...eip155.map((c) => ({ c, namespace: "eip155" as const })), ...solana.map((c) => ({ c, namespace: "solana" as const })), ...bip122.map((c) => ({ c, namespace: "bip122" as const }))];
  const linked = me.wallet.addresses.filter((a) => a.status === "active");
  if (linked.length === 0) return null;
  const chainsOf = (address: string) => linked.filter((a) => same(a.address, address)).map((a) => ASSET_CHAINS[a.chain].label).join(", ");
  const connected = (address: string) => connections.some(({ c }) => c.accounts.some((a) => same(a.address, address)));
  // One Reconnect row per missing linked address (an address serves several chains).
  const missing = linked.filter((a, i) => !connected(a.address) && linked.findIndex((b) => same(b.address, a.address)) === i);
  return (
    <Menu.Root>
      <Menu.Trigger aria-label="Wallets" className="inline-flex size-11 items-center justify-center rounded-pill text-ink-muted transition-colors hover:text-ink data-[popup-open]:text-ink">
        <Wallet aria-hidden className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align="end" className="z-50">
          <Menu.Popup className="w-72 origin-[var(--transform-origin)] rounded-card border border-line bg-surface p-1.5 text-ink shadow-float">
            <Menu.Group>
              <Menu.GroupLabel className="px-3 pt-1 pb-2 type-eyebrow text-ink-faint">Connected wallets</Menu.GroupLabel>
              {connections.length === 0 && <p className="px-3 pb-2 text-sm text-ink-muted">None connected in this browser.</p>}
              {connections.map(({ c, namespace }) => (
                <div key={`${namespace}:${c.connectorId}`} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{c.name}</p>
                    {c.accounts.map((a) => <p key={a.address} className="text-xs text-ink-muted"><span className="font-mono">{shortAddress(a.address)}</span>{chainsOf(a.address) && ` · ${chainsOf(a.address)}`}</p>)}
                  </div>
                  <Menu.Item className="min-h-11 cursor-default rounded-control px-2 text-xs text-ink-muted outline-none data-[highlighted]:bg-surface-muted" aria-label={`Disconnect ${c.name}`} onClick={() => void disconnect({ id: c.connectorId, namespace })}>Disconnect</Menu.Item>
                </div>
              ))}
            </Menu.Group>
            {missing.length > 0 && (
              <Menu.Group>
                <Menu.Separator className="my-1.5 h-px bg-line" />
                <Menu.GroupLabel className="px-3 pt-1 pb-2 type-eyebrow text-ink-faint">Linked, not connected</Menu.GroupLabel>
                {missing.map((a) => (
                  <Menu.Item key={a.address} className={item} aria-label={`Reconnect ${a.walletName ?? "wallet"}`} onClick={() => void open({ view: "Connect" })}>
                    <Plug aria-hidden className="size-4 text-ink-muted" />
                    <span className="min-w-0 flex-1"><span className="block truncate">{a.walletName ?? "Wallet"}</span><span className="block text-xs text-ink-muted"><span className="font-mono">{shortAddress(a.address)}</span> · {chainsOf(a.address)}</span></span>
                  </Menu.Item>
                ))}
              </Menu.Group>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

"use client";

import { useAppKit, useAppKitAccount, useAppKitConnection, useAppKitConnections, useAppKitState, type Connection } from "@reown/appkit/react";
import { linkedAddressFor } from "@repo/app-core";
import { ASSET_CHAINS, type AssetChain, type MeResponse } from "@repo/validator";
import { createContext, createElement, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const NAMESPACE = { evm: "eip155", solana: "solana", bitcoin: "bip122" } as const;
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type Namespace = (typeof NAMESPACE)[keyof typeof NAMESPACE];
type Family = { connections: ReturnType<typeof useAppKitConnections>["connections"]; switchConnection?: ReturnType<typeof useAppKitConnection>["switchConnection"] };
const NONE: Record<Namespace, Family> = { eip155: { connections: [] }, solana: { connections: [] }, bip122: { connections: [] } };
const ConnectionsContext = createContext(NONE);

/**
 * Reown's multi-wallet hooks open a "Multi-Wallet Not Enabled" alert on every render until AppKit has fetched the project's remote config (it
 * starts as `{}` and is filled after the reconnect at startup), and the alert then shows in the next modal even though the dashboard feature is on.
 * So the hooks run only in this component, mounted once the remote config says `multiWallet` is on.
 */
function SyncConnections({ onChange }: { onChange: (families: Record<Namespace, Family>) => void }) {
  const eip155 = useAppKitConnections("eip155").connections;
  const solana = useAppKitConnections("solana").connections;
  const bip122 = useAppKitConnections("bip122").connections;
  const switches = { eip155: useAppKitConnection({ namespace: "eip155" }).switchConnection, solana: useAppKitConnection({ namespace: "solana" }).switchConnection, bip122: useAppKitConnection({ namespace: "bip122" }).switchConnection };
  // The hooks return new arrays on every render: publish only when the connected accounts change.
  const key = [eip155, solana, bip122].map((cs) => cs.map((c) => `${c.connectorId}:${c.accounts.map((a) => a.address).join(",")}`).join("|")).join(";");
  useEffect(() => {
    onChange({ eip155: { connections: eip155, switchConnection: switches.eip155 }, solana: { connections: solana, switchConnection: switches.solana }, bip122: { connections: bip122, switchConnection: switches.bip122 } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/** D-121: the wallets connected in this browser per namespace; empty (one wallet per family, as without the paid feature) until Reown's remote config enables Multiwallet. */
export function WalletConnectionsProvider({ children }: { children: ReactNode }) {
  const { multiWallet } = useAppKitState();
  const [families, setFamilies] = useState(NONE);
  return createElement(ConnectionsContext.Provider, { value: multiWallet ? families : NONE }, multiWallet ? createElement(SyncConnections, { onChange: setFamilies }) : null, children);
}

export const useWalletConnections = () => useContext(ConnectionsContext);

/** Opens Reown’s "Add EVM / Solana / Bitcoin wallet" list, which connects another wallet next to the current ones (Multiwallet); without Multiwallet, the plain Connect view. */
export function useAddWallet() {
  const { open } = useAppKit();
  const { multiWallet } = useAppKitState();
  return useCallback(() => open({ view: multiWallet ? "ProfileWallets" : "Connect" }), [open, multiWallet]);
}

/**
 * D-121: make the wallet linked to `chain` the active connection; "missing" when it is not connected in this browser (the caller prompts to connect it).
 * Without Multiwallet a namespace holds one connection, so a different linked wallet simply reads as missing.
 */
export function useWalletForChain(me: MeResponse | undefined) {
  const families = useWalletConnections();
  const active: Record<Namespace, string | undefined> = { eip155: useAppKitAccount({ namespace: "eip155" }).address, solana: useAppKitAccount({ namespace: "solana" }).address, bip122: useAppKitAccount({ namespace: "bip122" }).address };
  // Changes whenever a wallet is added, removed or switched; the signer uses it to retry once after the user connects.
  const connectionKey = (Object.keys(NONE) as Namespace[]).map((ns) => `${active[ns] ?? ""}|${families[ns].connections.flatMap((c) => c.accounts.map((a) => a.address)).join(",")}`).join(";");
  const ensure = useCallback(async (chain: AssetChain): Promise<"ready" | "missing"> => {
    const row = me ? linkedAddressFor(me.wallet.addresses, chain) : undefined;
    if (!row) return "missing";
    const ns = NAMESPACE[ASSET_CHAINS[chain].family];
    const address = active[ns];
    if (address && same(address, row.address)) return "ready";
    const f = families[ns];
    const holder = f.connections.find((c) => c.accounts.some((a) => same(a.address, row.address)));
    if (!holder || !f.switchConnection) return "missing";
    await f.switchConnection({ connection: holder as Connection, address: row.address });
    return "ready";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, connectionKey]);
  return { ensure, connectionKey };
}

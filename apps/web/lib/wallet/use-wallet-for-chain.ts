"use client";

import { useAppKitAccount, useAppKitConnection, useAppKitConnections } from "@reown/appkit/react";
import { linkedAddressFor } from "@repo/app-core";
import { ASSET_CHAINS, type AssetChain, type MeResponse } from "@repo/validator";
import { useCallback } from "react";

export const NAMESPACE = { evm: "eip155", solana: "solana", bitcoin: "bip122" } as const;
export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** One family's Reown state: its connections (several with the paid Multiwallet feature, at most one without), the active address and the switcher. */
function useFamily(namespace: (typeof NAMESPACE)[keyof typeof NAMESPACE]) {
  const { connections } = useAppKitConnections(namespace);
  const { switchConnection } = useAppKitConnection({ namespace });
  const { address } = useAppKitAccount({ namespace });
  return { connections, switchConnection, address };
}

/**
 * D-121: make the wallet linked to `chain` the active connection; "missing" when it is not connected in this browser (the caller prompts to connect it).
 * Without the paid Multiwallet feature a namespace holds one connection, so a different linked wallet simply reads as missing.
 */
export function useWalletForChain(me: MeResponse | undefined) {
  const families = { eip155: useFamily("eip155"), solana: useFamily("solana"), bip122: useFamily("bip122") };
  // Changes whenever a wallet is added, removed or switched; the signer uses it to retry once after the user connects.
  const connectionKey = Object.values(families).map((f) => `${f.address ?? ""}|${f.connections.flatMap((c) => c.accounts.map((a) => a.address)).join(",")}`).join(";");
  const ensure = useCallback(async (chain: AssetChain): Promise<"ready" | "missing"> => {
    const row = me ? linkedAddressFor(me.wallet.addresses, chain) : undefined;
    if (!row) return "missing";
    const f = families[NAMESPACE[ASSET_CHAINS[chain].family]];
    if (f.address && same(f.address, row.address)) return "ready";
    const holder = f.connections.find((c) => c.accounts.some((a) => same(a.address, row.address)));
    if (!holder) return "missing";
    await f.switchConnection({ connection: holder as never, address: row.address });
    return "ready";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, connectionKey]);
  return { ensure, connectionKey };
}

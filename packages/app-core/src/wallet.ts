import { chainFromEvmChainId, chainsInFamily, type AssetChain, type MeResponse, type SignInChain, type WalletAddressView } from "@repo/validator";

/** Solana mainnet-beta genesis hash used in CAIP-2 ids. */
const SOLANA_MAINNET_CAIP = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export function chainFromCaip(caipNetworkId: string | undefined): SignInChain | "unsupported" | null {
  if (!caipNetworkId) return null;
  if (caipNetworkId === SOLANA_MAINNET_CAIP) return "solana";
  const [ns, ref] = caipNetworkId.split(":");
  if (ns === "eip155" && ref) return chainFromEvmChainId(Number(ref)) ?? "unsupported";
  return "unsupported";
}

export function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  if (e.code === 4001 || e.name === "UserRejectedRequestError") return true;
  if (typeof e.message === "string" && /user (rejected|denied|cancel)/i.test(e.message)) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

export class WalletRejectedError extends Error {
  constructor() { super("User rejected the request"); this.name = "WalletRejectedError"; }
}

/** The wallet to sign with is not connected or is not the one linked to Bytesac; the message is fit to show. */
export class WrongWalletError extends Error {
  constructor(what: string) { super(`Connect the ${what} you linked to Bytesac, then try again.`); this.name = "WrongWalletError"; }
}

/** A connected wallet account on a supported chain (wallet-SDK independent). */
export interface ConnectedAccount {
  chain: SignInChain; address: string; walletName: string | null;
  /** D-119: chains the connection approved for this address (e.g. WalletConnect session accounts); undefined when the client cannot tell. */
  signableChains?: AssetChain[];
}

/** The active row for a chain (D-120: one address per chain). */
export function linkedAddressFor(addresses: readonly Pick<WalletAddressView, "chain" | "status">[], chain: AssetChain): WalletAddressView | undefined {
  return addresses.find((a) => a.chain === chain && a.status === "active") as WalletAddressView | undefined;
}

/** True while any EVM or Solana chain has no active address. */
export function canAddChainAccount(me: MeResponse): boolean {
  return ([...chainsInFamily("evm"), ...chainsInFamily("solana")] as AssetChain[]).some((c) => !linkedAddressFor(me.wallet.addresses, c));
}

/** D-120 checkbox screen: every chain of the family, what is linked where, and what to pre-tick (approved by the wallet and free). */
export function linkChoices(i: { family: "evm" | "solana"; approved: readonly AssetChain[] | undefined; addresses: readonly WalletAddressView[]; address: string; smartWalletChain?: AssetChain }) {
  const chains = i.smartWalletChain ? [i.smartWalletChain] : (chainsInFamily(i.family) as AssetChain[]);
  return chains.map((chain) => {
    const row = linkedAddressFor(i.addresses, chain);
    const same = row && (i.family === "solana" ? row.address === i.address : row.address.toLowerCase() === i.address.toLowerCase());
    const state = !row ? "available" as const : same ? "linked-here" as const : "linked-elsewhere" as const;
    return { chain, state, walletName: row?.walletName ?? null, preselected: state === "available" && (i.approved === undefined || i.approved.includes(chain)) };
  });
}

/** CAIP-2 ids of the mainnets Bytesac executes on, as asset chains (D-119). Testnets and other chains are not listed. */
const CAIP_ASSET_CHAIN: Readonly<Record<string, AssetChain>> = {
  "eip155:1": "ethereum", "eip155:8453": "base", "eip155:56": "bnb", "eip155:42161": "arbitrum", "eip155:137": "polygon",
  [SOLANA_MAINNET_CAIP]: "solana",
};

/** The chains a wallet approved (e.g. a WalletConnect session's CAIP-2 chain ids), reported at sign-in so later plans can warn (D-119). */
export function signableChainsFromCaip(caipIds: readonly string[]): AssetChain[] {
  return [...new Set(caipIds.map((id) => CAIP_ASSET_CHAIN[id]).filter((c): c is AssetChain => c !== undefined))];
}

/**
 * D-119: the chains of a plan the user's linked wallet cannot sign, once each in plan order. A chain whose own row has an unknown list (null)
 * or no active row never warns: receiving still works (an EOA has the same address on every EVM chain); only signing there later needs another wallet.
 */
export function uncoveredChains(chains: readonly AssetChain[], addresses: readonly Pick<WalletAddressView, "chain" | "status" | "signableChains">[]): AssetChain[] {
  const out: AssetChain[] = [];
  for (const c of chains) {
    if (out.includes(c)) continue;
    const list = linkedAddressFor(addresses, c)?.signableChains;
    if (list && !list.includes(c)) out.push(c);
  }
  return out;
}

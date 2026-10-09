import { ASSET_CHAINS, chainFromEvmChainId, type AssetChain, type MeResponse, type SignInChain, type WalletAddressView } from "@repo/validator";

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

export function canAddChainAccount(me: MeResponse): boolean {
  const a = me.wallet.addresses;
  const hasSolana = a.some((x) => x.chainFamily === "solana");
  const evm = a.filter((x) => x.chainFamily === "evm");
  const evmComplete = evm.length > 0 && (evm.some((x) => x.verificationMethod === "eoa_ecdsa") || evm.length === 4);
  return !(hasSolana && evmComplete);
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
 * D-119: the chains of a plan the user's linked wallet cannot sign, once each in plan order. A family whose list is unknown (null)
 * or has no active address never warns: receiving still works (an EOA has the same address on every EVM chain); only signing there later needs another wallet.
 */
export function uncoveredChains(chains: readonly AssetChain[], addresses: readonly Pick<WalletAddressView, "chainFamily" | "status" | "signableChains">[]): AssetChain[] {
  const out: AssetChain[] = [];
  for (const c of chains) {
    if (out.includes(c)) continue;
    const list = addresses.find((a) => a.status === "active" && a.chainFamily === ASSET_CHAINS[c].family)?.signableChains;
    if (list && !list.includes(c)) out.push(c);
  }
  return out;
}

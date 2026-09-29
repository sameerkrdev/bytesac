import { chainFromEvmChainId, type Chain } from "@repo/contracts";

/** Solana mainnet-beta genesis hash used in CAIP-2 ids. */
export const SOLANA_MAINNET_CAIP = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export function chainFromCaip(caipNetworkId: string | undefined): Chain | "unsupported" | null {
  if (!caipNetworkId) return null;
  if (caipNetworkId === SOLANA_MAINNET_CAIP) return "solana";
  const [ns, ref] = caipNetworkId.split(":");
  if (ns === "eip155" && ref) return chainFromEvmChainId(Number(ref)) ?? "unsupported";
  return "unsupported";
}

export function isUserRejection(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  if (e.code === 4001 || e.name === "UserRejectedRequestError" || e.name === "WalletSignMessageError") return true;
  if (typeof e.message === "string" && /reject|denied|cancel/i.test(e.message)) return true;
  return e.cause ? isUserRejection(e.cause) : false;
}

export class WalletRejectedError extends Error {
  constructor() { super("User rejected the request"); this.name = "WalletRejectedError"; }
}

/** A connected wallet account on a supported chain (wallet-SDK independent). */
export interface ConnectedAccount { chain: Chain; address: string; walletName: string | null }

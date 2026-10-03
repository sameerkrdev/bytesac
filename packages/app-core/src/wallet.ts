import { chainFromEvmChainId, type MeResponse, type SignInChain } from "@repo/validator";

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
export interface ConnectedAccount { chain: SignInChain; address: string; walletName: string | null }

export function canAddChainAccount(me: MeResponse): boolean {
  const a = me.wallet.addresses;
  const hasSolana = a.some((x) => x.chainFamily === "solana");
  const evm = a.filter((x) => x.chainFamily === "evm");
  const evmComplete = evm.length > 0 && (evm.some((x) => x.verificationMethod === "eoa_ecdsa") || evm.length === 4);
  return !(hasSolana && evmComplete);
}

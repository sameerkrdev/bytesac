import createHttpError from "http-errors";
import { createPublicClient, createWalletClient, erc20Abi, http, RpcRequestError, TransactionNotFoundError, TransactionReceiptNotFoundError, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, base, bsc, mainnet, polygon } from "viem/chains";
import type { AssetChain, Chain } from "@repo/validator";
import { env } from "../env";

const ALCHEMY_HOST: Partial<Record<AssetChain, string>> = {
  ethereum: "eth-mainnet",
  base: "base-mainnet",
  bnb: "bnb-mainnet",
  arbitrum: "arb-mainnet",
  polygon: "polygon-mainnet",
};

/** A JSON-RPC error that means "the call executed and reverted" (definitive), as opposed to node/rate-limit/internal errors. */
function isDefinitiveRevert(err: unknown): boolean {
  if (!(err instanceof RpcRequestError)) return false;
  return err.code === 3 || /execution reverted|revert/i.test(err.message + " " + String(err.details ?? ""));
}

/**
 * viem turns any eth_call failure (transport errors included) into "invalid" / a failed result. So we observe transport-level failures ourselves:
 * a failure that is not a definitive revert is remembered in `state.failure` and callers report it as unavailable.
 */
function observedClient(host: string) {
  const state: { failure?: unknown } = {};
  const base = http(`https://${host}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, { timeout: 5_000, retryCount: 1 });
  const observed: Transport = (args) => {
    const t = base(args);
    return {
      ...t,
      request: (async (req: unknown) => {
        try {
          return await (t.request as (r: unknown) => Promise<unknown>)(req);
        } catch (err) {
          if (!isDefinitiveRevert(err)) state.failure ??= err;
          throw err;
        }
      }) as typeof t.request,
    };
  };
  return { client: createPublicClient({ transport: observed }), state };
}

const unavailable = (message: string, cause: unknown) => createHttpError(message, { code: "VERIFIER_UNAVAILABLE", cause });

/**
 * ERC-1271 / ERC-6492 validation on `chain`. Returns false for a definitive "not valid";
 * throws 503 VERIFIER_UNAVAILABLE on transport failures.
 */
export async function verifyContractSignature(i: { chain: Chain; address: `0x${string}`; message: string; signature: `0x${string}` }): Promise<boolean> {
  const host = ALCHEMY_HOST[i.chain];
  if (!host) throw new Error("not an EVM chain");
  const failed = (cause: unknown) => unavailable("Wallet verification is temporarily unavailable. Please try again.", cause);
  const { client, state } = observedClient(host);
  let result: boolean;
  try {
    result = await client.verifyMessage({ address: i.address, message: i.message, signature: i.signature });
  } catch (err) {
    // Unknown/unclassified errors are treated as unavailable, never as "not valid".
    throw failed(state.failure ?? err);
  }
  if (state.failure !== undefined) throw failed(state.failure);
  return result;
}

/** Multicall3 has the same address on every chain the registry verifies. */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

/**
 * ERC-20 `decimals`/`symbol`/`name` in one read-only call. Returns null when the address is not an ERC-20 (`decimals` fails on-chain);
 * any transport or node failure throws 503 VERIFIER_UNAVAILABLE, never null.
 */
export async function readTokenMetadata(i: { chain: AssetChain; address: string }): Promise<{ decimals: number; symbol: string | null; name: string | null } | null> {
  const host = ALCHEMY_HOST[i.chain];
  if (!host) throw new Error("not an on-chain verified chain");
  const failed = (cause: unknown) => unavailable("Token verification is temporarily unavailable. Please try again.", cause);
  const { client, state } = observedClient(host);
  const token = { address: i.address as `0x${string}`, abi: erc20Abi } as const;
  let results;
  try {
    results = await client.multicall({
      contracts: [{ ...token, functionName: "decimals" }, { ...token, functionName: "symbol" }, { ...token, functionName: "name" }],
      multicallAddress: MULTICALL3,
      allowFailure: true,
    });
  } catch (err) {
    throw failed(state.failure ?? err);
  }
  // allowFailure also swallows a failed aggregate call, so a transport failure shows up as failed results.
  if (state.failure !== undefined) throw failed(state.failure);
  const [decimals, symbol, name] = results;
  if (decimals.status === "failure") return null;
  return { decimals: decimals.result, symbol: symbol.status === "success" ? symbol.result : null, name: name.status === "success" ? name.result : null };
}

/** Runs a read-only client call; any transport or node failure throws 503 VERIFIER_UNAVAILABLE (an unknown outcome is never a "no"). */
async function read<T>(chain: AssetChain, fn: (client: ReturnType<typeof observedClient>["client"]) => Promise<T>): Promise<T> {
  const host = ALCHEMY_HOST[chain];
  if (!host) throw new Error("not an EVM chain");
  const { client, state } = observedClient(host);
  let result: T;
  try {
    result = await fn(client);
  } catch (err) {
    throw unavailable("The chain is temporarily unavailable. Try again.", state.failure ?? err);
  }
  if (state.failure !== undefined) throw unavailable("The chain is temporarily unavailable. Try again.", state.failure);
  return result;
}

/** Balance in base units: native when `token` is null, otherwise the ERC-20 balance. */
export const evmBalance = (chain: AssetChain, owner: string, token: string | null): Promise<bigint> =>
  read(chain, (c) => token
    ? c.readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] })
    : c.getBalance({ address: owner as `0x${string}` }));

/** The transaction as mined or pending, or null when the node does not know the hash. */
export const evmTransaction = (chain: AssetChain, hash: string) =>
  read(chain, async (c) => {
    try {
      const t = await c.getTransaction({ hash: hash as `0x${string}` });
      return { from: t.from.toLowerCase(), to: t.to?.toLowerCase() ?? null, input: t.input, value: t.value, blockNumber: t.blockNumber };
    } catch (err) {
      if (err instanceof TransactionNotFoundError) return null;
      throw err;
    }
  });

/** Receipt status and the block it was mined in plus the chain head (for confirmation counting), or null while not mined. */
export const evmReceipt = (chain: AssetChain, hash: string) =>
  read(chain, async (c) => {
    try {
      const r = await c.getTransactionReceipt({ hash: hash as `0x${string}` });
      return { success: r.status === "success", blockNumber: r.blockNumber, head: await c.getBlockNumber(), logs: r.logs.map((l) => ({ address: l.address.toLowerCase(), topics: l.topics, data: l.data })) };
    } catch (err) {
      if (err instanceof TransactionReceiptNotFoundError) return null;
      throw err;
    }
  });

const GAS_CHAINS = { ethereum: mainnet, base, bnb: bsc, arbitrum, polygon } as const;

/** The platform EVM gas wallet; the key stays in this module. Empty `EVM_GAS_WALLET_SECRET` disables drops. */
const gasAccount = () => {
  if (!env.EVM_GAS_WALLET_SECRET) throw createHttpError("Gas drops are not configured.", { code: "VERIFIER_UNAVAILABLE" });
  return privateKeyToAccount(env.EVM_GAS_WALLET_SECRET as `0x${string}`);
};
export const gasWalletAddress = (): string => gasAccount().address.toLowerCase();

/** Sends `value` native units from the gas wallet exactly once; the hash is returned, confirmation is checked separately with `evmReceipt`. */
export async function sendNativeFromGasWallet(i: { chain: AssetChain; to: string; value: bigint }): Promise<string> {
  const host = ALCHEMY_HOST[i.chain];
  const chain = GAS_CHAINS[i.chain as keyof typeof GAS_CHAINS];
  if (!host || !chain) throw new Error("not an EVM chain");
  const client = createWalletClient({ account: gasAccount(), chain, transport: http(`https://${host}.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, { timeout: 10_000, retryCount: 0 }) });
  return client.sendTransaction({ to: i.to as `0x${string}`, value: i.value });
}

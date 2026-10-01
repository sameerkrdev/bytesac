import createHttpError from "http-errors";
import { minOut as slippageFloor, z, type AssetChain } from "@repo/validator";
import { env } from "../../env";
import { redis } from "../../middleware/rate-limit";
import type { ConnectionInput, LegQuoteInput, RouteProvider } from "./types";

const BASE_URL = "https://li.quest/v1";

/** LI.FI chain ids (docs.li.fi: EVM chains use their chain id; Solana 1151111081099710; Bitcoin 20000000000001). */
const CHAIN_IDS: Readonly<Record<AssetChain, number>> = {
  ethereum: 1, base: 8453, bnb: 56, arbitrum: 42161, polygon: 137, solana: 1151111081099710, bitcoin: 20000000000001,
};
/** LI.FI native token conventions: EVM zero address, Solana System Program id, Bitcoin "bitcoin". */
const NATIVE: Readonly<Record<AssetChain, string>> = {
  ethereum: "0x0000000000000000000000000000000000000000", base: "0x0000000000000000000000000000000000000000", bnb: "0x0000000000000000000000000000000000000000",
  arbitrum: "0x0000000000000000000000000000000000000000", polygon: "0x0000000000000000000000000000000000000000",
  solana: "11111111111111111111111111111111", bitcoin: "bitcoin",
};
const tokenId = (chain: AssetChain, token: string | null) => token ?? NATIVE[chain];
/** EVM addresses compare case-insensitively; Solana and Bitcoin ids are case-sensitive. */
const same = (a: string, b: string) => a === b || (a.startsWith("0x") && a.toLowerCase() === b.toLowerCase());

const unavailable = (message: string, cause?: unknown) => createHttpError(message, { code: "ROUTE_UNAVAILABLE", cause });

async function call(path: string, params: Record<string, string | number>): Promise<unknown> {
  if (!env.LIFI_API_KEY) throw unavailable("Routing is not configured.");
  try {
    const res = await fetch(`${BASE_URL}${path}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`, {
      headers: { "x-lifi-api-key": env.LIFI_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`LI.FI responded ${res.status}`);
    return await res.json();
  } catch (err) {
    throw unavailable("The route provider is unavailable. Try again.", err);
  }
}

const parse = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw unavailable("The route provider returned an unexpected response.", parsed.error);
  return parsed.data;
};

const token = z.object({ address: z.string(), chainId: z.number() });
const connectionsSchema = z.object({ connections: z.array(z.object({ fromTokens: z.array(token), toTokens: z.array(token) })) });
const quoteSchema = z.object({
  tool: z.string(),
  action: z.object({ fromChainId: z.number(), toChainId: z.number(), fromToken: token, toToken: token, fromAmount: z.string(), toAddress: z.string() }),
  estimate: z.object({ toAmount: z.string(), toAmountMin: z.string(), gasCosts: z.array(z.object({ amountUSD: z.string().nullish() })).optional() }),
  transactionRequest: z.object({ to: z.string().optional(), data: z.string(), value: z.string().nullish(), chainId: z.number().optional() }),
});
const statusSchema = z.object({
  status: z.enum(["NOT_FOUND", "INVALID", "PENDING", "DONE", "FAILED"]),
  substatus: z.string().optional(),
  receiving: z.object({ txHash: z.string().optional(), amount: z.string().optional() }).optional(),
});

const PSBT_HEX_MAGIC = "70736274ff";
const QUOTE_TTL_MS = 60_000;

export const lifi: RouteProvider = {
  id: "lifi",

  async connections(i: ConnectionInput) {
    const [fromToken, toToken] = [tokenId(i.fromChain, i.fromToken), tokenId(i.toChain, i.toToken)];
    const key = `lifi:conn:${CHAIN_IDS[i.fromChain]}:${fromToken}:${CHAIN_IDS[i.toChain]}:${toToken}`;
    const cached = await redis.get(key).catch(() => null);
    if (cached) return cached === "1";
    const { connections } = parse(connectionsSchema, await call("/connections", { fromChain: CHAIN_IDS[i.fromChain], toChain: CHAIN_IDS[i.toChain], fromToken, toToken }));
    const connected = connections.some((c) => c.fromTokens.some((t) => same(t.address, fromToken)) && c.toTokens.some((t) => same(t.address, toToken)));
    await redis.set(key, connected ? "1" : "0", "EX", 3600).catch(() => undefined);
    return connected;
  },

  async quote(i: LegQuoteInput) {
    if (i.fromChain === "solana" && !i.svmSponsor) throw new Error("A Solana source needs the platform fee payer (svmSponsor).");
    const [fromToken, toToken] = [tokenId(i.fromChain, i.fromToken), tokenId(i.toChain, i.toToken)];
    const q = parse(quoteSchema, await call("/quote", {
      fromChain: CHAIN_IDS[i.fromChain], toChain: CHAIN_IDS[i.toChain], fromToken, toToken, fromAmount: i.fromAmount.toString(),
      fromAddress: i.fromAddress, toAddress: i.toAddress, slippage: i.slippageBps / 10_000, integrator: env.LIFI_INTEGRATOR,
      ...(i.fromChain === "solana" ? { svmSponsor: i.svmSponsor! } : {}),
    }));
    // Provider responses are untrusted: the quote must be exactly the leg we asked for, delivered to the user's own address.
    const a = q.action;
    const estimatedOut = BigInt(q.estimate.toAmount);
    const minOut = BigInt(q.estimate.toAmountMin);
    if (
      a.fromChainId !== CHAIN_IDS[i.fromChain] || a.toChainId !== CHAIN_IDS[i.toChain] || !same(a.fromToken.address, fromToken) || !same(a.toToken.address, toToken)
      || BigInt(a.fromAmount) !== i.fromAmount || !same(a.toAddress, i.toAddress)
      // The route must enforce at least the slippage the user chose (1 unit of rounding allowed).
      || minOut + 1n < slippageFloor(estimatedOut, i.slippageBps)
    ) throw unavailable("The route provider returned a quote that does not match the leg.");

    const tx = q.transactionRequest;
    const data = tx.data.trim();
    const transaction = i.fromChain === "solana" ? { kind: "solana" as const, serializedBase64: data }
      : i.fromChain === "bitcoin" ? { kind: "bitcoin" as const, psbtBase64: data.toLowerCase().startsWith(PSBT_HEX_MAGIC) ? Buffer.from(data, "hex").toString("base64") : data }
        : { kind: "evm" as const, to: tx.to ?? "", data, value: BigInt(tx.value ?? 0).toString(), chainId: tx.chainId ?? CHAIN_IDS[i.fromChain] };
    if (transaction.kind === "evm" && !/^0x[0-9a-fA-F]{40}$/.test(transaction.to)) throw unavailable("The route provider returned a quote without a target contract.");

    return {
      estimatedOut, minOut, toolSummary: q.tool, transaction,
      gasEstimateUsd: (q.estimate.gasCosts ?? []).reduce((s, g) => s + Number(g.amountUSD ?? 0), 0),
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    };
  },

  async status(i) {
    const s = parse(statusSchema, await call("/status", { txHash: i.txHash, fromChain: CHAIN_IDS[i.fromChain], toChain: CHAIN_IDS[i.toChain] }));
    if (s.status === "INVALID") throw unavailable("The route provider rejected the status request.");
    if (s.status === "FAILED") return { state: "FAILED", reason: s.substatus ?? "FAILED" };
    if (s.status !== "DONE") return { state: "PENDING" };
    // DONE with REFUNDED or PARTIAL means the destination token was not delivered.
    if (s.substatus === "REFUNDED" || s.substatus === "PARTIAL") return { state: "FAILED", reason: s.substatus };
    return { state: "DONE", destinationTx: s.receiving?.txHash ?? null, receivedAmount: s.receiving?.amount ? BigInt(s.receiving.amount) : null };
  },
};

import createHttpError from "http-errors";
import { minOut as slippageFloor, z, type AssetChain } from "@repo/validator";
import { env } from "@/config/dotenv";
import { redis } from "@/middlewares/rate-limit.middleware";
import type { ConnectionInput, LegEstimateInput, LegQuoteInput, RouteFee, RouteProvider } from "./types";

const BASE_URL = "https://li.quest/v1";
/** Never route through a trade this far from the USD value in (docs.li.fi: `maxPriceImpact` hides routes above it; LI.FI defaults to 0.10). */
const MAX_PRICE_IMPACT = 0.05;

/** LI.FI chain ids (docs.li.fi: EVM chains use their chain id; Solana 1151111081099710; Bitcoin 20000000000001). */
export const CHAIN_IDS: Readonly<Record<AssetChain, number>> = {
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
/** LI.FI refused a plan-time quote because the wallet cannot fund it yet (code 1001, see `lifiCall`). */
export const isBuildRefusal = (err: unknown) => (err as { lifiCode?: number } | null)?.lifiCode === 1001;

/**
 * LI.FI request. A list param is sent once per item. An error body (`{ message, code, errors }`, codes 1000-1013 per docs.li.fi/api-reference/error-codes)
 * is mapped: the no-SOL refusal -> 409 SOL_REQUIRED; no route because of price impact -> 503 with the price-impact message; other refusals keep their
 * LI.FI code on `lifiCode` (1001 = the transaction could not be built, which is what an unfunded wallet gets).
 */
export async function lifiCall(path: string, o: { params?: Record<string, string | number | string[]>; body?: unknown; base?: string } = {}): Promise<unknown> {
  if (!env.LIFI_API_KEY) throw unavailable("Routing is not configured.");
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(o.params ?? {})) for (const item of Array.isArray(v) ? v : [v]) query.append(k, String(item));
  let res: Response;
  try {
    res = await fetch(`${o.base ?? BASE_URL}${path}?${query}`, {
      method: o.body === undefined ? "GET" : "POST",
      headers: { "x-lifi-api-key": env.LIFI_API_KEY, Accept: "application/json", ...(o.body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw unavailable("The route provider is unavailable. Try again.", err);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw refusal(res.status, body);
  return body;
}

function refusal(status: number, body: unknown): Error {
  const b = (body ?? {}) as { message?: unknown; code?: unknown };
  const text = JSON.stringify(body) ?? "";
  const message = typeof b.message === "string" ? b.message : "";
  // Live check 2026-10-03: a wallet with no SOL gets 404 code 1002 "No available quotes" with the cause in `errors.filteredOut[].reason` ("SOL balance insufficient to cover temporary token account creation"); svmSponsor does not avoid it. SOL is the cause only when no route failed and every filtered reason is the SOL one. The evidence is mayanFastMCTP-only: with all tools, the same wallet got sponsored quotes.
  const errs = (body as { errors?: { filteredOut?: { reason?: unknown }[]; failed?: unknown[] } } | null)?.errors;
  const needsSol = !errs?.failed?.length && !!errs?.filteredOut?.length && errs.filteredOut.every((r) => typeof r.reason === "string" && /SOL balance insufficient/i.test(r.reason));
  if (needsSol || (/\bSOL\b/.test(message) && /balance|rent|fee|gas|fund/i.test(message))) return createHttpError(409, "Add a small amount of SOL (~0.003) to your Solana wallet to continue.", { code: "SOL_REQUIRED" });
  if (/price.?impact/i.test(text)) return createHttpError("Price impact too high for this trade size.", { code: "ROUTE_UNAVAILABLE" });
  return createHttpError(`LI.FI responded ${status}`, { code: "ROUTE_UNAVAILABLE", lifiCode: typeof b.code === "number" ? b.code : undefined });
}

const parse = <T extends z.ZodType>(schema: T, body: unknown): z.infer<T> => {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw unavailable("The route provider returned an unexpected response.", parsed.error);
  return parsed.data;
};

const token = z.object({ address: z.string(), chainId: z.number() });
const toTokenSchema = token.extend({ decimals: z.number().int().min(0).optional().catch(undefined) });
const connectionsSchema = z.object({ connections: z.array(z.object({ fromTokens: z.array(token), toTokens: z.array(token) })) });
/** `estimate.gasCosts[]` as LI.FI returns it: decimal strings (`amount` in the native token's base units), plus the native token with its USD price. */
const gasCost = z.object({
  amountUSD: z.string().regex(/^\d+(\.\d+)?$/).nullish(),
  amount: z.string().regex(/^\d+$/).nullish(),
  token: z.object({ priceUSD: z.string().regex(/^\d+(\.\d+)?$/).nullish() }).nullish(),
});
const usd = z.string().regex(/^\d+(\.\d+)?$/).nullish();
/** `estimate.feeCosts[]`: LI.FI service fee, DEX and bridge fees; `included` = already deducted from the quoted amounts. */
const feeCost = z.object({ name: z.string(), amountUSD: usd, included: z.boolean() });
const stepEstimate = z.object({ gasCosts: z.array(gasCost).optional(), feeCosts: z.array(feeCost).optional() });
const quoteSchema = z.object({
  tool: z.string(),
  action: z.object({ fromChainId: z.number(), toChainId: z.number(), fromToken: token, toToken: toTokenSchema, fromAmount: z.string(), toAddress: z.string() }),
  estimate: stepEstimate.extend({ toAmount: z.string(), toAmountMin: z.string(), approvalAddress: z.string().nullish(), fromAmountUSD: usd, toAmountUSD: usd }),
  transactionRequest: z.object({ to: z.string().optional(), data: z.string(), value: z.string().nullish(), chainId: z.number().optional() }),
});
/** `POST /advanced/routes`: routes carry the USD totals; each step its tool and estimate. `routes: []` means nothing is available (`unavailableRoutes` says why). */
const routesSchema = z.object({
  routes: z.array(z.object({
    fromChainId: z.number(), toChainId: z.number(), fromToken: token, toToken: toTokenSchema, fromAmount: z.string(), toAmount: z.string(), toAmountMin: z.string(), fromAmountUSD: usd, toAmountUSD: usd,
    steps: z.array(z.object({ tool: z.string(), action: z.object({ fromChainId: z.number() }), estimate: stepEstimate })).min(1),
  })),
  unavailableRoutes: z.unknown().optional(),
});
const statusSchema = z.object({
  status: z.enum(["NOT_FOUND", "INVALID", "PENDING", "DONE", "FAILED"]),
  substatus: z.string().nullish(),
  // A partial or malformed token object is treated as absent (the leg then stays UNKNOWN for a person) rather than failing every status check.
  receiving: z.object({ txHash: z.string().optional(), token: z.object({ address: z.string(), decimals: z.number(), symbol: z.string() }).optional().catch(undefined) }).optional(),
});

/** Gas (from `gas` estimates: the source chain's), route fees (from `all` estimates) and price impact (from the USD totals) of a quote or route. */
function summarize(gas: z.infer<typeof stepEstimate>[], all: z.infer<typeof stepEstimate>[], total: { fromAmountUSD?: string | null; toAmountUSD?: string | null }) {
  const gasCosts = gas.flatMap((e) => e.gasCosts ?? []);
  const routeFees = all.flatMap((e) => e.feeCosts ?? []).map((f): RouteFee => ({ name: f.name, amountUsd: Number(f.amountUSD ?? 0), included: f.included }));
  // Fee-excluded impact: route fees already reduce toAmountUSD, so add the included ones back before comparing. Display/gate math only; it never sizes money.
  const from = Number(total.fromAmountUSD);
  const to = Number(total.toAmountUSD);
  const includedFees = routeFees.filter((f) => f.included).reduce((s, f) => s + f.amountUsd, 0);
  const priceImpact = total.fromAmountUSD && total.toAmountUSD && from > 0 && Number.isFinite(to) ? Math.max(0, 1 - (to + includedFees) / from) : null;
  // Backstop independent of LI.FI honoring maxPriceImpact; trades under $10 are not checked (USD values are too coarse).
  if (priceImpact !== null && from >= 10 && priceImpact > MAX_PRICE_IMPACT) throw createHttpError(503, "Price impact too high for this trade size.", { code: "ROUTE_UNAVAILABLE" });
  return {
    gasEstimateUsd: gasCosts.reduce((s, g) => s + Number(g.amountUSD ?? 0), 0),
    gasNative: gasCosts.reduce((s, g) => s + BigInt(g.amount ?? 0), 0n),
    nativePriceUsd: Number(gasCosts.find((g) => g.token?.priceUSD)?.token?.priceUSD) || null,
    priceImpact,
    routeFees,
  };
}

/**
 * LI.FI computes `toAmountMin` in floating point or rounds it per tool, so it can sit a hair under `toAmount x (1 - slippage)`: live checks (2026-10-03) on 18-decimal outputs showed
 * 350,000,000 base units under, where the old 1-unit tolerance refused a valid quote, and layerswap rounds 18-decimal amounts to 1e10 wei (about 2.7 ppm on a 0.00185 ETH leg).
 * Accepted: `quotedMin >= expectedMin - max(floor(expectedMin / 1e6), 10^(decimals - 8), 1)`, with the destination token's decimals capped at 18 (the response is untrusted); a minimum
 * weaker than the chosen slippage by more than that is still refused. ADR-017.
 */
export function minOutAccepted(quotedMin: bigint, estimatedOut: bigint, slippageBps: number, decimals = 0): boolean {
  const expected = slippageFloor(estimatedOut, slippageBps);
  const [ppm, unit] = [expected / 1_000_000n, 10n ** BigInt(Math.max(0, Math.min(decimals, 18) - 8))];
  return quotedMin + (ppm > unit ? ppm : unit) >= expected;
}
const PSBT_HEX_MAGIC = "70736274ff";
const QUOTE_TTL_MS = 60_000;

export const lifi: RouteProvider = {
  id: "lifi",

  async connections(i: ConnectionInput) {
    const [fromToken, toToken] = [tokenId(i.fromChain, i.fromToken), tokenId(i.toChain, i.toToken)];
    const key = `lifi:conn:${CHAIN_IDS[i.fromChain]}:${fromToken}:${CHAIN_IDS[i.toChain]}:${toToken}`;
    const cached = await redis.get(key).catch(() => null);
    if (cached) return cached === "1";
    const { connections } = parse(connectionsSchema, await lifiCall("/connections", { params: { fromChain: CHAIN_IDS[i.fromChain], toChain: CHAIN_IDS[i.toChain], fromToken, toToken } }));
    const connected = connections.some((c) => c.fromTokens.some((t) => same(t.address, fromToken)) && c.toTokens.some((t) => same(t.address, toToken)));
    await redis.set(key, connected ? "1" : "0", "EX", 3600).catch(() => undefined);
    return connected;
  },

  async estimate(i: LegEstimateInput) {
    const [fromToken, toToken] = [tokenId(i.fromChain, i.fromToken), tokenId(i.toChain, i.toToken)];
    const { routes, unavailableRoutes } = parse(routesSchema, await lifiCall("/advanced/routes", { body: {
      fromChainId: CHAIN_IDS[i.fromChain], toChainId: CHAIN_IDS[i.toChain], fromTokenAddress: fromToken, toTokenAddress: toToken, fromAmount: i.fromAmount.toString(), toAddress: i.toAddress,
      options: { slippage: i.slippageBps / 10_000, integrator: env.LIFI_INTEGRATOR, maxPriceImpact: MAX_PRICE_IMPACT, bridges: { deny: i.deny?.bridges ?? [] }, exchanges: { deny: i.deny?.exchanges ?? [] } },
    } }));
    const r = routes[0];
    if (!r) throw unavailable(/price.?impact/i.test(JSON.stringify(unavailableRoutes ?? null)) ? "Price impact too high for this trade size." : "No route is available for this trade.");
    // Provider responses are untrusted: the route must be exactly the trade we asked for.
    const estimatedOut = BigInt(r.toAmount);
    const minOut = BigInt(r.toAmountMin);
    if (
      r.fromChainId !== CHAIN_IDS[i.fromChain] || r.toChainId !== CHAIN_IDS[i.toChain] || !same(r.fromToken.address, fromToken) || !same(r.toToken.address, toToken) || BigInt(r.fromAmount) !== i.fromAmount
      || !minOutAccepted(minOut, estimatedOut, i.slippageBps, r.toToken.decimals)
    ) throw unavailable("The route provider returned a route that does not match the trade.");
    // The gas the user pays is the source chain's: steps that start on another chain are paid there.
    const own = r.steps.filter((s) => s.action.fromChainId === CHAIN_IDS[i.fromChain]).map((s) => s.estimate);
    return { estimatedOut, minOut, toolSummary: r.steps.map((s) => s.tool).join(" > "), transaction: null, ...summarize(own, r.steps.map((s) => s.estimate), r) };
  },

  async quote(i: LegQuoteInput) {
    if (i.fromChain === "solana" && !i.svmSponsor) throw new Error("A Solana source needs the platform fee payer (svmSponsor).");
    const [fromToken, toToken] = [tokenId(i.fromChain, i.fromToken), tokenId(i.toChain, i.toToken)];
    const q = parse(quoteSchema, await lifiCall("/quote", { params: {
      fromChain: CHAIN_IDS[i.fromChain], toChain: CHAIN_IDS[i.toChain], fromToken, toToken, fromAmount: i.fromAmount.toString(),
      fromAddress: i.fromAddress, toAddress: i.toAddress, slippage: i.slippageBps / 10_000, integrator: env.LIFI_INTEGRATOR, maxPriceImpact: MAX_PRICE_IMPACT,
      ...(i.deny?.bridges.length ? { denyBridges: i.deny.bridges } : {}), ...(i.deny?.exchanges.length ? { denyExchanges: i.deny.exchanges } : {}),
      ...(i.fromChain === "solana" ? { svmSponsor: i.svmSponsor! } : {}),
    } }));
    // Provider responses are untrusted: the quote must be exactly the leg we asked for, delivered to the user's own address.
    const a = q.action;
    const estimatedOut = BigInt(q.estimate.toAmount);
    const minOut = BigInt(q.estimate.toAmountMin);
    if (
      a.fromChainId !== CHAIN_IDS[i.fromChain] || a.toChainId !== CHAIN_IDS[i.toChain] || !same(a.fromToken.address, fromToken) || !same(a.toToken.address, toToken)
      || BigInt(a.fromAmount) !== i.fromAmount || !same(a.toAddress, i.toAddress)
      // The route must enforce at least the slippage the user chose (rounding allowed, see `minOutAccepted`).
      || !minOutAccepted(minOut, estimatedOut, i.slippageBps, a.toToken.decimals)
    ) throw unavailable("The route provider returned a quote that does not match the leg.");

    const tx = q.transactionRequest;
    const data = tx.data.trim();
    const transaction = i.fromChain === "solana" ? { kind: "solana" as const, serializedBase64: data }
      : i.fromChain === "bitcoin" ? { kind: "bitcoin" as const, psbtBase64: data.toLowerCase().startsWith(PSBT_HEX_MAGIC) ? Buffer.from(data, "hex").toString("base64") : data }
        : { kind: "evm" as const, to: tx.to ?? "", data, value: BigInt(tx.value ?? 0).toString(), chainId: tx.chainId ?? CHAIN_IDS[i.fromChain] };
    if (transaction.kind === "evm" && !/^0x[0-9a-fA-F]{40}$/.test(transaction.to)) throw unavailable("The route provider returned a quote without a target contract.");

    return { estimatedOut, minOut, toolSummary: q.tool, transaction, approvalAddress: q.estimate.approvalAddress ?? null, ...summarize([q.estimate], [q.estimate], q.estimate), expiresAt: new Date(Date.now() + QUOTE_TTL_MS) };
  },

  async status(i) {
    const s = parse(statusSchema, await lifiCall("/status", { params: { txHash: i.txHash, fromChain: CHAIN_IDS[i.fromChain], toChain: CHAIN_IDS[i.toChain] } }));
    const substatus = s.substatus ?? undefined;
    if (s.status === "INVALID") throw unavailable("The route provider rejected the status request.");
    // A refund is due (not processable): not a failure yet, the refund lands as REFUNDED. The leg stays pending and shows the substatus.
    if (s.status === "FAILED" && (substatus === "NOT_PROCESSABLE_REFUND_NEEDED" || substatus === "REFUND_IN_PROGRESS")) return { state: "PENDING", substatus };
    if (s.status === "FAILED") return { state: "FAILED", reason: substatus ?? "FAILED", substatus };
    if (s.status !== "DONE") return { state: "PENDING", substatus };
    // REFUNDED: the destination token was not delivered. PARTIAL: a different token was (funds did move): the tracker reads the chain and recovers, or leaves it for a person.
    if (substatus === "REFUNDED") return { state: "FAILED", reason: substatus, substatus };
    if (substatus === "PARTIAL") {
      const { txHash, token } = s.receiving ?? {};
      return { state: "UNKNOWN", reason: "The route delivered a different token than quoted.", substatus, receiving: txHash && token ? { txHash, token } : undefined };
    }
    // The amount LI.FI reports is not used: what arrived is read from the chain.
    return { state: "DONE", destinationTx: s.receiving?.txHash ?? null, substatus };
  },
};

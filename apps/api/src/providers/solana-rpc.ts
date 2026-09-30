import createHttpError from "http-errors";
import { z } from "@repo/validator";
import { env } from "../env";

const response = z.union([
  z.object({ result: z.object({ value: z.object({ decimals: z.number().int() }) }) }),
  z.object({ error: z.object({ code: z.number(), message: z.string() }) }),
]);

/**
 * Decimals of an SPL mint via read-only `getTokenSupply`. Returns null when the address is not a mint (RPC error -32602 "Invalid param"),
 * throws 503 VERIFIER_UNAVAILABLE on network, HTTP or any other RPC failure.
 */
export async function getMintDecimals(mint: string): Promise<number | null> {
  const unavailable = (cause?: unknown) => createHttpError("Token verification is temporarily unavailable. Please try again.", { code: "VERIFIER_UNAVAILABLE", cause });
  let body: unknown;
  try {
    const res = await fetch(`https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (err) {
    throw unavailable(err);
  }
  const parsed = response.safeParse(body);
  if (!parsed.success) throw unavailable(parsed.error);
  if ("error" in parsed.data) {
    if (parsed.data.error.code === -32602) return null;
    throw unavailable(parsed.data.error);
  }
  return parsed.data.result.value.decimals;
}

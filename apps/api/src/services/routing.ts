import { isNull } from "drizzle-orm";
import { db, routePolicyEntries } from "@repo/db";
import { ASSET_CHAINS, z, type AssetChain } from "@repo/validator";
import { redis } from "../middleware/rate-limit";
import { evmCode } from "../providers/evm-rpc";
import { lifiCall } from "../providers/routes/lifi";
import type { RouteDeny } from "../providers/routes/types";

const toolList = z.array(z.object({ key: z.string(), name: z.string() }));
const toolsSchema = z.object({ bridges: toolList, exchanges: toolList });

/** LI.FI bridges and exchanges (`GET /v1/tools`), cached 1 h. */
export async function lifiTools(): Promise<z.infer<typeof toolsSchema>> {
  const cached = await redis.get("lifi:tools").catch(() => null);
  if (cached) return toolsSchema.parse(JSON.parse(cached));
  const tools = toolsSchema.parse(await lifiCall("/tools"));
  await redis.set("lifi:tools", JSON.stringify(tools), "EX", 3600).catch(() => undefined);
  return tools;
}

const POLICY_TTL_MS = 60_000;
let policy: { at: number; rows: { kind: "bridge" | "exchange"; toolKey: string }[] } | null = null;
/** An ops change takes effect on this process at once; other processes pick it up within 60 s. */
export const forgetRoutePolicy = () => { policy = null; };

/**
 * What every LI.FI estimate and quote leaves out: the ops deny list (active `route_policy_entries`, cached 60 s in-process) plus, when the destination is an
 * EVM address with code (a contract: `eth_getCode`, cached 1 h), every Mayan bridge (`/v1/tools` keys starting with `mayan`), which delivers to EOAs only.
 */
export async function routeDenyList(toChain: AssetChain, toAddress: string): Promise<RouteDeny> {
  if (!policy || Date.now() - policy.at > POLICY_TTL_MS) {
    policy = { at: Date.now(), rows: await db.select({ kind: routePolicyEntries.kind, toolKey: routePolicyEntries.toolKey }).from(routePolicyEntries).where(isNull(routePolicyEntries.removedAt)) };
  }
  const bridges = new Set(policy.rows.filter((r) => r.kind === "bridge").map((r) => r.toolKey));
  if (ASSET_CHAINS[toChain].family === "evm") {
    const key = `code:${toChain}:${toAddress.toLowerCase()}`;
    let contract = await redis.get(key).catch(() => null);
    if (contract === null) {
      contract = (await evmCode(toChain, toAddress)) ? "1" : "0";
      await redis.set(key, contract, "EX", 3600).catch(() => undefined);
    }
    if (contract === "1") for (const b of (await lifiTools()).bridges) if (b.key.toLowerCase().startsWith("mayan")) bridges.add(b.key);
  }
  return { bridges: [...bridges], exchanges: policy.rows.filter((r) => r.kind === "exchange").map((r) => r.toolKey) };
}

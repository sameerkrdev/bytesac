import createHttpError from "http-errors";
import { desc, eq, isNull, sql } from "drizzle-orm";
import { db, isUniqueViolation, operationLegs, operations, routePolicyEntries } from "@repo/db";
import { ASSET_CHAINS, z, type AssetChain, type RoutePolicyInput } from "@repo/validator";
import { logger } from "@repo/logger";
import { redis } from "@/middlewares/rate-limit.middleware";
import { evmCode } from "@/providers/evm-rpc";
import { CHAIN_IDS, lifiCall } from "@/providers/routes/lifi";
import type { RouteDeny } from "@/providers/routes/types";
import { writeAudit } from "@/modules/audit/audit.service";
import type { OpsCtx } from "@/modules/manager-applications/applications.service";
import { addressOn, userAddresses } from "@/modules/auth/wallets.service";

const toolList = z.array(z.object({ key: z.string(), name: z.string() }));
const toolsSchema = z.object({ bridges: toolList, exchanges: toolList });

/** LI.FI bridges and exchanges (`GET /v1/tools`), cached 1 h. */
async function lifiTools(): Promise<z.infer<typeof toolsSchema>> {
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

const STALE_WARN_MS = 3_600_000;
const warned = new Map<string, number>();
/** A deny entry whose key LI.FI no longer lists is dropped from the request (fails open for a renamed tool): warn once per key per process-hour so ops see it. */
function warnStale(kind: string, toolKey: string) {
  const id = `${kind}:${toolKey}`;
  if (Date.now() - (warned.get(id) ?? 0) < STALE_WARN_MS) return;
  warned.set(id, Date.now());
  logger.warn("route policy: denied key not in LI.FI tools; dropped from the request", { kind, toolKey });
}

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
  // LI.FI answers 400 (code 1011) for the whole request when a deny key is not in /v1/tools (live check 2026-10-03), so a tool LI.FI has since retired is dropped here instead of failing every route.
  const exchanges = policy.rows.filter((r) => r.kind === "exchange").map((r) => r.toolKey);
  if (bridges.size === 0 && exchanges.length === 0) return { bridges: [], exchanges: [] };
  const tools = await lifiTools();
  const known = (list: { key: string }[]) => new Set(list.map((t) => t.key));
  const [bridgeKeys, exchangeKeys] = [known(tools.bridges), known(tools.exchanges)];
  for (const r of policy.rows) if (!(r.kind === "bridge" ? bridgeKeys : exchangeKeys).has(r.toolKey)) warnStale(r.kind, r.toolKey);
  return { bridges: [...bridges].filter((k) => bridgeKeys.has(k)), exchanges: exchanges.filter((k) => exchangeKeys.has(k)) };
}

/** The route policy for ops: every LI.FI bridge and exchange with its deny state, and the full history of deny/allow entries. */
export async function getRouting() {
  const [tools, entries] = await Promise.all([lifiTools(), db.select().from(routePolicyEntries).orderBy(desc(routePolicyEntries.createdAt), desc(routePolicyEntries.id))]);
  const listed = { bridge: new Set(tools.bridges.map((t) => t.key)), exchange: new Set(tools.exchanges.map((t) => t.key)) };
  const denied = (kind: "bridge" | "exchange", key: string) => entries.find((e) => e.kind === kind && e.toolKey === key && !e.removedAt)?.id ?? null;
  return {
    bridges: tools.bridges.map((t) => ({ key: t.key, name: t.name, denyEntryId: denied("bridge", t.key) })),
    exchanges: tools.exchanges.map((t) => ({ key: t.key, name: t.name, denyEntryId: denied("exchange", t.key) })),
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, toolKey: e.toolKey, reason: e.reason, createdBy: e.createdBy, createdAt: e.createdAt.toISOString(), removedBy: e.removedBy, removedAt: e.removedAt?.toISOString() ?? null, stale: !e.removedAt && !listed[e.kind].has(e.toolKey) })),
  };
}

/** Deny a LI.FI tool (its key must exist in `/v1/tools`): sent on every estimate and quote from now on. */
export async function denyTool(ctx: OpsCtx, body: RoutePolicyInput) {
  const tools = await lifiTools();
  if (!(body.kind === "bridge" ? tools.bridges : tools.exchanges).some((t) => t.key === body.toolKey)) throw createHttpError(`LI.FI has no ${body.kind} "${body.toolKey}".`, { code: "VALIDATION_FAILED" });
  try {
    const entry = await db.transaction(async (tx) => {
      const [row] = await tx.insert(routePolicyEntries).values({ ...body, createdBy: ctx.userId }).returning();
      await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "route_policy.denied", entityType: "route_policy_entry", entityId: row!.id, requestId: ctx.meta.requestId, metadata: { kind: body.kind, toolKey: body.toolKey, reason: body.reason } });
      return row!;
    });
    forgetRoutePolicy();
    return entry;
  } catch (err) {
    if (isUniqueViolation(err, "route_policy_active")) throw createHttpError(`That ${body.kind} is already denied.`, { code: "VALIDATION_FAILED" });
    throw err;
  }
}

/** Lift a deny: the row is kept (removed_at/removed_by) as history. */
export async function allowTool(ctx: OpsCtx, id: string) {
  const entry = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(routePolicyEntries).where(eq(routePolicyEntries.id, id)).for("update");
    if (!row) throw createHttpError("Route policy entry not found", { code: "NOT_FOUND" });
    if (row.removedAt) throw createHttpError(409, "This tool is already allowed.", { code: "INVALID_TRANSITION" });
    const [updated] = await tx.update(routePolicyEntries).set({ removedAt: sql`now()`, removedBy: ctx.userId }).where(eq(routePolicyEntries.id, id)).returning();
    await writeAudit(tx, { actorType: "user", actorUserId: ctx.userId, action: "route_policy.allowed", entityType: "route_policy_entry", entityId: id, requestId: ctx.meta.requestId, metadata: { kind: row.kind, toolKey: row.toolKey } });
    return updated!;
  });
  forgetRoutePolicy();
  return entry;
}

const ANALYTICS_BASE = "https://li.quest/v2";
const WINDOW_S = 24 * 3600;
const transfersSchema = z.object({ data: z.array(z.object({ sending: z.object({ timestamp: z.number().optional() }).loose().optional() }).loose()) });

/**
 * LI.FI's own record of the wallet's transfers around a leg's submission (+-24 h), as an aid for ops resolving a stuck leg: read-only, untrusted data, never
 * evidence (a resolve still needs the chain). The wallet is the user's address on the leg's source chain.
 */
export async function getLifiTransfers(opId: string, legId: string) {
  const [row] = await db.select({ leg: operationLegs, userId: operations.userId }).from(operationLegs).innerJoin(operations, eq(operations.id, operationLegs.operationId)).where(eq(operationLegs.id, legId));
  if (!row || row.leg.operationId !== opId) throw createHttpError("Leg not found", { code: "NOT_FOUND" });
  if (!row.leg.submittedAt) throw createHttpError(409, "This leg was never submitted.", { code: "INVALID_TRANSITION" });
  const wallet = addressOn(await userAddresses(db, row.userId), row.leg.fromChain);
  const at = Math.floor(row.leg.submittedAt.getTime() / 1000);
  const { data } = transfersSchema.parse(await lifiCall("/analytics/transfers", { base: ANALYTICS_BASE, params: { wallet, status: "ALL", limit: 100, fromTimestamp: at - WINDOW_S, toTimestamp: at + WINDOW_S } }));
  // The request carries the window; a record whose own timestamp is outside it is dropped as well.
  return { wallet, transfers: data.filter((t) => t.sending?.timestamp === undefined || Math.abs(t.sending.timestamp - at) <= WINDOW_S) };
}

const tokenListSchema = z.object({ tokens: z.record(z.string(), z.array(z.object({ address: z.string(), verificationStatus: z.string().optional() }))) });

/**
 * Whether LI.FI verifies a token (`/v1/tokens`, cached 24 h per chain as the verified-address list). Each token carries `verificationStatus` (live check 2026-10-03: "verified" or
 * "unverified"; not in the docs); a listed but unverified token is "unverified". "flagged" is reserved until a value for it is seen. null = unknown (native
 * asset, Bitcoin, or LI.FI unavailable): the asset review never fails because of it.
 */
export async function lifiVerification(chain: AssetChain, address: string | null): Promise<"verified" | "unverified" | "flagged" | null> {
  if (!address || chain === "bitcoin") return null;
  const key = `lifi:tokens:v2:${CHAIN_IDS[chain]}`; // v2: the list holds verified addresses only
  if (await redis.get(`${key}:down`).catch(() => null)) return null; // LI.FI failed a moment ago: not asked again for a minute
  const norm = (a: string) => (a.startsWith("0x") ? a.toLowerCase() : a);
  try {
    let listed: string[] | null = JSON.parse((await redis.get(key).catch(() => null)) ?? "null");
    if (!listed) {
      listed = (tokenListSchema.parse(await lifiCall("/tokens", { params: { chains: CHAIN_IDS[chain] } })).tokens[String(CHAIN_IDS[chain])] ?? []).filter((t) => t.verificationStatus === "verified").map((t) => norm(t.address));
      await redis.set(key, JSON.stringify(listed), "EX", 24 * 3600).catch(() => undefined);
    }
    return listed.includes(norm(address)) ? "verified" : "unverified";
  } catch {
    await redis.set(`${key}:down`, "1", "EX", 60).catch(() => undefined);
    return null;
  }
}

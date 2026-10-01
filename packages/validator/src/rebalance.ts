import { z } from "zod";
import type { AssetChain } from "./assets";
import { basketDiffSchema } from "./baskets";

export const MIN_TRADE_BPS_DEFAULT = 50;
export const MIN_TRADE_USDC_DEFAULT = "5";
export const DRIFT_THRESHOLD_BPS_DEFAULT = 500;

export interface PlanHolding { deploymentId: string; chain: AssetChain; quantity: bigint; decimals: number; priceMicro: bigint }
export interface PlanTarget { deploymentId: string; chain: AssetChain; decimals: number; priceMicro: bigint; bps: number }
export interface PlanInput { holdings: PlanHolding[]; cashMicro: bigint; targets: PlanTarget[]; minTradeBps: number; minTradeMicro: bigint; reserveMicro: bigint }
export interface PlanResult { valueMicro: bigint; sells: { deploymentId: string; chain: AssetChain; quantity: bigint; valueMicro: bigint }[]; buys: { deploymentId: string; chain: AssetChain; amountMicro: bigint }[] }

const abs = (x: bigint) => (x < 0n ? -x : x);
const valueOf = (q: bigint, price: bigint, decimals: number) => (q * price) / 10n ** BigInt(decimals);

/** Current holdings (reconciled, allocated) + basket cash → sells and buys toward the target weights. Removed assets are sold in full. */
export function planRebalance(i: PlanInput): PlanResult {
  const held = new Map(i.holdings.map((h) => [h.deploymentId, h]));
  const valueMicro = i.holdings.reduce((s, h) => s + valueOf(h.quantity, h.priceMicro, h.decimals), i.cashMicro);
  if (valueMicro <= 0n) return { valueMicro, sells: [], buys: [] };
  const sells: PlanResult["sells"] = [];
  const buys: PlanResult["buys"] = [];
  const targetIds = new Set(i.targets.map((t) => t.deploymentId));
  for (const h of i.holdings) {
    if (targetIds.has(h.deploymentId) || h.quantity <= 0n) continue;
    sells.push({ deploymentId: h.deploymentId, chain: h.chain, quantity: h.quantity, valueMicro: valueOf(h.quantity, h.priceMicro, h.decimals) });
  }
  for (const t of i.targets) {
    const h = held.get(t.deploymentId);
    const current = h ? valueOf(h.quantity, h.priceMicro, h.decimals) : 0n;
    const target = (valueMicro * BigInt(t.bps)) / 10_000n;
    const gap = target - current;
    const weightGapBps = abs((current * 10_000n) / valueMicro - BigInt(t.bps));
    if (weightGapBps < BigInt(i.minTradeBps) || abs(gap) < i.minTradeMicro) continue;
    if (gap > 0n) buys.push({ deploymentId: t.deploymentId, chain: t.chain, amountMicro: gap });
    else if (h) {
      const q = (-gap * 10n ** BigInt(h.decimals)) / h.priceMicro;
      const quantity = q < h.quantity ? q : h.quantity;
      if (quantity > 0n) sells.push({ deploymentId: h.deploymentId, chain: h.chain, quantity, valueMicro: valueOf(quantity, h.priceMicro, h.decimals) });
    }
  }
  const available = sells.reduce((s, x) => s + x.valueMicro, i.cashMicro) - i.reserveMicro;
  const wanted = buys.reduce((s, b) => s + b.amountMicro, 0n);
  if (wanted > available) {
    const scaled = scaleBuys(buys.map((b) => b.amountMicro), available > 0n ? available : 0n);
    buys.forEach((b, n) => (b.amountMicro = scaled[n]!));
  }
  return { valueMicro, sells, buys: buys.filter((b) => b.amountMicro > 0n) };
}

/** Proportional split of `available` over planned amounts; the last takes the rounding remainder so nothing is stranded. */
export function scaleBuys(planned: bigint[], available: bigint): bigint[] {
  const total = planned.reduce((s, p) => s + p, 0n);
  if (total === 0n) return planned.map(() => 0n);
  const out = planned.map((p) => (p * available) / total);
  out[out.length - 1] = available - out.slice(0, -1).reduce((s, x) => s + x, 0n);
  return out;
}

export type FeePlacement = { at: "first" | "after_sells"; fromCash: boolean };
/** D-071 extended (spec §4.4). null = refuse with INSUFFICIENT_BALANCE. */
export function feePlacement(i: { freeMicro: bigint; cashMicro: bigint; feeMicro: bigint; sellChains: AssetChain[] }): FeePlacement | null {
  if (i.freeMicro >= i.feeMicro) return { at: "first", fromCash: false };
  if (i.sellChains.length === 0) return i.cashMicro >= i.feeMicro ? { at: "first", fromCash: true } : null;
  return i.sellChains.every((c) => c === "solana") ? { at: "after_sells", fromCash: true } : null;
}

/** Received buy-back split by shortfall share; remainder to the largest (first listed on a tie); each capped at its shortfall (excess stays outside baskets). */
export function splitRepair(received: bigint, shares: { positionId: string; shortfall: bigint }[]): Map<string, bigint> {
  const total = shares.reduce((s, x) => s + x.shortfall, 0n);
  const parts = shares.map((s) => (total > 0n ? (received * s.shortfall) / total : 0n));
  const largest = shares.reduce((m, s, n) => (s.shortfall > shares[m]!.shortfall ? n : m), 0);
  parts[largest]! += received - parts.reduce((s, x) => s + x, 0n);
  return new Map(shares.map((s, n) => [s.positionId, parts[n]! < s.shortfall ? parts[n]! : s.shortfall]));
}

// ---------------------------------------------------------------------------------------------------------------------
// States and notification copy
// ---------------------------------------------------------------------------------------------------------------------

export const POSITION_HEADLINES = ["EXECUTION_PENDING", "REPAIR_REQUIRED", "EXECUTION_INCOMPLETE", "REBALANCE_AVAILABLE", "DRIFTED", "CUSTOMIZED", "ALIGNED"] as const;
export type Headline = (typeof POSITION_HEADLINES)[number];
export const positionStatesSchema = z.object({
  version: z.enum(["CURRENT", "OUT_OF_DATE", "SKIPPED"]),
  backing: z.enum(["VERIFIED", "REPAIR_REQUIRED", "DATA_STALE"]),
  allocation: z.enum(["ALIGNED", "WEIGHT_DRIFT", "CUSTOMIZED"]),
  execution: z.enum(["NONE", "PENDING", "INCOMPLETE"]),
});
export type PositionStates = z.infer<typeof positionStatesSchema>;

/** Priority order of spec §7; SKIPPED does not raise REBALANCE_AVAILABLE. */
export function headlineOf(s: PositionStates): Headline {
  if (s.execution === "PENDING") return "EXECUTION_PENDING";
  if (s.backing === "REPAIR_REQUIRED") return "REPAIR_REQUIRED";
  if (s.execution === "INCOMPLETE") return "EXECUTION_INCOMPLETE";
  if (s.version === "OUT_OF_DATE") return "REBALANCE_AVAILABLE";
  if (s.allocation === "WEIGHT_DRIFT") return "DRIFTED";
  if (s.allocation === "CUSTOMIZED") return "CUSTOMIZED";
  return "ALIGNED";
}

export const NOTIFICATION_KINDS = ["rebalance_available", "drifted", "repair_required", "execution_incomplete", "basket_paused", "basket_unpaused", "basket_retirement_pending", "basket_retired", "lead_changed"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Placeholder wording (compliance review later). Never states that a trade happened. */
export function notificationText(kind: NotificationKind, data: { basketName?: string; basketSlug?: string; positionId?: string; asset?: string }): { title: string; body: string; link: string } {
  const basket = data.basketName ?? "Your basket";
  const rebalance = `/portfolio/${data.positionId ?? ""}/rebalance`;
  const basketLink = data.basketSlug ? `/baskets/${data.basketSlug}` : "/portfolio";
  switch (kind) {
    case "rebalance_available": return { title: `${basket}: new version available`, body: "A new basket version is available. Applying creates a plan you review and sign; skipping changes nothing.", link: rebalance };
    case "drifted": return { title: `${basket} has drifted`, body: "Your basket has drifted from its target. You can review a rebalance plan or keep your allocation.", link: rebalance };
    case "repair_required": return { title: `${basket} needs attention`, body: "Wallet activity changed this basket's holdings. Review to buy back or update your baskets.", link: `/portfolio/repair/${data.asset ?? "cash"}` };
    case "execution_incomplete": return { title: `${basket}: plan incomplete`, body: "Your last plan did not finish. Review where it stopped and continue when you are ready.", link: rebalance };
    case "basket_paused": return { title: `${basket} is paused`, body: "The basket is paused. Your holdings are unchanged.", link: basketLink };
    case "basket_unpaused": return { title: `${basket} is active again`, body: "The basket is no longer paused.", link: basketLink };
    case "basket_retirement_pending": return { title: `${basket} is being retired`, body: "The basket is pending retirement. Your holdings are unchanged; nothing happens without your signature.", link: basketLink };
    case "basket_retired": return { title: `${basket} is retired`, body: "The basket has been retired. Your holdings are unchanged; you can sell or leave at any time.", link: basketLink };
    case "lead_changed": return { title: `${basket}: lead manager changed`, body: "The lead manager of this basket changed.", link: basketLink };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Requests and responses (rebalance/repair requests live in execution.ts beside the other plan requests)
// ---------------------------------------------------------------------------------------------------------------------

export const skipRequestSchema = z.strictObject({ versionId: z.uuid() });
export type SkipRequest = z.infer<typeof skipRequestSchema>;
export const syncRequestSchema = z.strictObject({
  asset: z.union([z.strictObject({ deploymentId: z.uuid() }), z.literal("cash")]),
  split: z.array(z.strictObject({ positionId: z.uuid(), quantity: z.string().regex(/^\d+$/).max(40) })).min(1).max(50),
  idempotencyKey: z.string().trim().min(8).max(128),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const syncResultSchema = z.object({ synced: z.array(z.object({ positionId: z.uuid(), quantity: z.string() })) });
export type SyncResult = z.infer<typeof syncResultSchema>;

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  basketId: z.uuid().nullable(),
  positionId: z.uuid().nullable(),
  title: z.string(),
  body: z.string(),
  link: z.string(),
  readAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type NotificationView = z.infer<typeof notificationSchema>;
export const notificationsPageSchema = z.object({ items: z.array(notificationSchema), unreadCount: z.number().int(), nextCursor: z.string().nullable() });
export type NotificationsPage = z.infer<typeof notificationsPageSchema>;
export const listNotificationsQuerySchema = z.strictObject({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });
export const markReadSchema = z.union([z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) }), z.strictObject({ all: z.literal(true) })]);
export const pushTokenSchema = z.strictObject({ token: z.string().min(1).max(4096), userAgent: z.string().max(300).optional() });
export type PushToken = z.infer<typeof pushTokenSchema>;

const count = z.union([z.number().int(), z.literal("<5")]);
export const adoptionSchema = z.object({
  versions: z.array(z.object({ versionId: z.uuid(), versionNumber: z.number().int(), openPositions: count, applied: count, skipped: count, notResponded: count, inProgress: count })),
});
export type Adoption = z.infer<typeof adoptionSchema>;

/** Portfolio additions, merged into `positionSchema` / `portfolioSchema` in execution.ts. */
export const positionExtrasSchema = z.object({
  states: positionStatesSchema,
  headline: z.enum(POSITION_HEADLINES),
  cashMicro: z.string(),
  latestVersion: z.object({ id: z.uuid(), number: z.number().int(), rationale: z.string().nullable(), diff: basketDiffSchema }).nullable(),
  appliedVersionNumber: z.number().int(),
  driftThresholdBps: z.number().int(),
});
export const repairSchema = z.object({
  asset: z.union([z.uuid(), z.literal("cash")]),
  symbol: z.string(),
  totalShortfall: z.string(),
  positions: z.array(z.object({ positionId: z.uuid(), basketSlug: z.string(), ledger: z.string(), shortfall: z.string() })),
});
export type Repair = z.infer<typeof repairSchema>;

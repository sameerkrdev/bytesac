import { z } from "zod";
import { decimalStringSchema, micro, type Fee } from "./baskets";

/** Below this (0.01 USDC) a fee is not charged; it is recorded as waived "dust". */
export const FEE_DUST_MICRO = 10_000n;
export const PLATFORM_FEE_OPERATIONS = ["invest", "rebalance_apply", "rebalance_drift", "repair", "sell_to_usdc", "sell_former"] as const;
export type PlatformFeeOperation = (typeof PLATFORM_FEE_OPERATIONS)[number];
export const FEE_KINDS = ["network", "manager_entry", "manager_rebalance", "platform"] as const;
export type FeeKind = (typeof FEE_KINDS)[number];
export const WAIVED_REASONS = ["payout_wallet_unavailable", "dust", "no_price"] as const;
export type WaivedReason = (typeof WAIVED_REASONS)[number];
export const FEE_SCOPES = ["default", "organization", "basket"] as const;

/** Micro-USDC as a plain decimal string without trailing zeros ("2.5", "0.1", "5"). */
export const microToUsdc = (m: bigint): string => `${m / 1_000_000n}.${String(m % 1_000_000n).padStart(6, "0")}`.replace(/\.?0+$/, "");

/** Manager entry/rebalance fee on `baseMicro`: percent floors and is capped by `maxUsdc`; fixed is the amount. */
export function managerFeeMicro(fee: Fee | undefined, baseMicro: bigint): bigint {
  if (!fee) return 0n;
  if (fee.type === "fixed") return micro(fee.amountUsdc);
  const pct = (baseMicro * BigInt(fee.bps)) / 10_000n;
  return fee.maxUsdc && pct > micro(fee.maxUsdc) ? micro(fee.maxUsdc) : pct;
}

export function platformFeeMicro(s: { bps: number; minMicro: bigint | null; maxMicro: bigint | null }, baseMicro: bigint): bigint {
  const pct = (baseMicro * BigInt(s.bps)) / 10_000n;
  if (s.bps === 0) return 0n;
  if (s.minMicro !== null && pct < s.minMicro) return s.minMicro;
  if (s.maxMicro !== null && pct > s.maxMicro) return s.maxMicro;
  return pct;
}

export interface ScheduleRow { scope: (typeof FEE_SCOPES)[number]; scopeId: string | null; operationKind: PlatformFeeOperation; supersededAt: Date | null; endsAt: Date | null }
/** Active basket override > active organization override > default; superseded or ended rows never apply. */
export function resolvePlatformSchedule<T extends ScheduleRow>(rows: T[], i: { organizationId: string | null; basketId: string | null; operation: PlatformFeeOperation; now: Date }): T | null {
  const live = rows.filter((r) => r.operationKind === i.operation && r.supersededAt === null && (r.endsAt === null || r.endsAt > i.now));
  return live.find((r) => r.scope === "basket" && r.scopeId === i.basketId)
    ?? live.find((r) => r.scope === "organization" && r.scopeId === i.organizationId)
    ?? live.find((r) => r.scope === "default") ?? null;
}

const positiveUsdc = decimalStringSchema.refine((d) => micro(d) > 0n, "Must be above zero.");
const minAboveMax = (v: { minUsdc?: string | undefined; maxUsdc?: string | undefined }) => !v.minUsdc || !v.maxUsdc || micro(v.minUsdc) <= micro(v.maxUsdc);
const minMaxIssue = { message: "The minimum can't be above the maximum.", path: ["minUsdc"] };

export const platformFeeScheduleInputSchema = z
  .strictObject({
    operationKind: z.enum(PLATFORM_FEE_OPERATIONS),
    bps: z.number().int().min(0).max(100),
    minUsdc: positiveUsdc.optional(),
    maxUsdc: positiveUsdc.optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(minAboveMax, minMaxIssue);
export type PlatformFeeScheduleInput = z.infer<typeof platformFeeScheduleInputSchema>;

export const platformFeeOverrideInputSchema = z
  .strictObject({
    scope: z.enum(["organization", "basket"]),
    scopeId: z.uuid(),
    operationKind: z.enum(PLATFORM_FEE_OPERATIONS),
    bps: z.number().int().min(0).max(100),
    minUsdc: positiveUsdc.optional(),
    maxUsdc: positiveUsdc.optional(),
    endsAt: z.iso.datetime({ offset: true }).refine((d) => new Date(d) > new Date(), "The end date must be in the future.").optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .refine(minAboveMax, minMaxIssue);
export type PlatformFeeOverrideInput = z.infer<typeof platformFeeOverrideInputSchema>;

export const platformFeeScheduleViewSchema = z.object({
  id: z.uuid(),
  scope: z.enum(FEE_SCOPES),
  scopeId: z.uuid().nullable(),
  operationKind: z.enum(PLATFORM_FEE_OPERATIONS),
  bps: z.number().int(),
  minUsdc: z.string().nullable(),
  maxUsdc: z.string().nullable(),
  endsAt: z.iso.datetime({ offset: true }).nullable(),
  reason: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  supersededAt: z.iso.datetime({ offset: true }).nullable(),
});
export type PlatformFeeScheduleView = z.infer<typeof platformFeeScheduleViewSchema>;
export const platformFeeListSchema = z.object({ items: z.array(platformFeeScheduleViewSchema) });
export type PlatformFeeList = z.infer<typeof platformFeeListSchema>;

export const operationFeeViewSchema = z.object({
  kind: z.enum(FEE_KINDS),
  amountMicro: z.string(),
  recipientLabel: z.string(),
  waivedReason: z.enum(WAIVED_REASONS).nullable(),
});
export type OperationFeeView = z.infer<typeof operationFeeViewSchema>;

const rateSchema = z.object({ operationKind: z.enum(PLATFORM_FEE_OPERATIONS), bps: z.number().int(), minUsdc: z.string().nullable(), maxUsdc: z.string().nullable() });
/** Public platform rates: no reason text. */
export const publicFeesSchema = z.object({ platform: z.array(rateSchema) });
export type PublicFees = z.infer<typeof publicFeesSchema>;

export const earningsQuerySchema = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  format: z.enum(["json", "csv"]).optional(),
});
export type EarningsQuery = z.infer<typeof earningsQuerySchema>;

export const earningsSchema = z.object({
  totalMicro: z.string(),
  waivedCount: z.number().int(),
  groups: z.array(z.object({ basketId: z.uuid().nullable(), basketName: z.string().nullable(), versionNumber: z.number().int().nullable(), kind: z.enum(FEE_KINDS), month: z.string(), amountMicro: z.string() })),
  recent: z.array(z.object({ settledAt: z.iso.datetime({ offset: true }), basketId: z.uuid().nullable(), kind: z.enum(FEE_KINDS), amountMicro: z.string(), tx: z.string().nullable(), explorerUrl: z.string().nullable() })),
});
export type Earnings = z.infer<typeof earningsSchema>;

export const revenueSchema = z.object({
  totalMicro: z.string(),
  platform: z.array(z.object({ operationKind: z.enum(PLATFORM_FEE_OPERATIONS), month: z.string(), amountMicro: z.string() })),
  waivedManager: z.array(z.object({ reason: z.enum(WAIVED_REASONS), count: z.number().int() })),
});
export type Revenue = z.infer<typeof revenueSchema>;

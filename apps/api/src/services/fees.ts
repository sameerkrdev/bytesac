import createHttpError from "http-errors";
import { and, eq, isNull } from "drizzle-orm";
import { organizationPayoutWallets, platformFeeSchedules, type DbOrTx } from "@repo/db";
import { logger } from "@repo/logger";
import {
  FEE_DUST_MICRO, managerFeeMicro, micro, networkFeeMicro, platformFeeMicro, resolvePlatformSchedule,
  type Fee, type FeeKind, type PlatformFeeOperation, type WaivedReason,
} from "@repo/validator";
import { env } from "../env";
import { SOL_USD_FALLBACK, TOKEN_ACCOUNT_RENT_LAMPORTS } from "../providers/solana-tx";
import { notifyOwner } from "./organizations";

export interface PlanFeesInput {
  networkMicro: bigint;
  operation: PlatformFeeOperation;
  /** null: no price for the platform fee base, so the platform fee is waived "no_price". */
  platformBaseMicro: bigint | null;
  manager: { kind: "manager_entry" | "manager_rebalance"; fee: Fee | undefined; baseMicro: bigint } | null;
  organizationId: string | null;
  basketId: string | null;
  usdcPrice: string;
}
export interface PlannedFee {
  kind: FeeKind; baseMicro: bigint; bps: number | null; capMicro: bigint | null; amountMicro: bigint; recipientAddress: string | null;
  scheduleId: string | null; waivedReason: WaivedReason | null; organizationId: string | null; basketId: string | null;
}
export interface PlannedFees {
  rows: PlannedFee[]; totalMicro: bigint; transfers: { recipient: string; amountMicro: bigint }[];
  /** Token-account rent the platform may fund for the manager and platform recipients (reserved with the plan). */
  rentLamports: bigint;
}

/**
 * Every fee of a plan, snapshotted now: network (always), manager (to the organization's VERIFIED payout wallet) and platform (the schedule in force now).
 * A fee below the dust threshold, a manager fee without a verified payout wallet and a platform fee without a price are recorded with a waiver, not charged.
 * The network row also carries the token-account rent of each charged manager/platform recipient (the platform may have to create that account).
 */
export async function planFees(conn: DbOrTx, i: PlanFeesInput): Promise<PlannedFees> {
  if (!env.GAS_TREASURY_SOLANA_ADDRESS) throw createHttpError("The gas treasury is not configured.", { code: "ROUTE_UNAVAILABLE" });
  const scope = { organizationId: i.organizationId, basketId: i.basketId };
  const row = (r: Pick<PlannedFee, "kind" | "baseMicro" | "amountMicro"> & Partial<PlannedFee>): PlannedFee => ({ bps: null, capMicro: null, recipientAddress: null, scheduleId: null, waivedReason: null, ...scope, ...r });
  const network = row({ kind: "network", baseMicro: 0n, amountMicro: i.networkMicro, recipientAddress: env.GAS_TREASURY_SOLANA_ADDRESS });
  const rows = [network];

  if (i.manager && i.organizationId) {
    const { kind, fee, baseMicro } = i.manager;
    const amount = managerFeeMicro(fee, baseMicro);
    const terms = { bps: fee?.type === "percent" ? fee.bps : null, capMicro: fee?.type === "percent" && fee.maxUsdc ? micro(fee.maxUsdc) : null };
    if (amount > 0n) {
      const [wallet] = await conn.select({ address: organizationPayoutWallets.address }).from(organizationPayoutWallets)
        .where(and(eq(organizationPayoutWallets.organizationId, i.organizationId), eq(organizationPayoutWallets.status, "VERIFIED"), eq(organizationPayoutWallets.chain, "solana")));
      if (!wallet) {
        rows.push(row({ kind, baseMicro, amountMicro: 0n, ...terms, waivedReason: "payout_wallet_unavailable" }));
        logger.warn("manager fee waived: no verified payout wallet", { organizationId: i.organizationId });
        // Log-only; one email per organization per UTC day (Resend dedupes on the key), so a plan that later fails is harmless.
        await notifyOwner(i.organizationId, "fee_waived", {}, `fee-waived/${i.organizationId}/${new Date().toISOString().slice(0, 10)}`);
      } else if (amount < FEE_DUST_MICRO) rows.push(row({ kind, baseMicro, amountMicro: 0n, ...terms, recipientAddress: wallet.address, waivedReason: "dust" }));
      else rows.push(row({ kind, baseMicro, amountMicro: amount, ...terms, recipientAddress: wallet.address }));
    }
  }

  const schedules = await conn.select().from(platformFeeSchedules).where(and(eq(platformFeeSchedules.operationKind, i.operation), isNull(platformFeeSchedules.supersededAt)));
  const schedule = resolvePlatformSchedule(schedules, { ...scope, operation: i.operation, now: new Date() });
  if (schedule && schedule.bps > 0) {
    const common = { kind: "platform" as const, bps: schedule.bps, capMicro: schedule.maxMicro === null ? null : BigInt(schedule.maxMicro), scheduleId: schedule.id };
    if (i.platformBaseMicro === null) rows.push(row({ ...common, baseMicro: 0n, amountMicro: 0n, waivedReason: "no_price" }));
    else {
      const amount = platformFeeMicro({ bps: schedule.bps, minMicro: schedule.minMicro === null ? null : BigInt(schedule.minMicro), maxMicro: common.capMicro }, i.platformBaseMicro);
      if (amount >= FEE_DUST_MICRO && !env.REVENUE_TREASURY_SOLANA_ADDRESS) throw createHttpError("The revenue treasury is not configured.", { code: "ROUTE_UNAVAILABLE" });
      rows.push(row({ ...common, baseMicro: i.platformBaseMicro, amountMicro: amount < FEE_DUST_MICRO ? 0n : amount, recipientAddress: env.REVENUE_TREASURY_SOLANA_ADDRESS || null, waivedReason: amount < FEE_DUST_MICRO ? "dust" : null }));
    }
  }

  const extra = BigInt(rows.filter((r) => r.kind !== "network" && r.amountMicro > 0n).length);
  if (extra > 0n) network.amountMicro += networkFeeMicro([(Number(TOKEN_ACCOUNT_RENT_LAMPORTS * extra) / 1e9) * SOL_USD_FALLBACK], i.usdcPrice);
  const transfers = rows.filter((r) => r.amountMicro > 0n).map((r) => ({ recipient: r.recipientAddress!, amountMicro: r.amountMicro }));
  return { rows, totalMicro: transfers.reduce((s, t) => s + t.amountMicro, 0n), transfers, rentLamports: TOKEN_ACCOUNT_RENT_LAMPORTS * extra };
}

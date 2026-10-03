import createHttpError from "http-errors";
import { PublicKey } from "@solana/web3.js";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, sql } from "drizzle-orm";
import { basketVersions, baskets, db, operationFees, operationLegs, operations, organizationPayoutWallets, organizations, platformFeeSchedules, type DbOrTx } from "@repo/db";
import { logger } from "@repo/logger";
import {
  FEE_DUST_MICRO, USDC_SOLANA_MINT, managerFeeMicro, micro, microToUsdc, networkFeeMicro, platformFeeMicro, resolvePlatformSchedule,
  type Earnings, type EarningsQuery, type Fee, type FeeKind, type PlatformFeeList, type PlatformFeeOperation, type PlatformFeeOverrideInput, type PlatformFeeScheduleInput, type PlatformFeeScheduleView, type Revenue, type WaivedReason,
} from "@repo/validator";
import { env } from "@/config/dotenv";
import { SOL_USD_FALLBACK, TOKEN_ACCOUNT_RENT_LAMPORTS, ata, connection, tokenAccountMissing } from "@/providers/solana-tx";
import { writeAudit } from "./audit";
import { requirePermission } from "./members";
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
  /** SOL price from the plan's route quotes, for the token-account rent; the fallback applies only when no quote carries one. */
  solPriceUsd?: number | null;
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
 * The network row also carries the token-account rent of each charged manager/platform recipient whose account is missing (the platform creates it).
 */
const validAddress = (a: string | undefined | null) => { try { return !!a && !!new PublicKey(a); } catch { return false; } };

export async function planFees(conn: DbOrTx, i: PlanFeesInput): Promise<PlannedFees> {
  if (!validAddress(env.GAS_TREASURY_SOLANA_ADDRESS)) throw createHttpError(503, "The gas treasury is not configured.", { code: "ROUTE_UNAVAILABLE" });
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
      if (!wallet || !validAddress(wallet.address)) {
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
      if (amount >= FEE_DUST_MICRO && !validAddress(env.REVENUE_TREASURY_SOLANA_ADDRESS)) throw createHttpError(503, "The revenue treasury is not configured.", { code: "ROUTE_UNAVAILABLE" });
      rows.push(row({ ...common, baseMicro: i.platformBaseMicro, amountMicro: amount < FEE_DUST_MICRO ? 0n : amount, recipientAddress: env.REVENUE_TREASURY_SOLANA_ADDRESS || null, waivedReason: amount < FEE_DUST_MICRO ? "dust" : null }));
    }
  }

  // Rent only for a recipient whose USDC token account does not exist yet (an RPC error counts as missing: the estimate stays conservative).
  const charged = rows.filter((r) => r.kind !== "network" && r.amountMicro > 0n);
  const missing = await Promise.all([...new Set(charged.map((r) => r.recipientAddress!))].map((a) => tokenAccountMissing(a, USDC_SOLANA_MINT)));
  const extra = BigInt(missing.filter(Boolean).length);
  if (extra > 0n) network.amountMicro += networkFeeMicro([(Number(TOKEN_ACCOUNT_RENT_LAMPORTS * extra) / 1e9) * (i.solPriceUsd ?? SOL_USD_FALLBACK)], i.usdcPrice);
  const transfers = rows.filter((r) => r.amountMicro > 0n).map((r) => ({ recipient: r.recipientAddress!, amountMicro: r.amountMicro }));
  return { rows, totalMicro: transfers.reduce((s, t) => s + t.amountMicro, 0n), transfers, rentLamports: TOKEN_ACCOUNT_RENT_LAMPORTS * extra };
}

// ---------------------------------------------------------------------------------------------------------------------
// Platform fee schedules (ops)
// ---------------------------------------------------------------------------------------------------------------------

type Actor = { userId: string; requestId: string };
const iso = (d: Date | null) => d?.toISOString() ?? null;
const usdc = (m: string | null) => (m === null ? null : microToUsdc(BigInt(m)));
const scheduleView = (r: typeof platformFeeSchedules.$inferSelect): PlatformFeeScheduleView => ({
  id: r.id, scope: r.scope, scopeId: r.scopeId, operationKind: r.operationKind, bps: r.bps, minUsdc: usdc(r.minMicro), maxUsdc: usdc(r.maxMicro),
  endsAt: iso(r.endsAt), reason: r.reason, createdAt: r.createdAt.toISOString(), supersededAt: iso(r.supersededAt),
});

/** The default schedule's history, or (overrides) the organization and basket overrides' history; newest first. */
export async function listSchedules(overrides: boolean): Promise<PlatformFeeList> {
  const rows = await db.select().from(platformFeeSchedules).where(overrides ? ne(platformFeeSchedules.scope, "default") : eq(platformFeeSchedules.scope, "default"))
    .orderBy(desc(platformFeeSchedules.createdAt), desc(platformFeeSchedules.id)).limit(500);
  return { items: rows.map(scheduleView) };
}

/**
 * Saves a new schedule row and supersedes the active one for the same (scope, scope id, operation) in the same transaction. The advisory lock makes concurrent
 * saves for one key run one after the other, so exactly one row stays active (the partial unique index is the backstop). Existing plans are never touched.
 */
export async function saveSchedule(actor: Actor, i: PlatformFeeScheduleInput | PlatformFeeOverrideInput): Promise<PlatformFeeScheduleView> {
  const [scope, scopeId] = "scope" in i ? [i.scope, i.scopeId] : (["default", null] as const);
  const endsAt = "endsAt" in i && i.endsAt ? new Date(i.endsAt) : null;
  if (scope !== "default") {
    const [target] = scope === "organization" ? await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, scopeId!)) : await db.select({ id: baskets.id }).from(baskets).where(eq(baskets.id, scopeId!));
    if (!target) throw createHttpError(`${scope === "organization" ? "Organization" : "Basket"} not found`, { code: "NOT_FOUND" });
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`platform_fee:${scope}${scopeId ?? ""}${i.operationKind}`}))`);
    const [previous] = await tx.update(platformFeeSchedules).set({ supersededAt: sql`now()` })
      .where(and(eq(platformFeeSchedules.scope, scope), scopeId ? eq(platformFeeSchedules.scopeId, scopeId) : isNull(platformFeeSchedules.scopeId), eq(platformFeeSchedules.operationKind, i.operationKind), isNull(platformFeeSchedules.supersededAt)))
      .returning({ id: platformFeeSchedules.id });
    const [row] = await tx.insert(platformFeeSchedules).values({
      scope, scopeId, operationKind: i.operationKind, bps: i.bps, minMicro: i.minUsdc ? micro(i.minUsdc).toString() : null, maxMicro: i.maxUsdc ? micro(i.maxUsdc).toString() : null,
      endsAt, reason: i.reason, createdBy: actor.userId,
    }).returning();
    await writeAudit(tx, {
      actorType: "user", actorUserId: actor.userId, requestId: actor.requestId, action: "platform_fee.updated", entityType: "platform_fee_schedule", entityId: row!.id,
      metadata: { scope, scopeId, operationKind: i.operationKind, bps: i.bps, minUsdc: i.minUsdc ?? null, maxUsdc: i.maxUsdc ?? null, endsAt: endsAt?.toISOString() ?? null, reason: i.reason, supersededId: previous?.id ?? null },
    });
    return scheduleView(row!);
  });
}

/** Ends an override now (no new row). The default schedule can only be replaced, never ended. */
export async function endOverride(actor: Actor, id: string): Promise<PlatformFeeScheduleView> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(platformFeeSchedules).where(eq(platformFeeSchedules.id, id)).for("update");
    if (!row) throw createHttpError("Fee override not found", { code: "NOT_FOUND" });
    if (row.scope === "default") throw createHttpError("The default schedule can't be ended. Set its rate to 0 to stop charging.", { code: "VALIDATION_FAILED" });
    if (row.supersededAt) throw createHttpError(409, "This override has already ended.", { code: "INVALID_TRANSITION" });
    const [ended] = await tx.update(platformFeeSchedules).set({ supersededAt: sql`now()` }).where(eq(platformFeeSchedules.id, id)).returning();
    await writeAudit(tx, {
      actorType: "user", actorUserId: actor.userId, requestId: actor.requestId, action: "platform_fee.override_ended", entityType: "platform_fee_schedule", entityId: id,
      metadata: { scope: row.scope, scopeId: row.scopeId, operationKind: row.operationKind },
    });
    return scheduleView(ended!);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Earnings (organization) and revenue (ops): settled fees only
// ---------------------------------------------------------------------------------------------------------------------

const MANAGER_KINDS = ["manager_entry", "manager_rebalance"] as const;
const month = sql<string>`to_char(date_trunc('month', ${operationFees.settledAt} at time zone 'UTC'), 'YYYY-MM')`;
const settledBetween = (q: EarningsQuery) => and(isNotNull(operationFees.settledAt), q.from ? gte(operationFees.settledAt, new Date(q.from)) : undefined, q.to ? lte(operationFees.settledAt, new Date(q.to)) : undefined);
/** One CSV line: a value starting with = + - @ tab or CR gets a leading ', one with a comma, quote or line break is quoted, quotes doubled. */
const csvLine = (cols: (string | null)[]) => cols.map((raw) => {
  const c = raw !== null && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw; // a spreadsheet would run it as a formula
  return c !== null && /[",\r\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : (c ?? "");
}).join(",");
const explorer = (tx: string | null) => (tx ? `https://solscan.io/tx/${tx}` : null);

/** Settled manager fees of the organization (the caller needs `earnings.read`); waived and unsettled fees are not in the totals. */
export async function getEarnings(userId: string, orgId: string, q: EarningsQuery): Promise<Earnings> {
  await requirePermission(db, userId, orgId, "earnings.read");
  const where = and(eq(operationFees.organizationId, orgId), inArray(operationFees.kind, [...MANAGER_KINDS]), settledBetween(q));
  const groups = await db.select({
    basketId: operationFees.basketId, basketName: basketVersions.name, versionNumber: basketVersions.versionNumber, kind: operationFees.kind, month, amount: sql<string>`sum(${operationFees.amountMicro})`,
  }).from(operationFees).innerJoin(operations, eq(operations.id, operationFees.operationId)).leftJoin(basketVersions, eq(basketVersions.id, operations.versionId))
    .where(where).groupBy(operationFees.basketId, basketVersions.name, basketVersions.versionNumber, operationFees.kind, month).orderBy(desc(month), asc(operationFees.basketId), asc(operationFees.kind));
  const recent = await db.select({ settledAt: operationFees.settledAt, basketId: operationFees.basketId, kind: operationFees.kind, amount: operationFees.amountMicro, tx: operationLegs.sourceTx })
    .from(operationFees).leftJoin(operationLegs, eq(operationLegs.id, operationFees.legId)).where(where).orderBy(desc(operationFees.settledAt), desc(operationFees.id)).limit(50);
  const [waived] = await db.select({ n: sql<number>`count(*)::int` }).from(operationFees).where(and(
    eq(operationFees.organizationId, orgId), inArray(operationFees.kind, [...MANAGER_KINDS]), isNotNull(operationFees.waivedReason),
    q.from ? gte(operationFees.createdAt, new Date(q.from)) : undefined, q.to ? lte(operationFees.createdAt, new Date(q.to)) : undefined,
  ));
  return {
    totalMicro: groups.reduce((s, g) => s + BigInt(g.amount), 0n).toString(), waivedCount: waived!.n,
    groups: groups.map((g) => ({ basketId: g.basketId, basketName: g.basketName, versionNumber: g.versionNumber, kind: g.kind, month: g.month, amountMicro: g.amount })),
    recent: recent.map((r) => ({ settledAt: r.settledAt!.toISOString(), basketId: r.basketId, kind: r.kind, amountMicro: r.amount, tx: r.tx, explorerUrl: explorer(r.tx) })),
  };
}

/** One row per settled manager fee: date, basket, version, kind, amount in USDC and the fee transaction. */
export async function getEarningsCsv(userId: string, orgId: string, q: EarningsQuery): Promise<string> {
  await requirePermission(db, userId, orgId, "earnings.read");
  const rows = await db.select({ settledAt: operationFees.settledAt, basket: basketVersions.name, version: basketVersions.versionNumber, kind: operationFees.kind, amount: operationFees.amountMicro, tx: operationLegs.sourceTx })
    .from(operationFees).innerJoin(operations, eq(operations.id, operationFees.operationId)).leftJoin(basketVersions, eq(basketVersions.id, operations.versionId)).leftJoin(operationLegs, eq(operationLegs.id, operationFees.legId))
    .where(and(eq(operationFees.organizationId, orgId), inArray(operationFees.kind, [...MANAGER_KINDS]), settledBetween(q))).orderBy(asc(operationFees.settledAt), asc(operationFees.id));
  return [csvLine(["date", "basket", "version", "kind", "amount_usdc", "tx"]), ...rows.map((r) => csvLine([r.settledAt!.toISOString(), r.basket, r.version?.toString() ?? null, r.kind, microToUsdc(BigInt(r.amount)), r.tx]))].join("\n") + "\n";
}

/** Platform fees by operation kind and month (settled only) and the manager fees that were waived, by reason. */
export async function getRevenue(q: EarningsQuery): Promise<Revenue> {
  const platform = await db.select({ operationKind: platformFeeSchedules.operationKind, month, amount: sql<string>`sum(${operationFees.amountMicro})` })
    .from(operationFees).innerJoin(platformFeeSchedules, eq(platformFeeSchedules.id, operationFees.scheduleId))
    .where(and(eq(operationFees.kind, "platform"), settledBetween(q))).groupBy(platformFeeSchedules.operationKind, month).orderBy(desc(month), asc(platformFeeSchedules.operationKind));
  const waived = await db.select({ reason: operationFees.waivedReason, n: sql<number>`count(*)::int` }).from(operationFees).where(and(
    inArray(operationFees.kind, [...MANAGER_KINDS]), isNotNull(operationFees.waivedReason), q.from ? gte(operationFees.createdAt, new Date(q.from)) : undefined, q.to ? lte(operationFees.createdAt, new Date(q.to)) : undefined,
  )).groupBy(operationFees.waivedReason).orderBy(asc(operationFees.waivedReason));
  return {
    totalMicro: platform.reduce((s, p) => s + BigInt(p.amount), 0n).toString(),
    platform: platform.map((p) => ({ operationKind: p.operationKind, month: p.month, amountMicro: p.amount })),
    waivedManager: waived.map((w) => ({ reason: w.reason as WaivedReason, count: w.n })),
  };
}

export async function getRevenueCsv(q: EarningsQuery): Promise<string> {
  const rows = await db.select({ settledAt: operationFees.settledAt, operationKind: platformFeeSchedules.operationKind, amount: operationFees.amountMicro, tx: operationLegs.sourceTx })
    .from(operationFees).innerJoin(platformFeeSchedules, eq(platformFeeSchedules.id, operationFees.scheduleId)).leftJoin(operationLegs, eq(operationLegs.id, operationFees.legId))
    .where(and(eq(operationFees.kind, "platform"), settledBetween(q))).orderBy(asc(operationFees.settledAt), asc(operationFees.id));
  return [csvLine(["date", "operation", "amount_usdc", "tx"]), ...rows.map((r) => csvLine([r.settledAt!.toISOString(), r.operationKind, microToUsdc(BigInt(r.amount)), r.tx]))].join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------------------------------
// Revenue reconciliation (read-only)
// ---------------------------------------------------------------------------------------------------------------------

/** The fee's on-chain time when known, else when it was recorded: the day it belongs to for comparison with the treasury's history. */
const chainDay = sql<Date>`coalesce(${operationFees.settledChainAt}, ${operationFees.settledAt})`;

/**
 * Compares the platform fees settled in a UTC day (default: yesterday) with the USDC that arrived in the revenue treasury's token account that day (signatures
 * and parsed balance changes from Solana RPC). A difference logs `revenue reconciliation mismatch` with both totals; an RPC failure logs a warning. Never throws,
 * never writes: a mismatch is for people to look at (a settlement and its on-chain time may fall on either side of midnight).
 */
export async function reconcileRevenue(day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)): Promise<void> {
  if (!env.REVENUE_TREASURY_SOLANA_ADDRESS) return;
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 86_400_000);
  try {
    const owner = new PublicKey(env.REVENUE_TREASURY_SOLANA_ADDRESS);
    const [settled] = await db.select({ total: sql<string>`coalesce(sum(${operationFees.amountMicro}), 0)` }).from(operationFees)
      .where(and(eq(operationFees.kind, "platform"), sql`${chainDay} >= ${start.toISOString()}::timestamptz`, sql`${chainDay} < ${end.toISOString()}::timestamptz`));
    // Signatures come newest first, up to 1,000 per page: page back until the day is behind us.
    const signatures: string[] = [];
    for (let before: string | undefined; ;) {
      const page = await connection.getSignaturesForAddress(ata(owner, new PublicKey(USDC_SOLANA_MINT)), { before, limit: 1000 }, "finalized");
      for (const s of page) if (!s.err && s.blockTime != null && s.blockTime * 1000 >= start.getTime() && s.blockTime * 1000 < end.getTime()) signatures.push(s.signature);
      const oldest = page.at(-1);
      if (!oldest || page.length < 1000 || (oldest.blockTime != null && oldest.blockTime * 1000 < start.getTime())) break;
      before = oldest.signature;
    }
    let inflow = 0n;
    for (let n = 0; n < signatures.length; n += 50) {
      const txs = await connection.getParsedTransactions(signatures.slice(n, n + 50), { commitment: "finalized", maxSupportedTransactionVersion: 0 });
      for (const tx of txs) {
        if (!tx?.meta || tx.meta.err) continue;
        const sum = (rows: typeof tx.meta.postTokenBalances) => (rows ?? []).filter((b) => b.owner === owner.toBase58() && b.mint === USDC_SOLANA_MINT).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
        const delta = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
        if (delta > 0n) inflow += delta;
      }
    }
    if (BigInt(settled!.total) !== inflow) logger.warn("revenue reconciliation mismatch", { day, settledMicro: settled!.total, onChainMicro: inflow.toString() });
    else logger.info("revenue reconciled", { day, totalMicro: inflow.toString() });
  } catch (err) {
    logger.warn("revenue reconciliation failed", { day, errMessage: err instanceof Error ? err.message : "unknown" });
  }
}

import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { assetChain, instrumentDeployments } from "./assets";
import { basketVersions, baskets } from "./baskets";
import { app } from "./enums";
import { users } from "./identity";

export const positionStatus = app.enum("position_status", ["OPEN", "CLOSED"]);
export const ledgerReason = app.enum("ledger_reason", ["invest", "sell"]);
export const operationKind = app.enum("operation_kind", ["invest", "sell_to_usdc", "sell_former"]);
export const operationStatus = app.enum("operation_status", ["PLANNED", "IN_PROGRESS", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"]);
export const legKind = app.enum("leg_kind", ["network_fee", "swap", "cross_chain"]);
export const legStatus = app.enum("leg_status", ["PLANNED", "SUBMITTING", "SUBMITTED", "PENDING_CHAIN", "SETTLED", "FAILED", "UNKNOWN"]);
export const gasPayer = app.enum("gas_payer", ["platform_fee_payer", "platform_gas_drop", "user_btc_inputs"]);
export const platformWalletPurpose = app.enum("platform_wallet_purpose", ["solana_fee_payer", "evm_gas", "gas_treasury"]);
export const gasDropStatus = app.enum("gas_drop_status", ["pending", "confirmed", "failed"]);
export const reconciliationStatus = app.enum("reconciliation_status", ["OK", "SHORT", "SURPLUS"]);

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const basketPositions = app.table(
  "basket_positions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    basketId: uuid("basket_id").notNull().references(() => baskets.id),
    status: positionStatus("status").notNull().default("OPEN"),
    appliedVersionId: uuid("applied_version_id").notNull().references(() => basketVersions.id),
    openedAt: ts("opened_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    uniqueIndex("basket_positions_one_open").on(t.userId, t.basketId).where(sql`${t.status} = 'OPEN'`),
    index("basket_positions_user_idx").on(t.userId),
    check("basket_positions_closed_at", sql`(${t.status} = 'CLOSED') = (${t.closedAt} is not null)`),
  ],
);

/** One operation per user may be PLANNED or IN_PROGRESS; idempotency keys are unique per user. Money columns hold raw base units (micro-USDC). */
export const operations = app.table(
  "operations",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    basketId: uuid("basket_id").notNull().references(() => baskets.id),
    positionId: uuid("position_id").references(() => basketPositions.id),
    kind: operationKind("kind").notNull(),
    status: operationStatus("status").notNull().default("PLANNED"),
    /** Invest only. */
    amountUsdc: numeric("amount_usdc"),
    /** Sell only. */
    sellPercent: integer("sell_percent"),
    slippageBps: integer("slippage_bps").notNull(),
    networkFeeUsdc: numeric("network_fee_usdc").notNull(),
    versionId: uuid("version_id").notNull().references(() => basketVersions.id),
    idempotencyKey: text("idempotency_key").notNull(),
    expiresAt: ts("expires_at").notNull(),
    /** Platform gas reserved with the plan, per chain in native base units (the budget day is `created_at` in UTC); emptied when the unspent part is released on CANCELLED. */
    gasReserved: jsonb("gas_reserved").$type<Record<string, string>>().notNull().default({}),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("operations_user_idempotency_key").on(t.userId, t.idempotencyKey),
    uniqueIndex("operations_one_active_per_user").on(t.userId).where(sql`${t.status} in ('PLANNED', 'IN_PROGRESS')`),
    check("operations_slippage_range", sql`${t.slippageBps} between 1 and 300`),
    check("operations_sell_percent_range", sql`${t.sellPercent} is null or ${t.sellPercent} between 1 and 100`),
  ],
);

/** USDC on Solana is the settlement asset, not a registry route: its side of a leg has a null deployment. */
export const operationLegs = app.table(
  "operation_legs",
  {
    id: id(),
    operationId: uuid("operation_id").notNull().references(() => operations.id),
    sequence: integer("sequence").notNull(),
    kind: legKind("kind").notNull(),
    fromChain: assetChain("from_chain").notNull(),
    fromDeploymentId: uuid("from_deployment_id").references(() => instrumentDeployments.id),
    toChain: assetChain("to_chain").notNull(),
    toDeploymentId: uuid("to_deployment_id").references(() => instrumentDeployments.id),
    amountIn: numeric("amount_in").notNull(),
    minOut: numeric("min_out"),
    provider: text("provider"),
    routeSummary: jsonb("route_summary").$type<Record<string, unknown>>(),
    quoteExpiresAt: ts("quote_expires_at"),
    builtMessageHash: text("built_message_hash"),
    /** What the planner expects the signed transaction to be: EVM `{ to, dataHash, value }`, Bitcoin `{ outputs }`. */
    expectedTx: jsonb("expected_tx").$type<Record<string, unknown>>(),
    status: legStatus("status").notNull().default("PLANNED"),
    sourceTx: text("source_tx"),
    destinationTx: text("destination_tx"),
    amountReceived: numeric("amount_received"),
    gasPayer: gasPayer("gas_payer"),
    failureReason: text("failure_reason"),
    submittedAt: ts("submitted_at"),
    unknownSince: ts("unknown_since"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("operation_legs_sequence").on(t.operationId, t.sequence),
    // A transaction is one leg's: the claim (SUBMITTING) records the deterministic id before anything is sent.
    uniqueIndex("operation_legs_source_tx").on(t.fromChain, t.sourceTx).where(sql`${t.sourceTx} is not null`),
    check("operation_legs_amount_positive", sql`${t.amountIn} > 0`),
  ],
);

/** Append-only. A holding is the sum of `quantity_delta` per deployment; one entry per leg and deployment. */
export const positionLedgerEntries = app.table(
  "position_ledger_entries",
  {
    id: id(),
    positionId: uuid("position_id").notNull().references(() => basketPositions.id),
    deploymentId: uuid("deployment_id").notNull().references(() => instrumentDeployments.id),
    /** Raw base units, signed. */
    quantityDelta: numeric("quantity_delta").notNull(),
    reason: ledgerReason("reason").notNull(),
    legId: uuid("leg_id").notNull().references(() => operationLegs.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("position_ledger_leg_deployment").on(t.legId, t.deploymentId), index("position_ledger_position_idx").on(t.positionId, t.deploymentId)],
);

export const platformWallets = app.table(
  "platform_wallets",
  {
    id: id(),
    chain: assetChain("chain").notNull(),
    purpose: platformWalletPurpose("purpose").notNull(),
    address: text("address").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("platform_wallets_chain_purpose").on(t.chain, t.purpose)],
);

/** One drop per leg. `amount_native` is in the chain's native base units (wei). */
export const gasDrops = app.table(
  "gas_drops",
  {
    id: id(),
    legId: uuid("leg_id").notNull().references(() => operationLegs.id),
    chain: assetChain("chain").notNull(),
    recipient: text("recipient").notNull(),
    amountNative: numeric("amount_native").notNull(),
    txHash: text("tx_hash"),
    status: gasDropStatus("status").notNull().default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gas_drops_leg_key").on(t.legId)],
);

/** Daily sponsored gas per user and chain, in native base units (lamports, wei); row-locked by `reserveGas`. */
export const sponsorUsage = app.table(
  "sponsor_usage",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    chain: assetChain("chain").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    amountNative: numeric("amount_native").notNull().default("0"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.chain, t.day] }), index("sponsor_usage_chain_day_idx").on(t.chain, t.day)],
);

/** Append-only history; the latest row per (position, deployment) is current. */
export const positionReconciliations = app.table(
  "position_reconciliations",
  {
    id: id(),
    positionId: uuid("position_id").notNull().references(() => basketPositions.id),
    deploymentId: uuid("deployment_id").notNull().references(() => instrumentDeployments.id),
    ledgerQuantity: numeric("ledger_quantity").notNull(),
    allocatedQuantity: numeric("allocated_quantity").notNull(),
    walletBalance: numeric("wallet_balance").notNull(),
    status: reconciliationStatus("status").notNull(),
    checkedAt: ts("checked_at").notNull().defaultNow(),
  },
  (t) => [index("position_reconciliations_latest_idx").on(t.positionId, t.deploymentId, t.checkedAt)],
);

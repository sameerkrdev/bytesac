import { sql } from "drizzle-orm";
import { check, index, integer, numeric, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { baskets } from "./baskets";
import { app } from "./enums";
import { operationLegs, operations } from "./execution";
import { users } from "./identity";
import { organizations } from "./organizations";

export const feeKind = app.enum("fee_kind", ["network", "manager_entry", "manager_rebalance", "platform"]);
export const platformFeeOperation = app.enum("platform_fee_operation", ["invest", "rebalance_apply", "rebalance_drift", "repair", "sell_to_usdc", "sell_former"]);
export const feeScope = app.enum("fee_scope", ["default", "organization", "basket"]);

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Platform fee rates; a new row supersedes the active one for the same (scope, scope_id, operation). */
export const platformFeeSchedules = app.table(
  "platform_fee_schedules",
  {
    id: id(),
    scope: feeScope("scope").notNull(),
    scopeId: uuid("scope_id"),
    operationKind: platformFeeOperation("operation_kind").notNull(),
    bps: integer("bps").notNull(),
    minMicro: numeric("min_micro"),
    maxMicro: numeric("max_micro"),
    endsAt: ts("ends_at"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    supersededAt: ts("superseded_at"),
  },
  (t) => [
    check("platform_fee_bps_range", sql`${t.bps} between 0 and 100`),
    check("platform_fee_min_max", sql`${t.minMicro} is null or ${t.maxMicro} is null or ${t.minMicro} <= ${t.maxMicro}`),
    uniqueIndex("platform_fee_active")
      .on(t.scope, sql`coalesce(${t.scopeId}, '00000000-0000-0000-0000-000000000000')`, t.operationKind)
      .where(sql`${t.supersededAt} is null`),
  ],
);

/** Fees snapshotted at plan creation; only `settled_at` changes afterwards. */
export const operationFees = app.table(
  "operation_fees",
  {
    id: id(),
    operationId: uuid("operation_id").notNull().references(() => operations.id),
    legId: uuid("leg_id").references(() => operationLegs.id),
    kind: feeKind("kind").notNull(),
    baseMicro: numeric("base_micro").notNull(),
    bps: integer("bps"),
    capMicro: numeric("cap_micro"),
    amountMicro: numeric("amount_micro").notNull(),
    recipientAddress: text("recipient_address"),
    organizationId: uuid("organization_id").references(() => organizations.id),
    basketId: uuid("basket_id").references(() => baskets.id),
    scheduleId: uuid("schedule_id").references(() => platformFeeSchedules.id),
    waivedReason: text("waived_reason"),
    settledAt: ts("settled_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("operation_fees_org_settled_idx").on(t.organizationId, t.settledAt),
    index("operation_fees_kind_settled_idx").on(t.kind, t.settledAt),
    index("operation_fees_operation_idx").on(t.operationId),
  ],
);

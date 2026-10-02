import { sql } from "drizzle-orm";
import { text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { app } from "./enums";
import { users } from "./identity";

export const routeToolKind = app.enum("route_tool_kind", ["bridge", "exchange"]);

/** Ops-managed deny list of LI.FI bridges/exchanges (tool keys from `/v1/tools`); an active row (`removed_at` null) is sent as a deny on every estimate and quote. */
export const routePolicyEntries = app.table(
  "route_policy_entries",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    kind: routeToolKind("kind").notNull(),
    toolKey: text("tool_key").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    removedBy: uuid("removed_by").references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [uniqueIndex("route_policy_active").on(t.kind, t.toolKey).where(sql`${t.removedAt} is null`)],
);

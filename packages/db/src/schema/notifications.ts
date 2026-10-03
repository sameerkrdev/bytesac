import { index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { baskets } from "./baskets";
import { app } from "./enums";
import { basketPositions } from "./execution";
import { users } from "./identity";

export const notificationKind = app.enum("notification_kind", [
  "rebalance_available", "drifted", "repair_required", "execution_incomplete", "basket_paused", "basket_unpaused", "basket_retirement_pending", "basket_retired", "lead_changed", "instrument_not_investable",
]);

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** In-app inbox; `dedupe_key` makes every trigger idempotent per user. Only `read_at` is updated. */
export const notifications = app.table(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: notificationKind("kind").notNull(),
    basketId: uuid("basket_id").references(() => baskets.id),
    positionId: uuid("position_id").references(() => basketPositions.id),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notifications_user_dedupe").on(t.userId, t.dedupeKey), index("notifications_user_created_idx").on(t.userId, t.createdAt.desc())],
);

/** Web push (FCM) registration tokens; revoked, never deleted. */
export const pushTokens = app.table(
  "push_tokens",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    token: text("token").notNull().unique(),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);

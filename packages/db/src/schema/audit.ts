import { index, jsonb, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { actorType, app } from "./enums";

export const auditEvents = app.table(
  "audit_events",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorOpsId: text("actor_ops_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    requestId: text("request_id").notNull(),
    sessionId: uuid("session_id"),
    challengeId: uuid("challenge_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId), index("audit_events_actor_idx").on(t.actorUserId)],
);

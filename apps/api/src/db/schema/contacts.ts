import { sql } from "drizzle-orm";
import { boolean, index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { app, contactStatus, contactType, otpChannel, verificationStatus } from "./enums.js";
import { users } from "./identity.js";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const contacts = app.table(
  "contacts",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    userId: uuid("user_id").notNull().references(() => users.id),
    type: contactType("type").notNull(),
    value: text("value").notNull(),
    status: contactStatus("status").notNull().default("unverified"),
    verifiedAt: ts("verified_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("contacts_one_current_per_type").on(t.userId, t.type).where(sql`${t.status} <> 'replaced'`)],
);

export const contactVerifications = app.table(
  "contact_verifications",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    contactId: uuid("contact_id").notNull().references(() => contacts.id),
    destination: text("destination").notNull(),
    channel: otpChannel("channel").notNull(),
    status: verificationStatus("status").notNull().default("pending"),
    providerRef: text("provider_ref"),
    codeHash: text("code_hash"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("contact_verifications_contact_idx").on(t.contactId),
    uniqueIndex("contact_verifications_one_pending").on(t.contactId).where(sql`${t.status} = 'pending'`),
  ],
);

export const notificationPreferences = app.table("notification_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  rebalance: boolean("rebalance").notNull().default(true),
  portfolioUpdates: boolean("portfolio_updates").notNull().default(true),
  managerUpdates: boolean("manager_updates").notNull().default(true),
  offers: boolean("offers").notNull().default(false),
  productUpdates: boolean("product_updates").notNull().default(false),
  marketing: boolean("marketing").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

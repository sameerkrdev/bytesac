import { sql } from "drizzle-orm";
import { check, index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import {
  applicantType, applicationActor, applicationEventKind, applicationStatus, chain, chainFamily, emailCodeStatus, platformRole,
  userPermission, app,
} from "./enums";
import { users } from "./identity";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const managerApplications = app.table(
  "manager_applications",
  {
    id: id(),
    applicantType: applicantType("applicant_type").notNull(),
    fullName: text("full_name").notNull(),
    firmName: text("firm_name"),
    email: text("email").notNull(),
    emailConfirmedAt: ts("email_confirmed_at"),
    phone: text("phone"),
    country: text("country").notNull(),
    website: text("website"),
    professionalBackground: text("professional_background").notNull(),
    investmentExperience: text("investment_experience").notNull(),
    qualifications: text("qualifications"),
    reason: text("reason").notNull(),
    intendedBaskets: text("intended_baskets").notNull(),
    walletChain: chain("wallet_chain").notNull(),
    walletFamily: chainFamily("wallet_family").notNull(),
    /** Canonical typed address: an identifier only, never proof of control. */
    walletAddress: text("wallet_address").notNull(),
    status: applicationStatus("status").notNull().default("EMAIL_PENDING"),
    statusTokenHash: text("status_token_hash").unique("manager_applications_status_token_hash_key"),
    userId: uuid("user_id").references(() => users.id),
    walletProvenAt: ts("wallet_proven_at"),
    submittedAt: ts("submitted_at"),
    decidedAt: ts("decided_at"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("manager_applications_open_email").on(t.email).where(sql`${t.status} <> 'SCREENING_REJECTED'`),
    uniqueIndex("manager_applications_open_wallet").on(t.walletFamily, t.walletAddress).where(sql`${t.status} <> 'SCREENING_REJECTED'`),
    index("manager_applications_queue_idx").on(t.submittedAt, t.id),
    check("manager_applications_firm_name", sql`${t.applicantType} <> 'firm' OR ${t.firmName} IS NOT NULL`),
  ],
);

export const applicationEvents = app.table(
  "application_events",
  {
    id: id(),
    applicationId: uuid("application_id").notNull().references(() => managerApplications.id),
    actorType: applicationActor("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    kind: applicationEventKind("kind").notNull(),
    fromStatus: applicationStatus("from_status"),
    toStatus: applicationStatus("to_status"),
    internalNote: text("internal_note"),
    messageToApplicant: text("message_to_applicant"),
    applicantMessage: text("applicant_message"),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("application_events_application_idx").on(t.applicationId, t.createdAt)],
);

export const applicationEmailCodes = app.table(
  "application_email_codes",
  {
    id: id(),
    applicationId: uuid("application_id").notNull().references(() => managerApplications.id),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    status: emailCodeStatus("status").notNull().default("pending"),
    resolvedAt: ts("resolved_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("application_email_codes_one_pending").on(t.applicationId).where(sql`${t.status} = 'pending'`)],
);

export const platformRoles = app.table(
  "platform_roles",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: platformRole("role").notNull(),
    grantedByUserId: uuid("granted_by_user_id").references(() => users.id),
    grantedAt: ts("granted_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    revokedByUserId: uuid("revoked_by_user_id").references(() => users.id),
  },
  (t) => [uniqueIndex("platform_roles_active").on(t.userId, t.role).where(sql`${t.revokedAt} IS NULL`)],
);

export const userPermissions = app.table(
  "user_permissions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    permission: userPermission("permission").notNull(),
    sourceApplicationId: uuid("source_application_id").references(() => managerApplications.id),
    grantedAt: ts("granted_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("user_permissions_active").on(t.userId, t.permission).where(sql`${t.revokedAt} IS NULL`)],
);

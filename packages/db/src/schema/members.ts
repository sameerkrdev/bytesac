import { sql } from "drizzle-orm";
import { index, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import { app, memberVerificationStatus, membershipActor, membershipEventKind, membershipRole, membershipStatus } from "./enums";
import { users } from "./identity";
import { organizationDocuments, organizationMemberships, organizations } from "./organizations";

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** A member's own KYC: visible to the member (metadata) and ops only. */
export const memberVerifications = app.table(
  "member_verifications",
  {
    id: id(),
    membershipId: uuid("membership_id").notNull().references(() => organizationMemberships.id),
    status: memberVerificationStatus("status").notNull().default("draft"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    submittedAt: ts("submitted_at"),
    decidedAt: ts("decided_at"),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("member_verifications_one_open").on(t.membershipId).where(sql`${t.status} in ('draft', 'in_review', 'changes_required')`)],
);

/** A link is never deleted: `removed_at` unlinks it, so the runtime role needs no DELETE. */
export const memberVerificationDocuments = app.table(
  "member_verification_documents",
  {
    id: id(),
    verificationId: uuid("verification_id").notNull().references(() => memberVerifications.id),
    documentId: uuid("document_id").notNull().references(() => organizationDocuments.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    removedAt: ts("removed_at"),
  },
  (t) => [uniqueIndex("member_verification_documents_active").on(t.verificationId, t.documentId).where(sql`${t.removedAt} IS NULL`)],
);

/** Append-only history of every membership change. */
export const membershipEvents = app.table(
  "membership_events",
  {
    id: id(),
    membershipId: uuid("membership_id").notNull().references(() => organizationMemberships.id),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    actorType: membershipActor("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    kind: membershipEventKind("kind").notNull(),
    fromStatus: membershipStatus("from_status"),
    toStatus: membershipStatus("to_status"),
    fromRole: membershipRole("from_role"),
    toRole: membershipRole("to_role"),
    decision: text("decision"),
    messageToMember: text("message_to_member"),
    internalNote: text("internal_note"),
    reason: text("reason"),
    requestId: text("request_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("membership_events_membership_idx").on(t.membershipId, t.createdAt), index("membership_events_org_idx").on(t.organizationId, t.createdAt)],
);
